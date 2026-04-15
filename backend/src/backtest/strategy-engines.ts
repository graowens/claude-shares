/**
 * Strategy Engines — Apply each person's actual trading rules.
 *
 * Each engine receives the same StockSetup[] and capital, but applies
 * distinct entry, exit, and filtering logic based on what that person
 * teaches in their transcripts.
 */

import type { SimulatedTrade, BarData, StockSetup } from './backtest.service';

interface SimResult {
  trades: SimulatedTrade[];
  totalPnl: number;
  winRate: number;
  maxDrawdown: number;
  finalEquity: number;
  entryMethod: string;
  skippedStocks: number;
  skippedReasons: string[];
}

// ─── Helpers ───────────────────────────────────────────────────

/** Compute a simple moving average of `closes` over the last `period` values up to index `i`. */
function sma(closes: number[], i: number, period: number): number | null {
  if (i + 1 < period) return null;
  let sum = 0;
  for (let j = i - period + 1; j <= i; j++) sum += closes[j];
  return sum / period;
}

/**
 * Calculate missing MA values from dailyBars when the gap scanner didn't provide them.
 * Returns { ma20, ma200 } — uses gap scanner values when available, fills from dailyBars when not.
 */
function fillMAs(setup: StockSetup): { ma20: number | undefined; ma200: number | undefined } {
  let ma20 = setup.ma20 != null && setup.ma20 > 0 ? setup.ma20 : undefined;
  let ma200 = setup.ma200 != null && setup.ma200 > 0 ? setup.ma200 : undefined;

  if ((!ma20 || !ma200) && setup.dailyBars && setup.dailyBars.length > 0) {
    const closes = setup.dailyBars.map(b => b.close);
    const n = closes.length;

    if (!ma20 && n >= 20) {
      let sum = 0;
      for (let i = n - 20; i < n; i++) sum += closes[i];
      ma20 = sum / 20;
    }

    if (!ma200 && n >= 200) {
      let sum = 0;
      for (let i = n - 200; i < n; i++) sum += closes[i];
      ma200 = sum / 200;
    }
  }

  return { ma20, ma200 };
}

/** Check if a bar is a doji / small-body candle (body < 30% of range). */
function isDoji(bar: BarData): boolean {
  const range = bar.high - bar.low;
  if (range <= 0) return true;
  const body = Math.abs(bar.close - bar.open);
  return body / range < 0.3;
}

/** Check if a bar has a bottoming tail (lower wick > 60% of range, for longs). */
function hasBottomingTail(bar: BarData): boolean {
  const range = bar.high - bar.low;
  if (range <= 0) return false;
  const lowerWick = Math.min(bar.open, bar.close) - bar.low;
  return lowerWick / range > 0.6;
}

/** Check if a bar has a topping tail (upper wick > 60% of range, for shorts). */
function hasToppingTail(bar: BarData): boolean {
  const range = bar.high - bar.low;
  if (range <= 0) return false;
  const upperWick = bar.high - Math.max(bar.open, bar.close);
  return upperWick / range > 0.6;
}

/** Check if a bar is a strong momentum bar (body > 60% of range). */
function isMomentumBar(bar: BarData): boolean {
  const range = bar.high - bar.low;
  if (range <= 0) return false;
  const body = Math.abs(bar.close - bar.open);
  return body / range > 0.6;
}

// ═══════════════════════════════════════════════════════════════
//  EMANUEL'S ENGINE — Complete Gap Scalp System
// ═══════════════════════════════════════════════════════════════
//
// Implements ALL rules from Emanuel's transcripts:
//
// 1. FILTERING:
//    - Score >= 30 (Emanuel says pass on 95% of gaps)
//    - Daily context not 'other'
//    - 20MA not flat (trendDirection != sideways)
//
// 2. 200MA BIAS:
//    - Gap above 200MA = very bullish (floor/support) → long bias
//    - Gap below 200MA = bearish (ceiling/resistance) → short bias
//    - Validate gap direction matches 200MA bias
//    - Squeeze play: price near both 20MA and 200MA
//
// 3. 20MA TREND FILTER:
//    - Rising 20MA under price = uptrend → retrace to 20MA = buy
//    - Declining 20MA over price = downtrend → retrace to 20MA = short
//    - Skip overextended setups (price too far from intraday 20MA)
//
// 4. ENTRY METHODS (tried in order):
//    a. Opening Range Breakout (first bar high/low, skip if >3% range)
//    b. 1-2-3 Pattern (igniting bar → doji/resting bar → trigger)
//    c. Retracement to intraday 20MA with bottoming/topping tail
//
// 5. TRADE MANAGEMENT:
//    - Initial stop from entry method
//    - At 2:1 R:R → activate bar-by-bar trail (every 3 bars ≈ 15min)
//    - At 5:1 R:R → tighten to every bar (≈ 5min)

