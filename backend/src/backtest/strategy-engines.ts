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
  maxTradesPerDay: number;
  entryWindowBars: number;
  trailActivateRR: number;
  partialProfitRR: number;
  partialProfitPercent: number;
  maxDailyLossPercent: number;
  eodTightenBar: number;
}

export const CLAUDE_DEFAULT_PARAMS: ClaudeParams = {
  maxTradesPerDay: 3,
  entryWindowBars: 24,    // 2 hours
  trailActivateRR: 1.5,
  partialProfitRR: 2.0,
  partialProfitPercent: 50,
  maxDailyLossPercent: 6,
  eodTightenBar: 72,      // last 30 min (bar 72 of 78)
};

// ═══════════════════════════════════════════════════════════════
//  CLAUDE'S ENGINE — Enhanced Gap Strategy
// ═══════════════════════════════════════════════════════════════
//
// Built on Emanuel's rules but optimised for $1,000 capital → $50/day:
//
// 1. UP TO 3 TRADES/DAY — if #1 stops out, take #2 from watchlist
// 2. SCORE-WEIGHTED SIZING — more risk on high-conviction setups
// 3. EXTENDED ENTRY WINDOW — 2 hours not 1
// 4. FASTER TRAIL — activate at 1.5R not 2R
// 5. PARTIAL PROFITS — take 50% at 2R, trail rest
// 6. RE-ENTRY — if stopped out, 20MA retrace = new entry
// 7. EOD TIGHTENING — 1-bar trail in last 30 min

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
  let skippedStocks = 0;
  const skippedReasons: string[] = [];

  // Sort by score descending — trade best setups first
  const sorted = [...setups].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  let tradesThisDay = 0;
  let dailyLoss = 0;
  const maxDailyLoss = capital * (p.maxDailyLossPercent / 100);

  for (const setup of sorted) {
    // Daily limits
    if (tradesThisDay >= p.maxTradesPerDay) {
      skippedStocks++;
      skippedReasons.push(`${setup.symbol}: Max ${p.maxTradesPerDay} trades/day reached`);
      continue;
    }
    if (dailyLoss >= maxDailyLoss) {
      skippedStocks++;
      skippedReasons.push(`${setup.symbol}: Daily loss limit hit ($${dailyLoss.toFixed(0)}/$${maxDailyLoss.toFixed(0)})`);
      continue;
    }

    const { bars, isGapUp, side, gapPercent, symbol } = setup;
    const score = setup.score ?? 0;

    // Filters — quality over quantity
    if (score < 40) {
      skippedStocks++;
      skippedReasons.push(`${symbol}: Score ${score} too low (need 40+)`);
      continue;
    }
    if (setup.dailyContext === 'other') {
      skippedStocks++;
      skippedReasons.push(`${symbol}: No daily context`);
      continue;
    }
    if (setup.trendDirection === 'sideways') {
      skippedStocks++;
      skippedReasons.push(`${symbol}: Flat 20MA`);
      continue;
    }
    // Minimum price $2 — avoid penny stocks with bad spreads
    if (bars[0].open < 2) {
      skippedStocks++;
      skippedReasons.push(`${symbol}: Price $${bars[0].open.toFixed(2)} too low`);
      continue;
    }
    // Minimum gap 5% — need explosive movers
    if (Math.abs(gapPercent) < 5) {
      skippedStocks++;
      skippedReasons.push(`${symbol}: Gap ${gapPercent.toFixed(1)}% too small`);
      continue;
    }
    if (bars.length < 6) {
      skippedStocks++;
      skippedReasons.push(`${symbol}: Not enough bars`);
      continue;
    }

    // Score-weighted risk sizing
    let riskPercent: number;
    if (score >= 60) riskPercent = 0.03;       // 3% on high conviction
    else if (score >= 40) riskPercent = 0.02;   // 2% standard
    else riskPercent = 0.015;                    // 1.5% on marginal
    const maxRisk = capital * riskPercent;

    const { ma20: resolvedMA20, ma200: resolvedMA200 } = fillMAs(setup);
    const has200MA = resolvedMA200 != null && resolvedMA200 > 0;
    const openPrice = bars[0].open;

    let directionConfirmed = true;
    if (has200MA) {
      if (isGapUp && openPrice < resolvedMA200!) directionConfirmed = false;
      if (!isGapUp && openPrice > resolvedMA200!) directionConfirmed = false;
    }

    // Intraday 20MA (proper 20-period)
    const closes = bars.map(b => b.close);
    const intraday20MA: (number | null)[] = closes.map((_, i) => sma(closes, i, 20));

    // ── ENTRY METHODS — extended 2-hour window ──
    const searchLimit = Math.min(bars.length, p.entryWindowBars);

    let entryPrice: number | null = null;
    let stopLevel: number | null = null;
    let entryBarIndex = -1;
    let entryMethodUsed = '';

    // METHOD 1: ORB
    const orbBar = bars[0];
    const orbRangePct = (orbBar.high - orbBar.low) / orbBar.open * 100;
    if (orbRangePct <= 3) {
      const orbEntry = isGapUp ? orbBar.high : orbBar.low;
      const orbStop = isGapUp ? orbBar.low : orbBar.high;
      for (let i = 1; i < Math.min(searchLimit, 4); i++) {
        if (isGapUp && bars[i].high >= orbEntry) {
          entryPrice = orbEntry; stopLevel = orbStop;
          entryBarIndex = i; entryMethodUsed = 'ORB'; break;
        }
        if (!isGapUp && bars[i].low <= orbEntry) {
          entryPrice = orbEntry; stopLevel = orbStop;
          entryBarIndex = i; entryMethodUsed = 'ORB'; break;
        }
      }
    }

    // METHOD 2: 1-2-3 Pattern
    if (entryPrice === null) {
      for (let i = 0; i < searchLimit - 2; i++) {
        const ig = bars[i], re = bars[i + 1], tr = bars[i + 2];
        if (isGapUp && ig.close > ig.open && isMomentumBar(ig) && (isDoji(re) || hasBottomingTail(re))) {
          if (tr.high >= re.high) {
            entryPrice = re.high; stopLevel = re.low;
            entryBarIndex = i + 2; entryMethodUsed = '1-2-3'; break;
          }
        }
        if (!isGapUp && ig.close < ig.open && isMomentumBar(ig) && (isDoji(re) || hasToppingTail(re))) {
          if (tr.low <= re.low) {
            entryPrice = re.low; stopLevel = re.high;
            entryBarIndex = i + 2; entryMethodUsed = '1-2-3'; break;
          }
        }
      }
    }

    // METHOD 3: 20MA Retracement (extended window)
    if (entryPrice === null) {
      for (let i = 4; i < searchLimit; i++) {
        const bar = bars[i], ma = intraday20MA[i];
        if (ma === null) continue;
        if (isGapUp) {
          if (bar.low <= ma * 1.003 && bar.close > ma && (hasBottomingTail(bar) || isDoji(bar))) {
            entryPrice = bar.close; stopLevel = bar.low;
            entryBarIndex = i; entryMethodUsed = '20MA Retrace'; break;
          }
        } else {
          if (bar.high >= ma * 0.997 && bar.close < ma && (hasToppingTail(bar) || isDoji(bar))) {
            entryPrice = bar.close; stopLevel = bar.high;
            entryBarIndex = i; entryMethodUsed = '20MA Retrace'; break;
          }
        }
      }
    }

    // METHOD 4: Base breakout into 20MA
    if (entryPrice === null) {
      for (let i = 3; i < searchLimit; i++) {
        const ma = intraday20MA[i];
        if (ma === null || i + 1 >= bars.length) continue;
        const prevBars = bars.slice(Math.max(0, i - 2), i + 1);
        const baseHigh = Math.max(...prevBars.map(b => b.high));
        const baseLow = Math.min(...prevBars.map(b => b.low));
        if ((baseHigh - baseLow) / baseLow * 100 < 2) {
          const next = bars[i + 1];
          if (isGapUp && Math.abs(baseLow - ma) / ma < 0.01 && next.high > baseHigh) {
            entryPrice = baseHigh; stopLevel = baseLow;
            entryBarIndex = i + 1; entryMethodUsed = 'Base Breakout'; break;
          }
          if (!isGapUp && Math.abs(baseHigh - ma) / ma < 0.01 && next.low < baseLow) {
            entryPrice = baseLow; stopLevel = baseHigh;
            entryBarIndex = i + 1; entryMethodUsed = 'Base Breakout'; break;
          }
        }
      }
    }

    if (entryPrice === null || stopLevel === null) {
      skippedStocks++;
      skippedReasons.push(`${symbol}: No entry in 2-hour window`);
      continue;
    }

    const riskPerShare = Math.abs(entryPrice - stopLevel);
    if (riskPerShare <= 0) {
      skippedStocks++;
      skippedReasons.push(`${symbol}: Zero risk`);
      continue;
    }

    // Position sizing based on risk
    let shares = Math.floor(maxRisk / riskPerShare);
    if (shares <= 0) {
      skippedStocks++;
      skippedReasons.push(`${symbol}: Stop too wide for risk budget`);
      continue;
    }

    // ── TRADE MANAGEMENT — full day with partial profits ──
    let exitPrice: number | null = null;
    let exitReason: SimulatedTrade['exitReason'] = 'end_of_day';
    let trailingStop = stopLevel;
    let trailingActive = false;
    let tightTrailActive = false;
    let barsSinceTrailUpdate = 0;
    let partialTaken = false;
    let remainingShares = shares;

    let partialPnl = 0;

    for (let i = entryBarIndex; i < bars.length; i++) {
      const bar = bars[i];

      // Stop / trailing stop check
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

      // 200MA exit when direction not confirmed
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

      // Activate trailing at 1.5R (faster than Emanuel's 2R)
      if (!trailingActive && currentRR >= p.trailActivateRR) {
        trailingActive = true;
        barsSinceTrailUpdate = 0;
      }

      // Partial profit at 2R — take 50%, trail the rest
      if (!partialTaken && currentRR >= p.partialProfitRR) {
        const partialShares = Math.floor(remainingShares * (p.partialProfitPercent / 100));
        if (partialShares > 0) {
          const mult = isGapUp ? 1 : -1;
          partialPnl += (bar.close - entryPrice) * mult * partialShares;
          remainingShares -= partialShares;
          partialTaken = true;
        }
      }

      // Tighten trail at 4R
      if (trailingActive && !tightTrailActive && currentRR >= 4) {
        tightTrailActive = true;
        barsSinceTrailUpdate = 0;
      }

      // EOD tightening — 1-bar trail in last 30 min regardless
      const isEOD = i >= p.eodTightenBar;
      if (isEOD && !tightTrailActive) {
        tightTrailActive = true;
        barsSinceTrailUpdate = 0;
      }

      // Update trailing stop
      if (trailingActive) {
        barsSinceTrailUpdate++;
        const interval = tightTrailActive ? 1 : 3;
        if (barsSinceTrailUpdate >= interval) {
          barsSinceTrailUpdate = 0;
          if (isGapUp) {
            if (bar.low > trailingStop) trailingStop = bar.low;
          } else {
            if (bar.high < trailingStop) trailingStop = bar.high;
          }
        }
      }
    }

    // End of day
    if (exitPrice === null) {
      exitPrice = bars[bars.length - 1].close;
      exitReason = 'end_of_day';
    }

    // Calculate P/L including partial profit
    const multiplier = isGapUp ? 1 : -1;
    const remainingPnl = (exitPrice - entryPrice) * multiplier * remainingShares;
    const totalTradePnl = partialPnl + remainingPnl;
    const pnlPercent = ((exitPrice - entryPrice) * multiplier / entryPrice) * 100;

    equity += totalTradePnl;
    maxEquity = Math.max(maxEquity, equity);
    const drawdown = ((maxEquity - equity) / maxEquity) * 100;
    maxDrawdown = Math.max(maxDrawdown, drawdown);

    if (totalTradePnl < 0) dailyLoss += Math.abs(totalTradePnl);

    trades.push({
      date: bars[0].timestamp,
      symbol,
      entryPrice,
      exitPrice,
      pnl: totalTradePnl,
      pnlPercent,
      side,
      exitReason,
      shares,
      gapPercent,
      equityAfter: equity,
    });

    tradesThisDay++;
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
    entryMethod: 'Claude Enhanced: Up to 3 trades/day, score-weighted sizing, 2hr entry, partial profits at 2R, EOD tightening',
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
