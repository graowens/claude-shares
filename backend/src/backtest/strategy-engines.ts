/**
 * Strategy Engines — Apply each person's actual trading rules.
 *
 * Each engine receives the same StockSetup[] and capital, but applies
 * distinct entry, exit, and filtering logic based on what that person
 * teaches in their transcripts.
 */

import type { SimulatedTrade, BarData, StockSetup } from './backtest.service';

export interface SimResult {
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
// Emanuel's COMPLETE trading system from ALL transcripts (11 videos analysed):
//
// PHILOSOPHY: "One and done" — ONE trade per day on the BEST setup.
// "Share size = Risk / (Entry - Stop)" — size on stop distance.
// "If there's less than 2:1 risk-to-reward, I cannot take this setup"
//
// MUST-HAVES (deal breakers):
//   - Rising/declining 20MA (not flat)
//   - Tight consolidation / clean base (not sloppy)
//   - High quality overnight gap (daily context)
//   - Minimum 2:1 R:R to target (prior high/low)
//   - Score >= 50
//   - Price >= $2 (no penny stocks)
//   - Gap >= 5% (explosive movers)
//
// CANNOT-HAVES (instant reject):
//   - Timeframe conflict (daily vs intraday disagree)
//   - Sloppy price action
//   - Less than 2:1 R:R
//   - Spread > 10% of stop (proxy: low volume)
//
// ENTRY METHODS (within first hour):
//   1. ORB — first 5-min candle breakout (skip if range > 3%)
//      "My suggestion is to do it off the 5-minute. It's a lot safer. It's more controlled."
//      Configurable via orbTimeframeMinutes — 5 is Emanuel's default; 1 or 2 = aggressive.
//   2. 1-2-3 Pattern — igniting → doji/resting → trigger
//   3. Retracement to 20MA — 3+ red bars, 40-60% golden zone, bottoming/topping tail
//   4. Base breakout — tight consolidation into 20MA, narrow range bars, entry over base
//   * Failed breakdown/shakeout amplifies any setup to A+ quality
//
// FLEXIBILITY CLAUSE (new transcript):
//   "There are times when the gap is so high quality that I will be flexible with
//   the intraday setup where I'll still take the trade even if it's not A+"
//   → When setup.score >= exceptionalGapScore, relax intraday filters:
//       - Accept R:R as low as flexibilityMinRR (vs 2.0 normally)
//       - Base range max: 2.0% (vs 1.5%)
//       - Retracement golden zone: 20-80% (vs 30-70%)
//       - NRB minimum: 1 (vs 2)
//
// TRADE MANAGEMENT:
//   - At 2:1 R:R → activate 15-min bar-by-bar trail
//   - At 4R → tighten to 5-min bar-by-bar
//   - "Protect 50-60% of daily profits"
//   - Exit at market close (16:00)
//
// RISK MANAGEMENT:
//   - Risk 2% of capital per trade
//   - Daily loss limit: 3-4R — stop trading
//   - Never add to losers
//   - Move stop to breakeven if entry tags but loses momentum

export interface EmanuelParams {
  /**
   * ORB first-candle timeframe in minutes. Emanuel's stated preference is 5-min
   * ("safer, more controlled") per "My Scalping Strategy is BORING" transcript.
   * 1 or 2 = aggressive (he rarely trades these unless in love with the gap).
   * NOTE: intraday bars are 5-min — if set to 1 or 2, ORB is skipped (granularity mismatch).
   */
  orbTimeframeMinutes: 1 | 2 | 5;
  /** Skip ORB if the first candle's range exceeds this % (want narrow-range first candle). */
  orbMaxRangePercent: number;
  /** Minimum setup score to consider the trade at all. */
  minScore: number;
  /** Normal minimum R:R. */
  minRR: number;
  /** When setup.score >= exceptionalGapScore, the flexibility clause kicks in. */
  exceptionalGapScore: number;
  /** Relaxed minimum R:R used when the flexibility clause is active. */
  flexibilityMinRR: number;
  /** Risk per trade as a fraction of capital. */
  riskPercent: number;
  /** Activate bar-by-bar trail at this R:R. */
  trailActivateRR: number;
  /** Tighten trail (15-min → 5-min bars) at this R:R. */
  trailTightenRR: number;
}

export const EMANUEL_DEFAULT_PARAMS: EmanuelParams = {
  orbTimeframeMinutes: 5,
  orbMaxRangePercent: 3,
  minScore: 50,
  minRR: 2.0,
  exceptionalGapScore: 70,
  flexibilityMinRR: 1.5,
  riskPercent: 0.02,
  trailActivateRR: 2,
  trailTightenRR: 4,
};

export function simulateEmanuel(
  setups: StockSetup[],
  capital: number,
  params?: Partial<EmanuelParams>,
): SimResult {
  const p = { ...EMANUEL_DEFAULT_PARAMS, ...params };
  let equity = capital;
  let maxEquity = equity;
  let maxDrawdown = 0;
  const trades: SimulatedTrade[] = [];
  let skippedStocks = 0;
  const skippedReasons: string[] = [];

  // ── ONE AND DONE: Sort by score, trade only the best ──
  const sorted = [...setups].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  // Risk per trade. "Share size = Risk / (Entry - Stop)"
  const maxRisk = capital * p.riskPercent;

  // Intraday bar granularity is 5-min. If the user sets orbTimeframeMinutes to 1 or 2,
  // we can't synthesise a sub-5-min first candle from 5-min bars, so ORB is skipped.
  const orbEnabled = p.orbTimeframeMinutes === 5;

  const FIRST_HOUR_BARS = 12; // entries within first hour only
  let traded = false;

  for (const setup of sorted) {
    if (traded) {
      skippedStocks++;
      skippedReasons.push(`${setup.symbol}: Already traded today (one and done)`);
      continue;
    }

    const { bars, isGapUp, side, gapPercent, symbol } = setup;

    // ══════════════════════════════════════════
    //  MUST-HAVES — all required or skip
    // ══════════════════════════════════════════

    if ((setup.score ?? 0) < p.minScore) {
      skippedStocks++;
      skippedReasons.push(`${symbol}: Score ${setup.score ?? 0} too low (need ${p.minScore}+)`);
      continue;
    }

    // Flexibility clause: "If the gap is so high quality, I'll take the trade even if
    // it's not A+" — score >= exceptionalGapScore unlocks relaxed intraday filters.
    const isExceptional = (setup.score ?? 0) >= p.exceptionalGapScore;
    if (setup.dailyContext === 'other') {
      skippedStocks++;
      skippedReasons.push(`${symbol}: No clear daily context — cannot have`);
      continue;
    }
    if (setup.trendDirection === 'sideways') {
      skippedStocks++;
      skippedReasons.push(`${symbol}: Flat 20MA — no momentum`);
      continue;
    }
    if ((bars[0]?.open ?? 0) < 2) {
      skippedStocks++;
      skippedReasons.push(`${symbol}: Price too low — no penny stocks`);
      continue;
    }
    if (Math.abs(gapPercent) < 5) {
      skippedStocks++;
      skippedReasons.push(`${symbol}: Gap ${gapPercent.toFixed(1)}% too small (need 5%+)`);
      continue;
    }
    if (bars.length < 6) {
      skippedStocks++;
      skippedReasons.push(`${symbol}: Not enough bars`);
      continue;
    }

    // ══════════════════════════════════════════
    //  CANNOT-HAVES — volume/spread proxy check
    // ══════════════════════════════════════════

    // "Spread should be less than 5-10% of stop" / "maximum one penny spread for scalping"
    // Proxy: if first 3 bars have very low volume, liquidity is bad
    const avgVol3 = bars.slice(0, 3).reduce((s, b) => s + b.volume, 0) / 3;
    if (avgVol3 < 5000) {
      skippedStocks++;
      skippedReasons.push(`${symbol}: Very low volume (${Math.round(avgVol3)}) — likely wide spread`);
      continue;
    }

    // ── MAs ──
    const { ma20: resolvedMA20, ma200: resolvedMA200 } = fillMAs(setup);
    const has200MA = resolvedMA200 != null && resolvedMA200 > 0;
    const openPrice = bars[0].open;

    let directionConfirmed = true;
    if (has200MA) {
      if (isGapUp && openPrice < resolvedMA200!) directionConfirmed = false;
      if (!isGapUp && openPrice > resolvedMA200!) directionConfirmed = false;
    }

    // ── Intraday 20-SMA ──
    const closes = bars.map(b => b.close);
    const intraday20MA: (number | null)[] = closes.map((_, i) => sma(closes, i, 20));

    // ══════════════════════════════════════════
    //  FIND TARGET — prior high/low from first-hour bars
    //  "My target was the prior high"
    // ══════════════════════════════════════════

    const searchLimit = Math.min(bars.length, FIRST_HOUR_BARS);

    // Find intraday high/low from bars so far as initial target reference
    let targetPrice: number | null = null;
    if (isGapUp) {
      // Target = highest point reached in first few bars (prior high)
      const firstBarsHigh = Math.max(...bars.slice(0, Math.min(6, bars.length)).map(b => b.high));
      targetPrice = firstBarsHigh;
    } else {
      const firstBarsLow = Math.min(...bars.slice(0, Math.min(6, bars.length)).map(b => b.low));
      targetPrice = firstBarsLow;
    }

    // ══════════════════════════════════════════
    //  ENTRY METHODS — with new quality checks
    // ══════════════════════════════════════════

    let entryPrice: number | null = null;
    let stopLevel: number | null = null;
    let entryBarIndex = -1;
    let entryMethodUsed = '';
    let hasShakeout = false; // Failed breakdown amplifies quality

    // METHOD 1: Opening Range Breakout (skip if range > orbMaxRangePercent, or if ORB disabled)
    const orbBar = bars[0];
    const orbRangePct = (orbBar.high - orbBar.low) / orbBar.open * 100;

    if (orbEnabled && orbRangePct <= p.orbMaxRangePercent) {
      const orbEntry = isGapUp ? orbBar.high : orbBar.low;
      const orbStop = isGapUp ? orbBar.low : orbBar.high;

      for (let i = 1; i < Math.min(searchLimit, 4); i++) {
        if (isGapUp && bars[i].high >= orbEntry) {
          entryPrice = orbEntry; stopLevel = orbStop;
          entryBarIndex = i; entryMethodUsed = 'Opening Range Breakout'; break;
        }
        if (!isGapUp && bars[i].low <= orbEntry) {
          entryPrice = orbEntry; stopLevel = orbStop;
          entryBarIndex = i; entryMethodUsed = 'Opening Range Breakout'; break;
        }
      }
    }

    // METHOD 2: 1-2-3 Pattern — igniting → doji/resting → trigger
    if (entryPrice === null) {
      for (let i = 0; i < searchLimit - 2; i++) {
        const ig = bars[i], re = bars[i + 1], tr = bars[i + 2];

        if (isGapUp && ig.close > ig.open && isMomentumBar(ig) && (isDoji(re) || hasBottomingTail(re))) {
          if (tr.high >= re.high) {
            entryPrice = re.high; stopLevel = re.low;
            entryBarIndex = i + 2; entryMethodUsed = '1-2-3 Pattern'; break;
          }
        }
        if (!isGapUp && ig.close < ig.open && isMomentumBar(ig) && (isDoji(re) || hasToppingTail(re))) {
          if (tr.low <= re.low) {
            entryPrice = re.low; stopLevel = re.high;
            entryBarIndex = i + 2; entryMethodUsed = '1-2-3 Pattern'; break;
          }
        }
      }
    }

    // METHOD 3: Retracement to 20MA — NEW: requires 3 red bars + golden zone
    // "I need three consecutive red bars" + "40-60% retracement zone"
    if (entryPrice === null) {
      for (let i = 5; i < searchLimit; i++) {
        const bar = bars[i];
        const ma = intraday20MA[i];
        if (ma === null) continue;

        // Count consecutive bars against the trend (red for longs, green for shorts)
        let consecutiveCounter = 0;
        for (let j = i; j >= Math.max(0, i - 4); j--) {
          if (isGapUp && bars[j].close < bars[j].open) consecutiveCounter++;
          else if (!isGapUp && bars[j].close > bars[j].open) consecutiveCounter++;
          else break;
        }

        if (consecutiveCounter < 2) continue; // Need at least 2 bars pulling back (relaxed from 3 for 5-min)

        // Check 40-60% retracement of the prior move (golden zone)
        const moveHigh = Math.max(...bars.slice(0, i).map(b => b.high));
        const moveLow = Math.min(...bars.slice(0, i).map(b => b.low));
        const moveRange = moveHigh - moveLow;
        if (moveRange <= 0) continue;

        // Flexibility clause widens the golden zone when the daily gap is exceptional.
        const zoneMin = isExceptional ? 0.2 : 0.3;
        const zoneMax = isExceptional ? 0.8 : 0.7;

        if (isGapUp) {
          const retraceDepth = (moveHigh - bar.low) / moveRange;
          if (retraceDepth < zoneMin || retraceDepth > zoneMax) continue; // Not in golden zone

          const touchedMA = bar.low <= ma * 1.005;
          const priceAboveMA = bar.close > ma;
          if (touchedMA && priceAboveMA && (hasBottomingTail(bar) || isDoji(bar))) {
            // Check for shakeout amplification
            if (bar.low < moveLow * 1.01 && bar.close > moveLow) hasShakeout = true;
            entryPrice = bar.close; stopLevel = bar.low;
            entryBarIndex = i;
            entryMethodUsed = isExceptional
              ? 'Retracement to 20MA (golden zone, flex)'
              : 'Retracement to 20MA (golden zone)';
            break;
          }
        } else {
          const retraceDepth = (bar.high - moveLow) / moveRange;
          if (retraceDepth < zoneMin || retraceDepth > zoneMax) continue;

          const touchedMA = bar.high >= ma * 0.995;
          const priceBelowMA = bar.close < ma;
          if (touchedMA && priceBelowMA && (hasToppingTail(bar) || isDoji(bar))) {
            if (bar.high > moveHigh * 0.99 && bar.close < moveHigh) hasShakeout = true;
            entryPrice = bar.close; stopLevel = bar.high;
            entryBarIndex = i;
            entryMethodUsed = isExceptional
              ? 'Retracement to 20MA (golden zone, flex)'
              : 'Retracement to 20MA (golden zone)';
            break;
          }
        }
      }
    }

    // METHOD 4: Base breakout into 20MA — NEW: tight base check + NRB requirement
    // "Tight consolidation. Not sloppy. Narrow range bars."
    if (entryPrice === null) {
      for (let i = 4; i < searchLimit; i++) {
        const ma = intraday20MA[i];
        if (ma === null || i + 1 >= bars.length) continue;

        const baseBars = bars.slice(Math.max(0, i - 3), i + 1);
        const baseHigh = Math.max(...baseBars.map(b => b.high));
        const baseLow = Math.min(...baseBars.map(b => b.low));
        const baseRange = (baseHigh - baseLow) / baseLow * 100;

        // Base must be tight (< 1.5% range, or 2.0% when flexibility is active) with NRBs
        const maxBaseRange = isExceptional ? 2.0 : 1.5;
        if (baseRange > maxBaseRange) continue;

        // Check for narrow range bars (body < 40% of range for most bars)
        const nrbCount = baseBars.filter(b => {
          const r = b.high - b.low;
          return r > 0 && Math.abs(b.close - b.open) / r < 0.4;
        }).length;
        const minNrbCount = isExceptional ? 1 : 2;
        if (nrbCount < minNrbCount) continue;

        // Check for shakeout (bottoming tail breaking below base then recovering)
        const shakeoutBar = baseBars.find(b => b.low < baseLow * 0.998 && b.close > baseLow);
        if (shakeoutBar) hasShakeout = true;

        const nextBar = bars[i + 1];
        if (isGapUp && Math.abs(baseLow - ma) / ma < 0.01 && nextBar.high > baseHigh) {
          entryPrice = baseHigh; stopLevel = hasShakeout ? Math.min(baseLow, shakeoutBar?.low ?? baseLow) : baseLow;
          entryBarIndex = i + 1; entryMethodUsed = hasShakeout ? 'Base breakout + shakeout (A+)' : 'Base breakout into 20MA'; break;
        }
        if (!isGapUp && Math.abs(baseHigh - ma) / ma < 0.01 && nextBar.low < baseLow) {
          entryPrice = baseLow; stopLevel = hasShakeout ? Math.max(baseHigh, shakeoutBar?.high ?? baseHigh) : baseHigh;
          entryBarIndex = i + 1; entryMethodUsed = hasShakeout ? 'Base breakout + shakeout (A+)' : 'Base breakout into 20MA'; break;
        }
      }
    }

    if (entryPrice === null || stopLevel === null) {
      skippedStocks++;
      skippedReasons.push(`${symbol}: No setup in first hour — Emanuel passes`);
      continue;
    }

    const riskPerShare = Math.abs(entryPrice - stopLevel);
    if (riskPerShare <= 0) {
      skippedStocks++;
      skippedReasons.push(`${symbol}: Zero risk on entry`);
      continue;
    }

    // ══════════════════════════════════════════
    //  R:R CHECK — "less than 2:1 = cannot take"
    // ══════════════════════════════════════════

    if (targetPrice !== null) {
      const potentialReward = isGapUp
        ? targetPrice - entryPrice
        : entryPrice - targetPrice;
      const potentialRR = potentialReward / riskPerShare;

      // Flexibility clause: exceptional gap lets Emanuel accept a lower R:R
      const rrFloor = isExceptional ? p.flexibilityMinRR : p.minRR;
      if (potentialRR < rrFloor) {
        skippedStocks++;
        skippedReasons.push(`${symbol}: R:R ${potentialRR.toFixed(1)}:1 < ${rrFloor}:1 minimum — cannot take`);
        continue;
      }
    }

    // ══════════════════════════════════════════
    //  POSITION SIZING: "Share size = Risk / (Entry - Stop)"
    // ══════════════════════════════════════════

    const shares = Math.floor(maxRisk / riskPerShare);
    if (shares <= 0) {
      skippedStocks++;
      skippedReasons.push(`${symbol}: Stop too wide for capital`);
      continue;
    }

    // ══════════════════════════════════════════
    //  TRADE MANAGEMENT — full day bar-by-bar trail
    // ══════════════════════════════════════════

    let exitPrice: number | null = null;
    let exitReason: SimulatedTrade['exitReason'] = 'end_of_day';
    let trailingStop = stopLevel;
    let trailingActive = false;
    let tightTrailActive = false;
    let barsSinceLastTrailUpdate = 0;

    // Track daily high water mark for "protect 50-60% of profits" rule
    let bestPnlSoFar = 0;

    for (let i = entryBarIndex; i < bars.length; i++) {
      const bar = bars[i];

      // Check stop / trailing stop
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

      // 200MA as resistance/support exit
      if (has200MA && !directionConfirmed) {
        if (isGapUp && bar.high >= resolvedMA200!) {
          exitPrice = resolvedMA200!; exitReason = 'take_profit'; break;
        }
        if (!isGapUp && bar.low <= resolvedMA200!) {
          exitPrice = resolvedMA200!; exitReason = 'take_profit'; break;
        }
      }

      const currentPnl = isGapUp ? bar.close - entryPrice : entryPrice - bar.close;
      const currentRR = currentPnl / riskPerShare;

      // Track best P/L for profit protection rule
      const currentPnlDollar = currentPnl * shares;
      if (currentPnlDollar > bestPnlSoFar) bestPnlSoFar = currentPnlDollar;

      // "Protect 50-60% of daily profits" — if we've been up big and now giving back
      if (bestPnlSoFar > maxRisk * 2 && currentPnlDollar < bestPnlSoFar * 0.5) {
        exitPrice = bar.close;
        exitReason = 'take_profit';
        break;
      }

      // Activate 15-min bar-by-bar trail at trailActivateRR
      if (!trailingActive && currentRR >= p.trailActivateRR) {
        trailingActive = true;
        barsSinceLastTrailUpdate = 0;
      }

      // Tighten to 5-min at trailTightenRR
      if (trailingActive && !tightTrailActive && currentRR >= p.trailTightenRR) {
        tightTrailActive = true;
        barsSinceLastTrailUpdate = 0;
      }

      if (trailingActive) {
        barsSinceLastTrailUpdate++;
        const interval = tightTrailActive ? 1 : 3;
        if (barsSinceLastTrailUpdate >= interval) {
          barsSinceLastTrailUpdate = 0;
          if (isGapUp) { if (bar.low > trailingStop) trailingStop = bar.low; }
          else { if (bar.high < trailingStop) trailingStop = bar.high; }
        }
      }
    }

    if (exitPrice === null) {
      exitPrice = bars[bars.length - 1].close;
      exitReason = 'end_of_day';
    }

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

    traded = true;
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
    entryMethod: 'One-and-Done: ORB → 1-2-3 → 20MA Golden Zone Retracement → Tight Base Breakout + Bar-by-Bar Trail',
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

/** Aggregate daily bars into weekly bars, keyed by the Monday of each week. */
function resampleToWeekly(dailyBars: BarData[]): BarData[] {
  const byWeek = new Map<string, BarData[]>();
  for (const bar of dailyBars) {
    const d = new Date(bar.timestamp);
    // Monday of this week (UTC). getUTCDay(): Sun=0..Sat=6. Shift so Mon=0.
    const weekdayFromMon = (d.getUTCDay() + 6) % 7;
    const monday = new Date(d);
    monday.setUTCDate(d.getUTCDate() - weekdayFromMon);
    const key = monday.toISOString().split('T')[0];
    const arr = byWeek.get(key);
    if (arr) arr.push(bar); else byWeek.set(key, [bar]);
  }
  const keys = [...byWeek.keys()].sort();
  return keys.map((k) => {
    const w = byWeek.get(k)!;
    w.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return {
      timestamp: w[0].timestamp,
      open: w[0].open,
      close: w[w.length - 1].close,
      high: Math.max(...w.map((b) => b.high)),
      low: Math.min(...w.map((b) => b.low)),
      volume: w.reduce((s, b) => s + b.volume, 0),
    };
  });
}

/** Aggregate daily bars into monthly bars, keyed by YYYY-MM. */
function resampleToMonthly(dailyBars: BarData[]): BarData[] {
  const byMonth = new Map<string, BarData[]>();
  for (const bar of dailyBars) {
    const d = new Date(bar.timestamp);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const arr = byMonth.get(key);
    if (arr) arr.push(bar); else byMonth.set(key, [bar]);
  }
  const keys = [...byMonth.keys()].sort();
  return keys.map((k) => {
    const m = byMonth.get(k)!;
    m.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return {
      timestamp: m[0].timestamp,
      open: m[0].open,
      close: m[m.length - 1].close,
      high: Math.max(...m.map((b) => b.high)),
      low: Math.min(...m.map((b) => b.low)),
      volume: m.reduce((s, b) => s + b.volume, 0),
    };
  });
}

/**
 * Build DMC body-pivot levels from any bar series. Each pivot (swing high or low)
 * contributes both body-open AND body-close as separate levels when
 * includeBothSides is true (per transcript 16). Otherwise uses the body extreme.
 */
function buildBodyPivotLevels(
  bars: BarData[],
  lookback: number,
  includeBothSides: boolean,
): number[] {
  const out: number[] = [];
  if (bars.length < lookback * 2 + 1) return out;
  for (let i = lookback; i < bars.length - lookback; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = 1; j <= lookback; j++) {
      if (bars[i - j].high > bars[i].high || bars[i + j].high > bars[i].high) isHigh = false;
      if (bars[i - j].low < bars[i].low || bars[i + j].low < bars[i].low) isLow = false;
    }
    if (!isHigh && !isLow) continue;
    const b = bars[i];
    if (includeBothSides) {
      out.push(b.open, b.close);
    } else {
      if (isHigh) out.push(Math.max(b.open, b.close));
      if (isLow) out.push(Math.min(b.open, b.close));
    }
  }
  return out;
}

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
  /** Max trades per day across all authors — hard cap on Claude's risk deployment. */
  maxTradesPerDay: number;
  /** Max daily loss as % of capital. When hit, no new trades today. */
  maxDailyLossPercent: number;
  /** Minimum conviction (# of authors agreeing) to take a trade. 1 = take any single signal. */
  minConviction: number;
  /** When 2+ authors agree, how much to prefer that trade over a single-author signal. */
  convictionBonus: number;
  /**
   * Legacy fields — retained for back-compat with the optimiser and older calls.
   * The blend engine ignores these because sizing/management is now delegated
   * to each contributing sub-engine.
   */
  entryWindowBars: number;
  trailActivateRR: number;
  partialProfitRR: number;
  partialProfitPercent: number;
  eodTightenBar: number;
}

export const CLAUDE_DEFAULT_PARAMS: ClaudeParams = {
  maxTradesPerDay: 3,
  maxDailyLossPercent: 6,
  minConviction: 1,
  convictionBonus: 10,
  // Legacy — unused by blend, kept so optimiser & existing call-sites still compile
  entryWindowBars: 24,
  trailActivateRR: 1.5,
  partialProfitRR: 2.0,
  partialProfitPercent: 50,
  eodTightenBar: 72,
};

// ═══════════════════════════════════════════════════════════════
//  CLAUDE'S ENGINE — Author Blend / Meta-Allocator
// ═══════════════════════════════════════════════════════════════
//
// Claude no longer runs its own entry detection. It orchestrates the other
// author engines and picks the best ex-ante setups across all of them.
//
// FLOW (per day):
//   1. Run Emanuel, Dumb Hunter, ProRealAlgos, and Fabio on the same setups.
//   2. Collect every resulting trade, tagged with its originating author.
//   3. Group by (symbol, direction). CONVICTION = # distinct authors agreeing.
//   4. For each symbol, pick the best trade:
//        - Highest conviction wins
//        - Tiebreak 1: highest gap score (setup.score)
//        - Tiebreak 2: earliest entry timestamp
//   5. Sort picks by a blended rank (conviction * convictionBonus + gapScore).
//   6. Apply Claude's overlay:
//        - Stop at maxTradesPerDay
//        - Stop if cumulative losses exceed maxDailyLossPercent of capital
//
// Each kept trade uses the originating engine's own position sizing and
// management (partial profits, trailing, EOD tightening). Claude is a
// meta-allocator: it picks WHICH engine's playbook to follow for each stock,
// not the specific entries/exits — those are borrowed from the underlying
// author that produced the signal.
//
// Why: the individual author edges (ORB manipulation, DMC reclaim, gap
// scalp 1-2-3, absorption momentum) catch different regimes. A single-
// author engine misses setups that belong to another's wheelhouse. The
// blend lets Claude be regime-adaptive without hand-coding a regime detector.

export function simulateClaude(
  setups: StockSetup[],
  capital: number,
  params?: Partial<ClaudeParams>,
): SimResult {
  const p = { ...CLAUDE_DEFAULT_PARAMS, ...params };
  let equity = capital;
  let maxEquity = equity;
  let maxDrawdown = 0;
  const trades: SimulatedTrade[] = [];
  const skippedReasons: string[] = [];
  let skippedStocks = 0;

  if (setups.length === 0) {
    return {
      trades: [], totalPnl: 0, winRate: 0, maxDrawdown: 0, finalEquity: equity,
      entryMethod: 'Blend: no setups to evaluate',
      skippedStocks: 0, skippedReasons: [],
    };
  }

  // Run each author on the full setup list. Wrapped in try/catch so one
  // misbehaving engine can't take down the blend.
  const runEngine = (name: string, fn: () => SimResult): { engine: string; trades: SimulatedTrade[] } => {
    try {
      const r = fn();
      return { engine: name, trades: r.trades };
    } catch (err: any) {
      skippedReasons.push(`[blend] ${name} engine failed: ${err?.message ?? err}`);
      return { engine: name, trades: [] };
    }
  };

  const emanuelResult = runEngine('Emanuel', () => simulateEmanuel(setups, capital));
  const dumbHunterResult = runEngine('DumbHunter', () => simulateDumbHunter(setups, capital));
  const proRealResult = runEngine('ProRealAlgos', () => simulateProRealAlgos(setups, capital));
  const fabioResult = runEngine('Fabio', () => simulateFabio(setups, capital));

  // Flatten all candidate trades, tagged with their originating engine.
  type Candidate = { engine: string; trade: SimulatedTrade; score: number };
  const candidates: Candidate[] = [];
  const scoreBySymbol = new Map<string, number>();
  for (const s of setups) scoreBySymbol.set(s.symbol, s.score ?? 0);

  const pushAll = (engine: string, ts: SimulatedTrade[]) => {
    for (const t of ts) {
      if (!t.symbol) continue;
      candidates.push({ engine, trade: t, score: scoreBySymbol.get(t.symbol) ?? 0 });
    }
  };
  pushAll(emanuelResult.engine, emanuelResult.trades);
  pushAll(dumbHunterResult.engine, dumbHunterResult.trades);
  pushAll(proRealResult.engine, proRealResult.trades);
  pushAll(fabioResult.engine, fabioResult.trades);

  if (candidates.length === 0) {
    return {
      trades: [], totalPnl: 0, winRate: 0, maxDrawdown: 0, finalEquity: equity,
      entryMethod: 'Blend: no author found a tradable setup',
      skippedStocks: setups.length,
      skippedReasons: ['All authors passed on every setup'],
    };
  }

  // Group by (symbol, direction). Conviction = # distinct engines agreeing.
  type Group = {
    symbol: string;
    side: 'buy' | 'sell';
    engines: Set<string>;
    best: Candidate;
  };
  const groupKey = (symbol: string, side: string) => `${symbol}::${side}`;
  const groups = new Map<string, Group>();

  for (const c of candidates) {
    const key = groupKey(c.trade.symbol!, c.trade.side);
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        symbol: c.trade.symbol!,
        side: c.trade.side,
        engines: new Set([c.engine]),
        best: c,
      });
      continue;
    }
    existing.engines.add(c.engine);
    // Tiebreak among candidates within the same group: prefer highest gap score,
    // then earliest entry (ex-ante — NOT by pnl, to avoid hindsight bias).
    const existingDate = new Date(existing.best.trade.date).getTime();
    const newDate = new Date(c.trade.date).getTime();
    if (c.score > existing.best.score
      || (c.score === existing.best.score && newDate < existingDate)) {
      existing.best = c;
    }
  }

  // If the same symbol has long AND short signals from different authors,
  // that's a contradictory read → skip it.
  const symbolDirections = new Map<string, Set<string>>();
  for (const g of groups.values()) {
    if (!symbolDirections.has(g.symbol)) symbolDirections.set(g.symbol, new Set());
    symbolDirections.get(g.symbol)!.add(g.side);
  }
  const contested = new Set<string>();
  for (const [sym, dirs] of symbolDirections) {
    if (dirs.size > 1) contested.add(sym);
  }

  // Build the pick list: filter contested symbols and below-conviction groups.
  const picks = [...groups.values()]
    .filter((g) => {
      if (contested.has(g.symbol)) {
        skippedReasons.push(`${g.symbol}: Conflicting long/short signals — blend passes`);
        return false;
      }
      if (g.engines.size < p.minConviction) {
        skippedReasons.push(`${g.symbol}: Conviction ${g.engines.size} < min ${p.minConviction}`);
        return false;
      }
      return true;
    })
    .map((g) => ({
      ...g,
      rank: g.engines.size * p.convictionBonus + g.best.score,
    }))
    .sort((a, b) => b.rank - a.rank);

  // Apply Claude's overlay: max trades/day, daily loss cap.
  const maxDailyLoss = capital * (p.maxDailyLossPercent / 100);
  let dailyLoss = 0;
  let taken = 0;

  for (const pick of picks) {
    if (taken >= p.maxTradesPerDay) {
      skippedStocks++;
      skippedReasons.push(`${pick.symbol}: Max ${p.maxTradesPerDay} trades/day reached (skipped conviction ${pick.engines.size})`);
      continue;
    }
    if (dailyLoss >= maxDailyLoss) {
      skippedStocks++;
      skippedReasons.push(`${pick.symbol}: Daily loss cap hit ($${dailyLoss.toFixed(0)}/$${maxDailyLoss.toFixed(0)})`);
      continue;
    }

    const t = pick.best.trade;
    trades.push({
      ...t,
      // stamp with blend diagnostics in exitReason only if originating engine
      // didn't set one — otherwise preserve the sub-engine's reason.
      exitReason: t.exitReason,
      // equity is recomputed below so pass through the original equityAfter is fine
      equityAfter: t.equityAfter,
    });

    equity += t.pnl;
    maxEquity = Math.max(maxEquity, equity);
    const dd = ((maxEquity - equity) / maxEquity) * 100;
    maxDrawdown = Math.max(maxDrawdown, dd);
    if (t.pnl < 0) dailyLoss += Math.abs(t.pnl);
    taken++;
  }

  const wins = trades.filter((t) => t.pnl > 0).length;
  const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;
  const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);

  // Summary of author contribution for diagnostics.
  const byEngine: Record<string, number> = {};
  for (const pick of picks.slice(0, taken)) {
    byEngine[pick.best.engine] = (byEngine[pick.best.engine] ?? 0) + 1;
  }
  const contribBreakdown = Object.entries(byEngine)
    .map(([e, n]) => `${e}×${n}`)
    .join(', ') || 'none';

  return {
    trades,
    totalPnl,
    winRate,
    maxDrawdown,
    finalEquity: equity,
    entryMethod: `Author Blend — picked ${taken}/${picks.length} signals across Emanuel+DumbHunter+ProRealAlgos+Fabio (${contribBreakdown})`,
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

// ═══════════════════════════════════════════════════════════════
//  PROREALALGOS ENGINE — Quick Flip Scalper
// ═══════════════════════════════════════════════════════════════
//
// Carl's "ONE CANDLE" strategy:
// 1. Box first 15-min candle (= first 3 x 5-min bars)
// 2. Confirm manipulation: box range >= 25% of daily ATR(14)
// 3. Look for reversal candle OUTSIDE box on 5-min within 90 min:
//    - Green open → bearish reversal ABOVE box (inverted hammer / bearish engulfing)
//    - Red open → bullish reversal BELOW box (hammer / bullish engulfing)
// 4. Entry on break of reversal candle, stop at extreme
// 5. Target: opposite side of the box

/** Check if a bar is a hammer (long lower wick, body in upper third). */
function isHammer(bar: BarData): boolean {
  const range = bar.high - bar.low;
  if (range <= 0) return false;
  const lowerWick = Math.min(bar.open, bar.close) - bar.low;
  const body = Math.abs(bar.close - bar.open);
  return lowerWick / range >= 0.5 && body / range <= 0.35;
}

/** Check if a bar is an inverted hammer (long upper wick, body in lower third). */
function isInvertedHammer(bar: BarData): boolean {
  const range = bar.high - bar.low;
  if (range <= 0) return false;
  const upperWick = bar.high - Math.max(bar.open, bar.close);
  const body = Math.abs(bar.close - bar.open);
  return upperWick / range >= 0.5 && body / range <= 0.35;
}

/** Check if bar B is a bullish engulfing of bar A (green B fully engulfs red A). */
function isBullishEngulfing(a: BarData, b: BarData): boolean {
  const aRed = a.close < a.open;
  const bGreen = b.close > b.open;
  return aRed && bGreen && b.close > a.open && b.open <= a.close;
}

/** Check if bar B is a bearish engulfing of bar A (red B fully engulfs green A). */
function isBearishEngulfing(a: BarData, b: BarData): boolean {
  const aGreen = a.close > a.open;
  const bRed = b.close < b.open;
  return aGreen && bRed && b.close < a.open && b.open >= a.close;
}

export function simulateProRealAlgos(
  setups: StockSetup[],
  capital: number,
  longOnly = false,
): SimResult {
  let equity = capital;
  let maxEquity = equity;
  let maxDrawdown = 0;
  const trades: SimulatedTrade[] = [];
  let skippedStocks = 0;
  const skippedReasons: string[] = [];

  // Risk 2% of capital per trade — Carl trades ONE setup per day
  const RISK_PERCENT = 0.02;
  const maxRisk = capital * RISK_PERCENT;

  // 90 min = 18 x 5-min bars from open
  const MAX_ENTRY_BARS = 18;

  // ── Pre-score setups by manipulation candle strength ──
  // Carl picks the single best manipulation candle. Sort by box range / ATR ratio.
  const scored: Array<{ setup: StockSetup; manipScore: number }> = [];
  for (const setup of setups) {
    const dailyBars = setup.dailyBars;
    const bars = setup.bars.filter(b => (b.high - b.low) > 0.001 || b.volume > 1000);
    let marketBars = bars;
    if (bars.length > 3 && bars[0].high - bars[0].low < 0.01) {
      const firstReal = bars.findIndex(b => b.high - b.low > 0.01);
      if (firstReal > 0) marketBars = bars.slice(firstReal);
    }
    if (marketBars.length < 6) continue;

    const orbBars = marketBars.slice(0, 3);
    const boxRange = Math.max(...orbBars.map(b => b.high)) - Math.min(...orbBars.map(b => b.low));
    if (boxRange <= 0) continue;

    let atr14: number | null = null;
    if (dailyBars && dailyBars.length >= 14) {
      atr14 = dailyBars.slice(-14).reduce((s, b) => s + (b.high - b.low), 0) / 14;
    }
    // Manipulation score = box range as % of ATR (higher = stronger manipulation)
    const manipScore = atr14 ? boxRange / atr14 : 0;
    if (manipScore >= 0.25) { // Must pass 25% ATR threshold
      scored.push({ setup, manipScore });
    }
  }

  // Sort by strongest manipulation candle first — Carl picks the BEST one
  scored.sort((a, b) => b.manipScore - a.manipScore);

  let traded = false;

  for (const { setup } of scored) {
    // ONE trade per day — Carl: "I will trade this today on an individual stock"
    if (traded) {
      skippedStocks++;
      skippedReasons.push(`${setup.symbol}: Already traded today (one per day)`);
      continue;
    }
    const { gapPercent, symbol, dailyBars } = setup;

    // Filter to market hours only (9:30 ET = 14:30 UTC, or 13:30 UTC during DST)
    // Remove pre-market bars that have tiny/zero ranges (single prints)
    const bars = setup.bars.filter(b => {
      const range = b.high - b.low;
      // Keep bars with real trading range, or if bar time is clearly in market hours
      // Pre-market prints typically have open=high=low=close (range 0) or very small range
      return range > 0.001 || b.volume > 1000;
    });

    // If first bar still looks like pre-market (zero range), try skipping to first real bar
    let marketBars = bars;
    if (bars.length > 3 && bars[0].high - bars[0].low < 0.01) {
      // Find first bar with meaningful range
      const firstReal = bars.findIndex(b => b.high - b.low > 0.01);
      if (firstReal > 0) {
        marketBars = bars.slice(firstReal);
      }
    }

    if (marketBars.length < 6) {
      skippedStocks++;
      skippedReasons.push(`${symbol}: Not enough market-hours bars`);
      continue;
    }

    // ── STEP 1: Box the opening range (first 3 x 5-min bars = 15 min) ──
    const orbBars = marketBars.slice(0, 3);
    const boxHigh = Math.max(...orbBars.map(b => b.high));
    const boxLow = Math.min(...orbBars.map(b => b.low));
    const boxRange = boxHigh - boxLow;

    if (boxRange <= 0) {
      skippedStocks++;
      skippedReasons.push(`${symbol}: Zero opening range`);
      continue;
    }

    // Opening candle direction (aggregate of first 3 bars)
    const openPrice = orbBars[0].open;
    const closeAfter15min = orbBars[2].close;
    const isGreenOpen = closeAfter15min > openPrice;

    // Long only: green open = short trade, so skip it
    if (longOnly && isGreenOpen) {
      skippedStocks++;
      skippedReasons.push(`${symbol}: Green open → would be short, skipping (long only)`);
      continue;
    }

    // ── STEP 2: Confirm manipulation candle (range >= 25% of ATR14) ──
    let atr14: number | null = null;
    if (dailyBars && dailyBars.length >= 14) {
      const last14 = dailyBars.slice(-14);
      const trueRanges = last14.map(b => b.high - b.low);
      atr14 = trueRanges.reduce((s, r) => s + r, 0) / 14;
    }

    if (atr14 !== null) {
      const threshold = atr14 * 0.25;
      if (boxRange < threshold) {
        skippedStocks++;
        skippedReasons.push(`${symbol}: Opening range ${boxRange.toFixed(2)} < 25% ATR (${threshold.toFixed(2)}) — not a manipulation candle`);
        continue;
      }
    }
    // If no ATR data, still allow (benefit of the doubt)

    // ── STEP 3: Look for reversal candle OUTSIDE the box ──
    const searchLimit = Math.min(marketBars.length, MAX_ENTRY_BARS);
    let entryPrice: number | null = null;
    let stopLevel: number | null = null;
    let entryBarIndex = -1;
    let tradeSide: 'buy' | 'sell' = 'buy';
    let targetPrice: number;

    if (isGreenOpen) {
      // Green open → look for BEARISH reversal ABOVE box
      targetPrice = boxLow; // target opposite side

      for (let i = 3; i < searchLimit - 1; i++) {
        const bar = marketBars[i];
        const prevBar = marketBars[i - 1];

        // Must be ABOVE the box
        if (bar.low <= boxHigh) continue;

        // Check for inverted hammer
        if (isInvertedHammer(bar)) {
          const nextBar = marketBars[i + 1];
          if (nextBar.low <= bar.low) {
            entryPrice = bar.low;
            stopLevel = bar.high;
            entryBarIndex = i + 1;
            tradeSide = 'sell';
            break;
          }
        }

        // Check for bearish engulfing
        if (i > 0 && isBearishEngulfing(prevBar, bar)) {
          entryPrice = prevBar.low;
          stopLevel = bar.high;
          entryBarIndex = i;
          tradeSide = 'sell';
          break;
        }
      }
    } else {
      // Red open → look for BULLISH reversal BELOW box
      targetPrice = boxHigh; // target opposite side

      for (let i = 3; i < searchLimit - 1; i++) {
        const bar = marketBars[i];
        const prevBar = marketBars[i - 1];

        // Must be BELOW the box
        if (bar.high >= boxLow) continue;

        // Check for hammer
        if (isHammer(bar)) {
          const nextBar = marketBars[i + 1];
          if (nextBar.high >= bar.high) {
            entryPrice = bar.high;
            stopLevel = bar.low;
            entryBarIndex = i + 1;
            tradeSide = 'buy';
            break;
          }
        }

        // Check for bullish engulfing
        if (i > 0 && isBullishEngulfing(prevBar, bar)) {
          entryPrice = prevBar.high;
          stopLevel = bar.low;
          entryBarIndex = i;
          tradeSide = 'buy';
          break;
        }
      }
    }

    if (entryPrice === null || stopLevel === null) {
      skippedStocks++;
      skippedReasons.push(`${symbol}: No reversal candle outside box within 90 min`);
      continue;
    }

    const riskPerShare = Math.abs(entryPrice - stopLevel);
    if (riskPerShare <= 0) {
      skippedStocks++;
      skippedReasons.push(`${symbol}: Zero risk on entry`);
      continue;
    }

    // Size based on risk
    const shares = Math.floor(maxRisk / riskPerShare);
    if (shares <= 0) {
      skippedStocks++;
      skippedReasons.push(`${symbol}: Stop too wide for risk budget`);
      continue;
    }

    // ── TRADE MANAGEMENT ──
    let exitPrice: number | null = null;
    let exitReason: SimulatedTrade['exitReason'] = 'end_of_day';

    for (let i = entryBarIndex; i < marketBars.length; i++) {
      const bar = marketBars[i];

      // Check stop loss
      if (tradeSide === 'buy' && bar.low <= stopLevel) {
        exitPrice = stopLevel;
        exitReason = 'stop_loss';
        break;
      }
      if (tradeSide === 'sell' && bar.high >= stopLevel) {
        exitPrice = stopLevel;
        exitReason = 'stop_loss';
        break;
      }

      // Check target (opposite side of box)
      if (tradeSide === 'buy' && bar.high >= targetPrice) {
        exitPrice = targetPrice;
        exitReason = 'take_profit';
        break;
      }
      if (tradeSide === 'sell' && bar.low <= targetPrice) {
        exitPrice = targetPrice;
        exitReason = 'take_profit';
        break;
      }
    }

    if (exitPrice === null) {
      exitPrice = marketBars[marketBars.length - 1].close;
      exitReason = 'end_of_day';
    }

    // P/L
    const multiplier = tradeSide === 'buy' ? 1 : -1;
    const pnlPerShare = (exitPrice - entryPrice) * multiplier;
    const pnlPercent = (pnlPerShare / entryPrice) * 100;
    const pnl = pnlPerShare * shares;

    equity += pnl;
    maxEquity = Math.max(maxEquity, equity);
    const drawdown = ((maxEquity - equity) / maxEquity) * 100;
    maxDrawdown = Math.max(maxDrawdown, drawdown);

    trades.push({
      date: marketBars[0].timestamp,
      symbol,
      entryPrice,
      exitPrice,
      pnl,
      pnlPercent,
      side: tradeSide,
      exitReason,
      shares,
      gapPercent,
      equityAfter: equity,
    });

    traded = true; // One per day
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
    entryMethod: 'Quick Flip Scalper: Box 15-min open → confirm manipulation (25% ATR) → reversal candle outside box → target opposite side',
    skippedStocks,
    skippedReasons,
  };
}

// ═══════════════════════════════════════════════════════════════
//  DUMB HUNTER — Dumb Money Concepts (DMC) Level Reclaim
// ═══════════════════════════════════════════════════════════════
//
// Source: 5 Dumb Hunter transcripts:
//   12 — DMC Gold Strategy (core method, gaining/losing levels)
//   13 — Updated method (precise candle-close entries replace zone averaging)
//   14 — ICT-flagged video (swing-focused; ~80%+ WR on daily/weekly, ~60% intraday)
//   15 — Trend Determination (candle body closes beyond level = trend continuation)
//   16 — Identifying Levels (standard, pass-through, skipping/jumping levels)
//
// CORE THESIS — "All you need to know is how price reacts to the levels of
// the candle bodies." Two-direction mechanics:
//
//   R1. FAIL-TO-LOSE-A-LEVEL → must retest then continue the other way.
//       ("After you failed to lose a level, what we must do is retest it.")
//   R2. FAIL NEW HIGH / FAIL NEW LOW → must travel to the opposite side.
//   R3. REGAIN A LOST ZONE → travel to the opposite side of that move.
//   R4. TREND CONTINUATION → candle body CLOSES beyond a new level →
//       come back, retest that gained level, continue.
//
// LEVELS are candle-body opens AND closes at pivot points. Three categories
// per transcript 16:
//   • Standard: body-open AND body-close of the pivot bar (BOTH sides exist).
//   • Pass-through: when a recent bar is very wide (FVG-like), use older
//     bars' body levels as alternative retest targets. These weaken with age.
//   • Skipping/jumping: high-volatility moves may skip nearby levels and
//     retest a further, more significant one instead.
//   Draw a ZONE of several levels — you don't know which one price will
//   pick; place orders across the zone.
//
// FRACTAL: Monthly/weekly/daily most significant; intraday below. "Larger
// fractals override smaller." Author explicitly prefers SWING (daily/weekly/
// monthly setups, hourly for context) — "don't use anything lower than
// hourly" for the 80%+ WR version. Day-trading version runs ~60% WR.
//
// ENTRY (updated method, transcript 13):
//   Precise 5-min candle close that re-enters the lost level. No averaging.
//   Long: prev close below level, current close above level → buy at close.
//   Short: mirror. Can scale in: blind entry at the level, then add on the
//   retest-confirmation close.
//
// STOP: "Don't lose that back wick" — reclaim candle's low (longs) / high
// (shorts).
//
// TARGET: Next significant level in the direction of the reclaim. Already-
// tested levels are preferred. "If scared, exit early. If confident, it
// should break."
//
// EXAMPLE RESULT (transcript 14): $5k → $96k swing-trading gold in ~3 months,
// tracked on live stream.
//
// BACKTEST CAVEAT: This engine runs on 5-min intraday bars (day-trading
// regime) which is explicitly the LOWER-WR mode (~60%). Expect worse
// results than the author's swing claims. The swing edge is outside the
// current backtest's intraday scope.

export interface DumbHunterParams {
  /** Bars either side of a pivot to confirm a swing high/low on dailyBars. */
  pivotLookback: number;
  /** Minimum reward:risk from reclaim close to next level. */
  minRR: number;
  /** Merge levels closer than this fraction (0.003 = 0.3%) — dedupe near-identical pivots. */
  levelMergeTolerance: number;
  /** Ignore levels closer than this % from the reclaim close (noise). */
  minLevelDistancePercent: number;
  /** Ignore levels farther than this % from the reclaim close (unreachable). */
  maxLevelDistancePercent: number;
  /** Scan window for reclaim signals in 5-min bars (78 = full session). */
  entryWindowBars: number;
  /** Exit at this bar index if still open (76 = 10 min before close on 5-min bars). */
  eodExitBar: number;
  /** Risk per trade as fraction of capital. */
  riskPercent: number;
  /** One trade per symbol per day. */
  maxTradesPerSymbol: number;
  /**
   * Per transcript 16: both sides of a candle body are valid levels. When true,
   * each pivot bar contributes BOTH its body-open AND body-close as levels
   * (instead of only the body extreme).
   */
  includeBothBodySides: boolean;
  /**
   * Per transcript 16: a "pass-through level" comes from older data when a
   * recent wide candle can't be retested normally. When a daily bar's range
   * exceeds passThroughWideRangeMultiple × trailing-average range, we add
   * body levels from the preceding `passThroughLookback` bars as fallback
   * retest targets. Set to 0 to disable.
   */
  passThroughLookback: number;
  /** A daily bar is "wide" if its range exceeds this multiple of the 20-bar avg range. */
  passThroughWideRangeMultiple: number;
  /**
   * Include WEEKLY pivot body-levels in the zone. Weekly bars are resampled
   * from daily bars (Mon-Fri OHLC aggregation). Author ranks weekly > daily
   * ("super critical"), so these levels are top-priority retest targets.
   */
  useWeeklyLevels: boolean;
  /** Include MONTHLY pivot body-levels — highest priority per the author's hierarchy. */
  useMonthlyLevels: boolean;
  /** Pivot lookback for weekly/monthly bars (smaller since HTF series is shorter). */
  htfPivotLookback: number;
}

export const DUMB_HUNTER_DEFAULT_PARAMS: DumbHunterParams = {
  pivotLookback: 3,
  minRR: 1.5,
  levelMergeTolerance: 0.003, // tightened — transcript 16 wants a zone of many levels, not a line
  minLevelDistancePercent: 0.3,
  maxLevelDistancePercent: 5.0,
  entryWindowBars: 78,
  eodExitBar: 76,
  riskPercent: 0.02,
  maxTradesPerSymbol: 1,
  includeBothBodySides: true,
  passThroughLookback: 10,
  passThroughWideRangeMultiple: 1.8,
  useWeeklyLevels: true,
  useMonthlyLevels: true,
  htfPivotLookback: 2,
};

export function simulateDumbHunter(
  setups: StockSetup[],
  capital: number,
  params?: Partial<DumbHunterParams>,
): SimResult {
  const p = { ...DUMB_HUNTER_DEFAULT_PARAMS, ...params };
  let equity = capital;
  let maxEquity = equity;
  let maxDrawdown = 0;
  const trades: SimulatedTrade[] = [];
  let skippedStocks = 0;
  const skippedReasons: string[] = [];

  for (const setup of setups) {
    const { bars, symbol, dailyBars } = setup;

    if (!dailyBars || dailyBars.length < p.pivotLookback * 2 + 1) {
      skippedStocks++;
      skippedReasons.push(`${symbol}: Insufficient daily bars for pivot detection`);
      continue;
    }
    if (bars.length < 5) {
      skippedStocks++;
      skippedReasons.push(`${symbol}: Not enough intraday bars`);
      continue;
    }

    // ── Build HTF levels across daily + weekly + monthly pivots ──
    // Per transcripts 14 & 16: monthly/weekly are "super critical"; daily is
    // primary; both body-open AND body-close of each pivot are valid levels.
    // We pool levels across all three TFs and dedupe by tolerance.
    const rawLevels: number[] = [];

    // DAILY pivots
    rawLevels.push(...buildBodyPivotLevels(dailyBars, p.pivotLookback, p.includeBothBodySides));

    // WEEKLY pivots (resampled from daily bars)
    if (p.useWeeklyLevels) {
      const weekly = resampleToWeekly(dailyBars);
      rawLevels.push(...buildBodyPivotLevels(weekly, p.htfPivotLookback, p.includeBothBodySides));
    }

    // MONTHLY pivots (resampled from daily bars)
    if (p.useMonthlyLevels) {
      const monthly = resampleToMonthly(dailyBars);
      rawLevels.push(...buildBodyPivotLevels(monthly, p.htfPivotLookback, p.includeBothBodySides));
    }

    // Pass-through levels (transcript 16): when a recent daily bar is very wide,
    // price is unlikely to retest back through its own body — so older bars'
    // body levels become retest candidates instead. Age-weighted: older = weaker.
    if (p.passThroughLookback > 0 && dailyBars.length >= 20) {
      const avgRange = dailyBars.slice(-20).reduce((s, b) => s + (b.high - b.low), 0) / 20;
      const wideThreshold = avgRange * p.passThroughWideRangeMultiple;
      for (let i = Math.max(p.passThroughLookback, dailyBars.length - 5); i < dailyBars.length; i++) {
        const cur = dailyBars[i];
        if ((cur.high - cur.low) <= wideThreshold) continue;
        const lookStart = Math.max(0, i - p.passThroughLookback);
        for (let k = lookStart; k < i; k++) {
          const b = dailyBars[k];
          rawLevels.push(b.open, b.close);
        }
      }
    }

    if (rawLevels.length === 0) {
      skippedStocks++;
      skippedReasons.push(`${symbol}: No HTF levels detected`);
      continue;
    }

    // Dedupe: merge levels within tolerance
    const sorted = [...rawLevels].sort((a, b) => a - b);
    const levels: number[] = [];
    for (const lv of sorted) {
      const last = levels[levels.length - 1];
      if (last === undefined || (lv - last) / Math.max(last, 0.0001) > p.levelMergeTolerance) {
        levels.push(lv);
      }
    }

    // ── Scan intraday for a reclaim signal ──
    let entryPrice: number | null = null;
    let stopLevel: number | null = null;
    let targetPrice: number | null = null;
    let entryBarIndex = -1;
    let side: 'buy' | 'sell' = 'buy';
    let reclaimedLevel = 0;

    const searchLimit = Math.min(bars.length, p.entryWindowBars);
    outer: for (let i = 1; i < searchLimit; i++) {
      const prev = bars[i - 1];
      const bar = bars[i];

      for (const lv of levels) {
        const distancePct = Math.abs(bar.close - lv) / lv * 100;
        if (distancePct < p.minLevelDistancePercent || distancePct > p.maxLevelDistancePercent) continue;

        // LONG reclaim: prev close below level, current close above level
        if (prev.close < lv && bar.close > lv) {
          const aboveLevels = levels.filter((x) => x > bar.close);
          if (aboveLevels.length === 0) continue;
          const tgt = aboveLevels[0];
          const risk = bar.close - bar.low;
          const reward = tgt - bar.close;
          if (risk <= 0) continue;
          if (reward / risk < p.minRR) continue;

          entryPrice = bar.close;
          stopLevel = bar.low;
          targetPrice = tgt;
          entryBarIndex = i;
          side = 'buy';
          reclaimedLevel = lv;
          break outer;
        }

        // SHORT reclaim: prev close above level, current close below level
        if (prev.close > lv && bar.close < lv) {
          const belowLevels = levels.filter((x) => x < bar.close);
          if (belowLevels.length === 0) continue;
          const tgt = belowLevels[belowLevels.length - 1];
          const risk = bar.high - bar.close;
          const reward = bar.close - tgt;
          if (risk <= 0) continue;
          if (reward / risk < p.minRR) continue;

          entryPrice = bar.close;
          stopLevel = bar.high;
          targetPrice = tgt;
          entryBarIndex = i;
          side = 'sell';
          reclaimedLevel = lv;
          break outer;
        }
      }
    }

    if (entryPrice === null || stopLevel === null || targetPrice === null) {
      skippedStocks++;
      skippedReasons.push(`${symbol}: No level-reclaim setup found`);
      continue;
    }

    const riskPerShare = Math.abs(entryPrice - stopLevel);
    if (riskPerShare <= 0) {
      skippedStocks++;
      skippedReasons.push(`${symbol}: Zero risk on entry`);
      continue;
    }

    const maxRisk = capital * p.riskPercent;
    const shares = Math.floor(maxRisk / riskPerShare);
    if (shares <= 0) {
      skippedStocks++;
      skippedReasons.push(`${symbol}: Stop too wide for capital`);
      continue;
    }

    // ── Simulate: stop / target / EOD ──
    let exitPrice: number | null = null;
    let exitReason: SimulatedTrade['exitReason'] = 'end_of_day';
    const isLong = side === 'buy';

    const exitLimit = Math.min(bars.length, p.eodExitBar);
    for (let i = entryBarIndex + 1; i < exitLimit; i++) {
      const bar = bars[i];
      if (isLong) {
        if (bar.low <= stopLevel) {
          exitPrice = stopLevel; exitReason = 'stop_loss'; break;
        }
        if (bar.high >= targetPrice) {
          exitPrice = targetPrice; exitReason = 'take_profit'; break;
        }
      } else {
        if (bar.high >= stopLevel) {
          exitPrice = stopLevel; exitReason = 'stop_loss'; break;
        }
        if (bar.low <= targetPrice) {
          exitPrice = targetPrice; exitReason = 'take_profit'; break;
        }
      }
    }
    if (exitPrice === null) {
      exitPrice = bars[Math.min(bars.length - 1, exitLimit - 1)].close;
      exitReason = 'end_of_day';
    }

    const multiplier = isLong ? 1 : -1;
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
      gapPercent: setup.gapPercent,
      equityAfter: equity,
    });
    // Reference so it isn't flagged unused — supports future diagnostics.
    void reclaimedLevel;
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
    entryMethod: 'DMC Level Reclaim: close back into lost HTF level → target next level → stop at reclaim-bar extreme',
    skippedStocks,
    skippedReasons,
  };
}