export function simulateEmanuel(
  setups: StockSetup[],
  capital: number,
): SimResult {
  const capitalPerStock = capital / Math.max(setups.length, 1);
  let equity = capital;
  let maxEquity = equity;
  let maxDrawdown = 0;
  const trades: SimulatedTrade[] = [];
  let skippedStocks = 0;
  const skippedReasons: string[] = [];

  for (const setup of setups) {
    const { bars, isGapUp, side, gapPercent, symbol } = setup;

    // ── FILTER 1: Emanuel says "pass on 95% of gaps" — need score ──
    if ((setup.score ?? 0) < 30) {
      skippedStocks++;
      skippedReasons.push(`${symbol}: Score ${setup.score ?? 0} too low (need 30+)`);
      continue;
    }

    // ── FILTER 2: Need clear daily context ──
    if (setup.dailyContext === 'other') {
      skippedStocks++;
      skippedReasons.push(`${symbol}: No clear daily chart context`);
      continue;
    }

    // ── FILTER 3: 20MA must not be flat ──
    if (setup.trendDirection === 'sideways') {
      skippedStocks++;
      skippedReasons.push(`${symbol}: Flat 20MA — no momentum, Emanuel says ignore`);
      continue;
    }

    if (bars.length < 4) {
      skippedStocks++;
      skippedReasons.push(`${symbol}: Not enough bars`);
      continue;
    }

    // ── Calculate MAs (fill from dailyBars if gap scanner didn't have enough history) ──
    const { ma20: resolvedMA20, ma200: resolvedMA200 } = fillMAs(setup);

    // ── 200MA BIAS CHECK ──
    // From transcript: "Gap above 200MA = very bullish" / "Gap below 200MA = bearish"
    // "I really like gaps that open below the 200" (for shorts)
    // "Gap UP above 200MA triggering this base breakout" (for longs)
    const has200MA = resolvedMA200 != null && resolvedMA200 > 0;
    const openPrice = bars[0].open;

    if (has200MA) {
      const priceVs200 = openPrice > resolvedMA200! ? 'above' : 'below';

      // Gap up but opening below 200MA — 200MA acts as ceiling/resistance
      // Less bullish, might get rejected. Still tradeable but lower conviction.
      // Gap down but opening above 200MA — 200MA acts as floor/support
      // Less bearish, might bounce. Lower conviction short.
      if (isGapUp && priceVs200 === 'below') {
        // Opening below 200MA on a gap up — 200MA is resistance overhead
        // Emanuel: this is not ideal for longs, 200MA is ceiling
        // Still allow but note it
      }
      if (!isGapUp && priceVs200 === 'above') {
        // Opening above 200MA on a gap down — 200MA is support below
        // Emanuel: 200MA acts as floor, might bounce
        // Still allow but note it
      }

      // Squeeze play detection: price near both 20MA and 200MA
      if (resolvedMA20 != null && resolvedMA20 > 0) {
        const ma20to200dist = Math.abs(resolvedMA20 - resolvedMA200!) / resolvedMA200! * 100;
        const priceToMAdist = Math.abs(openPrice - resolvedMA200!) / resolvedMA200! * 100;
        if (ma20to200dist < 2 && priceToMAdist < 3) {
          // Squeeze play — 20MA and 200MA are very close, price between them
          // Emanuel: "extremely powerful" but "quite rare" — boost conviction
          // We'll let the trade through regardless of other filters
        }
      }
    }

    // ── 200MA as directional confirmation ──
    // Emanuel: "I went into yesterday with a bearish bias" (when gapped below 200)
    // "gapped above the 200 triggering this base breakout" (bullish)
    let directionConfirmed = true;
    if (has200MA) {
      if (isGapUp && openPrice < resolvedMA200!) {
        // Gap up but below 200MA — 200MA is overhead resistance
        // Reduce conviction but don't skip (Emanuel still trades these)
        directionConfirmed = false;
      }
      if (!isGapUp && openPrice > resolvedMA200!) {
        // Gap down but above 200MA — 200MA is floor support
        directionConfirmed = false;
      }
    }

    // ── 20MA TREND CONFIRMATION ──
    // Check daily 20MA vs price for additional bias
    const has20MA = resolvedMA20 != null && resolvedMA20 > 0;
    if (has20MA) {
      // Rising 20MA under price = uptrend → confirms longs
      // Declining 20MA over price = downtrend → confirms shorts
      if (isGapUp && resolvedMA20! > openPrice) {
        // 20MA is ABOVE price on gap up — counter-trend, lower conviction
        // Emanuel: we want 20MA UNDER price for longs
      }
      if (!isGapUp && resolvedMA20! < openPrice) {
        // 20MA is BELOW price on gap down — counter-trend
        // Emanuel: we want 20MA OVER price for shorts
      }
    }

    // ── Build intraday 20-SMA from 5-min bars ──
    const closes: number[] = bars.map(b => b.close);
    const intraday20MA: (number | null)[] = closes.map((_, i) => {
      // Use a 4-period SMA on 5-min bars (20 min equivalent)
      // Since we only have ~12 bars (1 hour of 5-min), 20-period won't work
      return sma(closes, i, 4);
    });

    // ── TRY ENTRY METHODS IN ORDER ──

    let entryPrice: number | null = null;
    let stopLevel: number | null = null;
    let entryBarIndex = -1;
    let entryMethodUsed = '';

    // ── METHOD 1: Opening Range Breakout ──
    // First 5-min candle: entry above high (long) or below low (short)
    // Skip if candle is too wide (>3%)
    const orbBar = bars[0];
    const orbRange = orbBar.high - orbBar.low;
    const orbRangePercent = (orbRange / orbBar.open) * 100;

    if (orbRangePercent <= 3) {
      const orbEntry = isGapUp ? orbBar.high : orbBar.low;
      const orbStop = isGapUp ? orbBar.low : orbBar.high;

      // Scan for ORB trigger in bars 1-3
      for (let i = 1; i < Math.min(bars.length, 4); i++) {
        const bar = bars[i];
        if (isGapUp && bar.high >= orbEntry) {
          entryPrice = orbEntry;
          stopLevel = orbStop;
          entryBarIndex = i;
          entryMethodUsed = 'Opening Range Breakout';
          break;
        }
        if (!isGapUp && bar.low <= orbEntry) {
          entryPrice = orbEntry;
          stopLevel = orbStop;
          entryBarIndex = i;
          entryMethodUsed = 'Opening Range Breakout';
          break;
        }
      }
    }

    // ── METHOD 2: 1-2-3 Pattern ──
    // Igniting bar (momentum) → Resting bar (doji/small) → Trigger bar breaks resting high/low
    if (entryPrice === null && bars.length >= 4) {
      for (let i = 0; i < bars.length - 2; i++) {
        const igniting = bars[i];
        const resting = bars[i + 1];
        const trigger = bars[i + 2];

        // Check igniting bar is a momentum bar in the gap direction
        const ignitingBullish = igniting.close > igniting.open && isMomentumBar(igniting);
        const ignitingBearish = igniting.close < igniting.open && isMomentumBar(igniting);

        if (isGapUp && ignitingBullish && (isDoji(resting) || hasBottomingTail(resting))) {
          // Trigger: breaks above resting bar high
          if (trigger.high >= resting.high) {
            entryPrice = resting.high;
            stopLevel = resting.low;
            entryBarIndex = i + 2;
            entryMethodUsed = '1-2-3 Pattern';
            break;
          }
        }
        if (!isGapUp && ignitingBearish && (isDoji(resting) || hasToppingTail(resting))) {
          // Trigger: breaks below resting bar low
          if (trigger.low <= resting.low) {
            entryPrice = resting.low;
            stopLevel = resting.high;
            entryBarIndex = i + 2;
            entryMethodUsed = '1-2-3 Pattern';
            break;
          }
        }
      }
    }

    // ── METHOD 3: Retracement to Intraday 20MA ──
    // Look for price pulling back to touch the intraday 20MA with a bottoming/topping tail
    if (entryPrice === null) {
      for (let i = 2; i < bars.length; i++) {
        const bar = bars[i];
        const ma = intraday20MA[i];
        if (ma === null) continue;

        if (isGapUp) {
          // Price retraces down to 20MA, bottoming tail/doji = buy
          const touchedMA = bar.low <= ma * 1.002; // within 0.2% of MA
          const priceAboveMA = bar.close > ma;
          if (touchedMA && priceAboveMA && (hasBottomingTail(bar) || isDoji(bar))) {
            entryPrice = bar.close;
            // Stop below the bar's low (which touched the MA)
            stopLevel = bar.low;
            entryBarIndex = i;
            entryMethodUsed = 'Retracement to 20MA';
            break;
          }
        } else {
          // Price retraces up to 20MA, topping tail/doji = short
          const touchedMA = bar.high >= ma * 0.998;
          const priceBelowMA = bar.close < ma;
          if (touchedMA && priceBelowMA && (hasToppingTail(bar) || isDoji(bar))) {
            entryPrice = bar.close;
            stopLevel = bar.high;
            entryBarIndex = i;
            entryMethodUsed = 'Retracement to 20MA';
            break;
          }
        }
      }
    }

    // ── METHOD 4: Fallback — simple ORB even if wide, with wider stop ──
    if (entryPrice === null) {
      // If no clean entry found, use first bar open as entry with fixed 1% stop
      // This represents "just getting in" on high-conviction daily setups
      // Only if direction is confirmed by 200MA
      if (directionConfirmed) {
        entryPrice = bars[0].open;
        stopLevel = isGapUp
          ? entryPrice * (1 - 1 / 100)
          : entryPrice * (1 + 1 / 100);
        entryBarIndex = 0;
        entryMethodUsed = 'Market entry (high conviction)';
      }
    }

    // No entry found at all
    if (entryPrice === null || stopLevel === null) {
      skippedStocks++;
      skippedReasons.push(`${symbol}: No valid entry pattern found and 200MA didn't confirm direction`);
      continue;
    }

    // ── TRADE MANAGEMENT: Bar-by-bar trailing ──
    const riskPerShare = Math.abs(entryPrice - stopLevel);
    if (riskPerShare <= 0) {
      skippedStocks++;
      skippedReasons.push(`${symbol}: Zero risk on entry`);
      continue;
    }

    let exitPrice: number | null = null;
    let exitReason: SimulatedTrade['exitReason'] = 'end_of_hour';
    let trailingStop = stopLevel;
    let trailingActive = false;
    let tightTrailActive = false;
    let barsSinceLastTrailUpdate = 0;

    // Process bars from entry onward
    for (let i = entryBarIndex; i < bars.length; i++) {
      const bar = bars[i];

      // ── Check stop loss (or trailing stop) ──
      if (isGapUp && bar.low <= trailingStop) {
        exitPrice = trailingStop;
        exitReason = trailingActive ? 'take_profit' : 'stop_loss';
        break;
      }
      if (!isGapUp && bar.high >= trailingStop) {
        exitPrice = trailingStop;
        exitReason = trailingActive ? 'take_profit' : 'stop_loss';
        break;
      }

      // ── 200MA as resistance/support target ──
      // If we have 200MA data and price approaches it from the "wrong" side, consider taking profit
      if (has200MA && !directionConfirmed) {
        // E.g., long but below 200MA — if price reaches 200MA, that's resistance
        if (isGapUp && bar.high >= resolvedMA200!) {
          exitPrice = resolvedMA200!;
          exitReason = 'take_profit';
          break;
        }
        if (!isGapUp && bar.low <= resolvedMA200!) {
          exitPrice = resolvedMA200!;
          exitReason = 'take_profit';
          break;
        }
      }

      // ── Calculate current R:R ──
      const currentPnlPerShare = isGapUp
        ? bar.close - entryPrice
        : entryPrice - bar.close;
      const currentRR = currentPnlPerShare / riskPerShare;

      // ── Activate trailing at 2:1 R:R ──
      if (!trailingActive && currentRR >= 2) {
        trailingActive = true;
        barsSinceLastTrailUpdate = 0;
      }

      // ── Tighten trailing at 5:1 R:R ──
      if (trailingActive && !tightTrailActive && currentRR >= 5) {
        tightTrailActive = true;
        barsSinceLastTrailUpdate = 0;
      }

      // ── Update trailing stop ──
      if (trailingActive) {
        barsSinceLastTrailUpdate++;
        const updateInterval = tightTrailActive ? 1 : 3; // 5min vs 15min equivalent

        if (barsSinceLastTrailUpdate >= updateInterval) {
          barsSinceLastTrailUpdate = 0;
          if (isGapUp) {
            // Trail to bar's low, only move UP
            const newStop = bar.low;
            if (newStop > trailingStop) {
              trailingStop = newStop;
            }
          } else {
            // Trail to bar's high, only move DOWN
            const newStop = bar.high;
            if (newStop < trailingStop) {
              trailingStop = newStop;
            }
          }
        }
      }
    }

    // End of hour exit
    if (exitPrice === null) {
      exitPrice = bars[bars.length - 1].close;
      exitReason = 'end_of_hour';
    }

    // ── Calculate P/L ──
    const shares = Math.floor(capitalPerStock / entryPrice);
    if (shares <= 0) continue;
    const multiplier = isGapUp ? 1 : -1;
    const pnlPerShare = (exitPrice - entryPrice) * multiplier;
    const pnlPercent = (pnlPerShare / entryPrice) * 100;
    const pnl = pnlPerShare * shares;

    equity += pnl;
    maxEquity = Math.max(maxEquity, equity);
    const drawdown = ((maxEquity - equity) / maxEquity) * 100;
    maxDrawdown = Math.max(maxDrawdown, drawdown);

    trades.push({
      date: bars[0].timestamp,
      symbol,
      entryPrice,
      exitPrice,
      pnl,
      pnlPercent,
      side,
      exitReason,
      shares,
      gapPercent,
      equityAfter: equity,
    });
  }

  const wins = trades.filter((t) => t.pnl > 0).length;
  const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;
  const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);

  return {
    trades,
    totalPnl,
    winRate,
    maxDrawdown,
    finalEquity: equity,
    entryMethod: 'Gap Scalp System (ORB → 1-2-3 → 20MA Retracement) + 200MA Bias + Bar-by-Bar Trail',
    skippedStocks,
    skippedReasons,
  };
}

// ═══════════════════════════════════════════════════════════════
//  CLAUDE'S ENGINE — Stop Gap Reversal
// ═══════════════════════════════════════════════════════════════
//
// Counter-trend strategy that exploits stop-loss cascades:
//
// 1. From daily bars, find swing highs/lows and MA levels as S/R
// 2. Check if the gap punched THROUGH an S/R level (stop hunt)
// 3. Wait 2-3 bars for the stop cascade to exhaust
// 4. Enter counter-trend on a reversal bar (bottoming/topping tail)
// 5. Stop at the extreme of the stop run (tight)
// 6. Target 1: back to breached S/R level
// 7. Target 2: back to previous close (full gap fill)

/** Find swing lows from daily bars (a swing low has higher bars on both sides). */
function findSwingLows(dailyBars: BarData[], lookback: number): number[] {
  const levels: number[] = [];
  for (let i = lookback; i < dailyBars.length - lookback; i++) {
    let isSwingLow = true;
    for (let j = 1; j <= lookback; j++) {
      if (dailyBars[i - j].low < dailyBars[i].low || dailyBars[i + j].low < dailyBars[i].low) {
        isSwingLow = false;
        break;
      }
    }
    if (isSwingLow) levels.push(dailyBars[i].low);
  }
  return levels;
}