// ═══════════════════════════════════════════════════════════════
//  DUMB HUNTER — SWING SIGNAL GENERATOR
// ═══════════════════════════════════════════════════════════════
//
// Walks a symbol's daily-bar history bar-by-bar and emits a signal every
// time a daily candle closes back into a previously-lost HTF level.
//
// This is the swing counterpart to simulateDumbHunter's intraday entry scan:
//   • Entries on DAILY closes (not 5-min closes)
//   • Stops on the daily bar's extreme (not intraday wick)
//   • Targets = next HTF level up/down
//   • Holds can span many trading days (portfolio sim owns exit logic)
//
// Levels are built INCREMENTALLY — for each candidate day i, levels come
// from bars[0..i-1] only. No lookahead bias.

export interface DumbHunterSwingSignal {
  symbol: string;
  entryDate: string;           // ISO timestamp of the reclaim bar
  entryBarIndex: number;       // index in dailyBars
  side: 'buy' | 'sell';
  entryPrice: number;          // reclaim bar close
  stopLevel: number;           // reclaim bar low (long) / high (short)
  targetPrice: number;         // next HTF level
  reclaimedLevel: number;
  rrPotential: number;
}

export interface DumbHunterSwingParams {
  pivotLookback: number;
  htfPivotLookback: number;
  useWeeklyLevels: boolean;
  useMonthlyLevels: boolean;
  includeBothBodySides: boolean;
  levelMergeTolerance: number;
  /** Ignore levels closer than this % (noise). */
  minLevelDistancePercent: number;
  /** Ignore levels farther than this % (unreachable on swing scale). */
  maxLevelDistancePercent: number;
  /** Minimum R:R from reclaim close to target. */
  minRR: number;
  /** Risk per trade as fraction of capital. */
  riskPercent: number;
  /** Time-stop: close a position after this many trading days with no stop/target hit. */
  maxHoldDays: number;
  /** Max concurrently open positions across the portfolio. */
  maxConcurrentPositions: number;
}