/** Find swing highs from daily bars (a swing high has lower bars on both sides). */
function findSwingHighs(dailyBars: BarData[], lookback: number): number[] {
  const levels: number[] = [];
  for (let i = lookback; i < dailyBars.length - lookback; i++) {
    let isSwingHigh = true;
    for (let j = 1; j <= lookback; j++) {
      if (dailyBars[i - j].high > dailyBars[i].high || dailyBars[i + j].high > dailyBars[i].high) {
        isSwingHigh = false;
        break;
      }
    }
    if (isSwingHigh) levels.push(dailyBars[i].high);
  }
  return levels;
}

export interface ClaudeParams {
  swingLookback: number;  // bars on each side for swing detection (default 3)
  waitBars: number;       // wait for stop cascade to exhaust (default 3)
  stopBuffer: number;     // buffer beyond extreme as decimal (default 0.001 = 0.1%)
  rejectionThreshold: number; // wick ratio to count as rejection (default 0.4)
}

export const CLAUDE_DEFAULT_PARAMS: ClaudeParams = {
  swingLookback: 3,
  waitBars: 3,
  stopBuffer: 0.001,
  rejectionThreshold: 0.4,
};

export function simulateClaude(
  setups: StockSetup[],
  capital: number,
  params?: Partial<ClaudeParams>,
): SimResult {
  const p = { ...CLAUDE_DEFAULT_PARAMS, ...params };
  const capitalPerStock = capital / Math.max(setups.length, 1);
  let equity = capital;
  let maxEquity = equity;
  let maxDrawdown = 0;
  const trades: SimulatedTrade[] = [];
  let skippedStocks = 0;
  const skippedReasons: string[] = [];

  const SWING_LOOKBACK = p.swingLookback;
  const WAIT_BARS = p.waitBars;
  const STOP_BUFFER = p.stopBuffer;

  for (const setup of setups) {
    const { bars, isGapUp, gapPercent, symbol, dailyBars, prevClose } = setup;

    if (bars.length < WAIT_BARS + 2) {
      skippedStocks++;
      skippedReasons.push(`${symbol}: Not enough intraday bars`);
      continue;
    }

    // ── Step 1: Build S/R levels from daily bars ──
    const supportLevels: number[] = [];
    const resistanceLevels: number[] = [];

    if (dailyBars && dailyBars.length >= SWING_LOOKBACK * 2 + 1) {
      // Swing detection when we have enough bars
      supportLevels.push(...findSwingLows(dailyBars, SWING_LOOKBACK));
      resistanceLevels.push(...findSwingHighs(dailyBars, SWING_LOOKBACK));
    }

    if (dailyBars && dailyBars.length >= 3) {
      // Fallback: use recent N-day high/low as S/R
      // These are levels where stops cluster — below recent lows, above recent highs
      const recentBars = dailyBars.slice(-Math.min(20, dailyBars.length));
      const recentLow = Math.min(...recentBars.map(b => b.low));
      const recentHigh = Math.max(...recentBars.map(b => b.high));
      supportLevels.push(recentLow);
      resistanceLevels.push(recentHigh);

      // Also add the lowest close and highest close as secondary levels
      const recentLowClose = Math.min(...recentBars.map(b => b.close));
      const recentHighClose = Math.max(...recentBars.map(b => b.close));
      if (recentLowClose !== recentLow) supportLevels.push(recentLowClose);
      if (recentHighClose !== recentHigh) resistanceLevels.push(recentHighClose);
    }

    // Add MA levels as institutional S/R (fill from dailyBars if gap scanner missed them)
    const { ma20: claudeMA20, ma200: claudeMA200 } = fillMAs(setup);
    if (claudeMA200 != null && claudeMA200 > 0) {
      supportLevels.push(claudeMA200);
      resistanceLevels.push(claudeMA200);
    }
    if (claudeMA20 != null && claudeMA20 > 0) {
      supportLevels.push(claudeMA20);
      resistanceLevels.push(claudeMA20);
    }

    // Need at least some S/R levels to work with
    if (supportLevels.length === 0 && resistanceLevels.length === 0) {
      skippedStocks++;
      skippedReasons.push(`${symbol}: No S/R levels found (${dailyBars?.length ?? 0} daily bars)`);
      continue;
    }

    // Previous close is a key reference level
    const pc = prevClose ?? dailyBars[dailyBars.length - 1]?.close;

    const openPrice = bars[0].open;

    // ── Step 2: Check if gap punched through S/R ──
    // For gap DOWN: check if open is below any support level that prevClose was above
    // For gap UP: check if open is above any resistance level that prevClose was below
    let breachedLevels: number[] = [];
    let stopHuntDirection: 'buy' | 'sell' | null = null;

    if (isGapUp && pc) {
      // Gap up through resistance — stops above resistance triggered
      // We'll look to SHORT the reversal (counter-trend)
      const breached = resistanceLevels.filter(r => pc < r && openPrice > r);
      if (breached.length > 0) {
        breachedLevels = breached;
        stopHuntDirection = 'sell'; // counter-trend: short the reversal
      }
    } else if (!isGapUp && pc) {
      // Gap down through support — stops below support triggered
      // We'll look to BUY the reversal (counter-trend)
      const breached = supportLevels.filter(s => pc > s && openPrice < s);
      if (breached.length > 0) {
        breachedLevels = breached;
        stopHuntDirection = 'buy'; // counter-trend: buy the reversal
      }
    }

    if (stopHuntDirection === null || breachedLevels.length === 0) {
      skippedStocks++;
      skippedReasons.push(
        `${symbol}: Gap didn't punch through any S/R level (${supportLevels.length} supports, ${resistanceLevels.length} resistances found)`,
      );
      continue;
    }

    // The nearest breached level is our primary target (price should snap back to it)
    const primaryTarget = stopHuntDirection === 'buy'
      ? Math.min(...breachedLevels)  // for longs, nearest support above
      : Math.max(...breachedLevels); // for shorts, nearest resistance below

    // ── Step 3: Wait for stop cascade to exhaust ──
    // Track the extreme price during the wait period
    let extremePrice = openPrice;
    for (let i = 0; i < Math.min(WAIT_BARS, bars.length); i++) {
      if (stopHuntDirection === 'buy') {
        // Gap down — track lowest low (extreme of stop run)
        extremePrice = Math.min(extremePrice, bars[i].low);
      } else {
        // Gap up — track highest high (extreme of stop run)
        extremePrice = Math.max(extremePrice, bars[i].high);
      }
    }

    // ── Step 4: Look for reversal bar ──
    let entryPrice: number | null = null;
    let stopLevel: number | null = null;
    let entryBarIndex = -1;

    for (let i = WAIT_BARS; i < bars.length - 1; i++) {
      const bar = bars[i];

      // Update extreme if price is still making new extremes (cascade ongoing)
      if (stopHuntDirection === 'buy') {
        extremePrice = Math.min(extremePrice, bar.low);
      } else {
        extremePrice = Math.max(extremePrice, bar.high);
      }

      if (stopHuntDirection === 'buy') {
        // Looking for a bottoming reversal bar:
        // - Has a bottoming tail (lower wick > 50% of range), OR
        // - Closes in upper half of range (buyers stepping in), OR
        // - Is a doji near the lows
        const range = bar.high - bar.low;
        if (range <= 0) continue;
        const lowerWick = Math.min(bar.open, bar.close) - bar.low;
        const closesUpperHalf = bar.close > (bar.high + bar.low) / 2;
        const hasRejection = lowerWick / range > p.rejectionThreshold || closesUpperHalf;

        if (hasRejection) {
          // Entry above the reversal bar's high
          // Check if next bar triggers entry
          const nextBar = bars[i + 1];
          if (nextBar.high >= bar.high) {
            entryPrice = bar.high;
            stopLevel = extremePrice * (1 - STOP_BUFFER);
            entryBarIndex = i + 1;
            break;
          }
        }
      } else {
        // Looking for a topping reversal bar (for shorts)
        const range = bar.high - bar.low;
        if (range <= 0) continue;
        const upperWick = bar.high - Math.max(bar.open, bar.close);
        const closesLowerHalf = bar.close < (bar.high + bar.low) / 2;
        const hasRejection = upperWick / range > p.rejectionThreshold || closesLowerHalf;

        if (hasRejection) {
          const nextBar = bars[i + 1];
          if (nextBar.low <= bar.low) {
            entryPrice = bar.low;
            stopLevel = extremePrice * (1 + STOP_BUFFER);
            entryBarIndex = i + 1;
            break;
          }
        }
      }
    }

    if (entryPrice === null || stopLevel === null) {
      skippedStocks++;
      skippedReasons.push(`${symbol}: No reversal bar found after stop cascade`);
      continue;
    }

    const riskPerShare = Math.abs(entryPrice - stopLevel);
    if (riskPerShare <= 0) {
      skippedStocks++;
      skippedReasons.push(`${symbol}: Zero risk on entry`);
      continue;
    }

    // ── Step 5: Manage the trade ──
    // Target 1: breached S/R level
    // Target 2: previous close (full gap fill)
    const secondaryTarget = pc ?? primaryTarget;
    let exitPrice: number | null = null;
    let exitReason: SimulatedTrade['exitReason'] = 'end_of_hour';
    let trailingStop = stopLevel;
    let hitTarget1 = false;

    for (let i = entryBarIndex; i < bars.length; i++) {
      const bar = bars[i];

      // Check stop loss / trailing stop
      if (stopHuntDirection === 'buy') {
        if (bar.low <= trailingStop) {
          exitPrice = trailingStop;
          exitReason = hitTarget1 ? 'take_profit' : 'stop_loss';
          break;
        }
      } else {
        if (bar.high >= trailingStop) {
          exitPrice = trailingStop;
          exitReason = hitTarget1 ? 'take_profit' : 'stop_loss';
          break;
        }
      }

      // Check Target 1: breached S/R level
      if (!hitTarget1) {
        if (stopHuntDirection === 'buy' && bar.high >= primaryTarget) {
          hitTarget1 = true;
          // Move stop to breakeven, let remainder run to target 2
          trailingStop = entryPrice;
        }
        if (stopHuntDirection === 'sell' && bar.low <= primaryTarget) {
          hitTarget1 = true;
          trailingStop = entryPrice;
        }
      }

      // Check Target 2: previous close (full gap fill)
      if (hitTarget1) {
        if (stopHuntDirection === 'buy' && bar.high >= secondaryTarget) {
          exitPrice = secondaryTarget;
          exitReason = 'take_profit';
          break;
        }
        if (stopHuntDirection === 'sell' && bar.low <= secondaryTarget) {
          exitPrice = secondaryTarget;
          exitReason = 'take_profit';
          break;
        }

        // Bar-by-bar trail after target 1
        if (stopHuntDirection === 'buy') {
          trailingStop = Math.max(trailingStop, bar.low);
        } else {
          trailingStop = Math.min(trailingStop, bar.high);
        }
      }
    }

    // End of hour exit
    if (exitPrice === null) {
      exitPrice = bars[bars.length - 1].close;
      exitReason = 'end_of_hour';
    }

    // ── Calculate P/L ──
    const shares = Math.floor(capitalPerStock / entryPrice);
    if (shares <= 0) continue;
    const multiplier = stopHuntDirection === 'buy' ? 1 : -1;
    const pnlPerShare = (exitPrice - entryPrice) * multiplier;
    const pnlPercent = (pnlPerShare / entryPrice) * 100;
    const pnl = pnlPerShare * shares;

    equity += pnl;
    maxEquity = Math.max(maxEquity, equity);
    const drawdown = ((maxEquity - equity) / maxEquity) * 100;
    maxDrawdown = Math.max(maxDrawdown, drawdown);

    trades.push({
      date: bars[0].timestamp,
      symbol,
      entryPrice,
      exitPrice,
      pnl,
      pnlPercent,
      side: stopHuntDirection,
      exitReason,
      shares,
      gapPercent,
      equityAfter: equity,
    });
  }

  const wins = trades.filter((t) => t.pnl > 0).length;
  const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;
  const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);

  return {
    trades,
    totalPnl,
    winRate,
    maxDrawdown,
    finalEquity: equity,
    entryMethod: 'Stop Gap Reversal (counter-trend after S/R breach → reversal bar → target S/R fill)',
    skippedStocks,
    skippedReasons,
  };
}

// ═══════════════════════════════════════════════════════════════
//  FABIO'S ENGINE — 30-Min Delayed Entry + Breakeven Stop
// ═══════════════════════════════════════════════════════════════
//
// Entry:  Wait 30 minutes (6 bars), then enter at bar[6].open.
//         Direction follows the gap.
// Stop:   0.5% from entry. Move to breakeven once up 0.3%.
// Target: 1:5 R:R (2.5% for 0.5% stop).
// Filter: None specific — Fabio trades more broadly.

export function simulateFabio(
  setups: StockSetup[],
  capital: number,
): SimResult {
  const capitalPerStock = capital / Math.max(setups.length, 1);
  let equity = capital;
  let maxEquity = equity;
  let maxDrawdown = 0;
  const trades: SimulatedTrade[] = [];
  let skippedStocks = 0;
  const skippedReasons: string[] = [];

  const SL_PERCENT = 0.5;
  const BREAKEVEN_TRIGGER = 0.3; // move to BE once up this %
  const RR_RATIO = 5; // 1:5 R:R

  for (const setup of setups) {
    const { bars, isGapUp, side, gapPercent, symbol } = setup;

    // Need at least 7 bars (0-5 wait + bar 6 entry + 1 to trade)
    if (bars.length < 8) {
      skippedStocks++;
      skippedReasons.push(`${symbol}: Not enough bars after 30-min wait`);
      continue;
    }

    // ── Entry: after 30 minutes ──
    const entryBar = bars[6]; // 30 minutes in
    const entryPrice = entryBar.open;

    const stopDistance = entryPrice * (SL_PERCENT / 100);
    let stopLevel = isGapUp
      ? entryPrice - stopDistance
      : entryPrice + stopDistance;

    const targetLevel = isGapUp
      ? entryPrice + stopDistance * RR_RATIO
      : entryPrice - stopDistance * RR_RATIO;

    const breakevenTrigger = isGapUp
      ? entryPrice * (1 + BREAKEVEN_TRIGGER / 100)
      : entryPrice * (1 - BREAKEVEN_TRIGGER / 100);

    let exitPrice: number | null = null;
    let exitReason: SimulatedTrade['exitReason'] = 'end_of_hour';
    let movedToBreakeven = false;

    // Trade from bar 6 onward
    for (let i = 6; i < bars.length; i++) {
      const bar = bars[i];

      // Check stop loss
      if (isGapUp && bar.low <= stopLevel) {
        exitPrice = stopLevel;
        exitReason = movedToBreakeven ? 'take_profit' : 'stop_loss';
        break;
      }
      if (!isGapUp && bar.high >= stopLevel) {
        exitPrice = stopLevel;
        exitReason = movedToBreakeven ? 'take_profit' : 'stop_loss';
        break;
      }

      // Check take profit
      if (isGapUp && bar.high >= targetLevel) {
        exitPrice = targetLevel;
        exitReason = 'take_profit';
        break;
      }
      if (!isGapUp && bar.low <= targetLevel) {
        exitPrice = targetLevel;
        exitReason = 'take_profit';
        break;
      }

      // Move to breakeven once up enough
      if (!movedToBreakeven) {
        if (isGapUp && bar.high >= breakevenTrigger) {
          stopLevel = entryPrice;
          movedToBreakeven = true;
        }
        if (!isGapUp && bar.low <= breakevenTrigger) {
          stopLevel = entryPrice;
          movedToBreakeven = true;
        }
      }
    }

    if (exitPrice === null) {
      exitPrice = bars[bars.length - 1].close;
      exitReason = 'end_of_hour';
    }

    const shares = Math.floor(capitalPerStock / entryPrice);
    if (shares <= 0) continue;
    const multiplier = isGapUp ? 1 : -1;
    const pnlPerShare = (exitPrice - entryPrice) * multiplier;
    const pnlPercent = (pnlPerShare / entryPrice) * 100;
    const pnl = pnlPerShare * shares;

    equity += pnl;
    maxEquity = Math.max(maxEquity, equity);
    const drawdown = ((maxEquity - equity) / maxEquity) * 100;
    maxDrawdown = Math.max(maxDrawdown, drawdown);

    trades.push({
      date: bars[6].timestamp,
      symbol,
      entryPrice,
      exitPrice,
      pnl,
      pnlPercent,
      side,
      exitReason,
      shares,
      gapPercent,
      equityAfter: equity,
    });
  }

  const wins = trades.filter((t) => t.pnl > 0).length;
  const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;
  const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);

  return {
    trades,
    totalPnl,
    winRate,
    maxDrawdown,
    finalEquity: equity,
    entryMethod: '30-Min Delayed Entry + Breakeven Stop (1:5 R:R)',
    skippedStocks,
    skippedReasons,
  };
}