export const DUMB_HUNTER_SWING_DEFAULT_PARAMS: DumbHunterSwingParams = {
  pivotLookback: 3,
  htfPivotLookback: 2,
  useWeeklyLevels: true,
  useMonthlyLevels: true,
  includeBothBodySides: true,
  levelMergeTolerance: 0.003,
  // Swing scale is much wider than intraday — levels can be 5-15% away and still be retests.
  minLevelDistancePercent: 0.3,
  maxLevelDistancePercent: 15.0,
  minRR: 1.5,
  riskPercent: 0.02,
  maxHoldDays: 20,
  maxConcurrentPositions: 5,
};

export function generateDumbHunterSwingSignals(
  symbol: string,
  dailyBars: BarData[],
  startIdx: number,
  params?: Partial<DumbHunterSwingParams>,
): DumbHunterSwingSignal[] {
  const p = { ...DUMB_HUNTER_SWING_DEFAULT_PARAMS, ...params };
  const signals: DumbHunterSwingSignal[] = [];

  const earliest = Math.max(startIdx, p.pivotLookback + 1);
  if (dailyBars.length <= earliest) return signals;

  for (let i = earliest; i < dailyBars.length; i++) {
    // Build level zone from bars strictly before the evaluation bar (anti-lookahead).
    const prior = dailyBars.slice(0, i);
    if (prior.length < p.pivotLookback * 2 + 1) continue;

    const raw: number[] = [];
    raw.push(...buildBodyPivotLevels(prior, p.pivotLookback, p.includeBothBodySides));
    if (p.useWeeklyLevels) {
      raw.push(...buildBodyPivotLevels(resampleToWeekly(prior), p.htfPivotLookback, p.includeBothBodySides));
    }
    if (p.useMonthlyLevels) {
      raw.push(...buildBodyPivotLevels(resampleToMonthly(prior), p.htfPivotLookback, p.includeBothBodySides));
    }
    if (raw.length === 0) continue;

    const sorted = [...raw].sort((a, b) => a - b);
    const levels: number[] = [];
    for (const lv of sorted) {
      const last = levels[levels.length - 1];
      if (last === undefined || (lv - last) / Math.max(last, 0.0001) > p.levelMergeTolerance) {
        levels.push(lv);
      }
    }

    const prev = dailyBars[i - 1];
    const cur = dailyBars[i];

    for (const lv of levels) {
      const distancePct = Math.abs(cur.close - lv) / lv * 100;
      if (distancePct < p.minLevelDistancePercent || distancePct > p.maxLevelDistancePercent) continue;

      // LONG reclaim
      if (prev.close < lv && cur.close > lv) {
        const above = levels.filter((x) => x > cur.close);
        if (above.length === 0) continue;
        const tgt = above[0];
        const risk = cur.close - cur.low;
        const reward = tgt - cur.close;
        if (risk <= 0) continue;
        const rr = reward / risk;
        if (rr < p.minRR) continue;
        signals.push({
          symbol, entryDate: cur.timestamp, entryBarIndex: i, side: 'buy',
          entryPrice: cur.close, stopLevel: cur.low, targetPrice: tgt,
          reclaimedLevel: lv, rrPotential: rr,
        });
        break; // one signal per day per symbol
      }

      // SHORT reclaim
      if (prev.close > lv && cur.close < lv) {
        const below = levels.filter((x) => x < cur.close);
        if (below.length === 0) continue;
        const tgt = below[below.length - 1];
        const risk = cur.high - cur.close;
        const reward = cur.close - tgt;
        if (risk <= 0) continue;
        const rr = reward / risk;
        if (rr < p.minRR) continue;
        signals.push({
          symbol, entryDate: cur.timestamp, entryBarIndex: i, side: 'sell',
          entryPrice: cur.close, stopLevel: cur.high, targetPrice: tgt,
          reclaimedLevel: lv, rrPotential: rr,
        });
        break;
      }
    }
  }

  return signals;
}