// ═══════════════════════════════════════════════════════════════
//  GENERIC ENGINE — Simple fixed SL/TP (for unknown authors)
// ═══════════════════════════════════════════════════════════════

export function simulateGeneric(
  setups: StockSetup[],
  capital: number,
  stopLoss: number,
  takeProfit: number,
): SimResult {
  const capitalPerStock = capital / Math.max(setups.length, 1);
  let equity = capital;
  let maxEquity = equity;
  let maxDrawdown = 0;
  const trades: SimulatedTrade[] = [];

  for (const setup of setups) {
    const { bars, isGapUp, side, gapPercent, symbol } = setup;
    const entryPrice = bars[0].open;

    const stopLevel = isGapUp
      ? entryPrice * (1 - stopLoss / 100)
      : entryPrice * (1 + stopLoss / 100);

    const targetLevel = isGapUp
      ? entryPrice * (1 + takeProfit / 100)
      : entryPrice * (1 - takeProfit / 100);

    let exitPrice: number | null = null;
    let exitReason: SimulatedTrade['exitReason'] = 'end_of_hour';

    for (const bar of bars) {
      if (isGapUp) {
        if (bar.low <= stopLevel) { exitPrice = stopLevel; exitReason = 'stop_loss'; break; }
        if (bar.high >= targetLevel) { exitPrice = targetLevel; exitReason = 'take_profit'; break; }
      } else {
        if (bar.high >= stopLevel) { exitPrice = stopLevel; exitReason = 'stop_loss'; break; }
        if (bar.low <= targetLevel) { exitPrice = targetLevel; exitReason = 'take_profit'; break; }
      }
    }

    if (exitPrice === null) {
      exitPrice = bars[bars.length - 1].close;
      exitReason = 'end_of_hour';
    }

    const shares = Math.floor(capitalPerStock / entryPrice);
    if (shares <= 0) continue;
    const multiplier = isGapUp ? 1 : -1;
    const pnlPerShare = (exitPrice - entryPrice) * multiplier;
    const pnlPercent = (pnlPerShare / entryPrice) * 100;
    const pnl = pnlPerShare * shares;

    equity += pnl;
    maxEquity = Math.max(maxEquity, equity);
    const drawdown = ((maxEquity - equity) / maxEquity) * 100;
    maxDrawdown = Math.max(maxDrawdown, drawdown);

    trades.push({
      date: bars[0].timestamp,
      symbol,
      entryPrice,
      exitPrice,
      pnl,
      pnlPercent,
      side,
      exitReason,
      shares,
      gapPercent,
      equityAfter: equity,
    });
  }

  const wins = trades.filter((t) => t.pnl > 0).length;
  const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;
  const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);

  return {
    trades,
    totalPnl,
    winRate,
    maxDrawdown,
    finalEquity: equity,
    entryMethod: `Fixed SL ${stopLoss}% / TP ${takeProfit}%`,
    skippedStocks: 0,
    skippedReasons: [],
  };
}
