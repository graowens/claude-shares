import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Strategy } from './entities/strategy.entity';
import { CreateStrategyDto } from './dto/create-strategy.dto';
import { UpdateStrategyDto } from './dto/update-strategy.dto';

@Injectable()
export class StrategiesService implements OnModuleInit {
  private readonly logger = new Logger(StrategiesService.name);

  constructor(
    @InjectRepository(Strategy)
    private readonly repo: Repository<Strategy>,
  ) {}

  async onModuleInit() {
    await this.seedDefaults();
  }

  async findAll(): Promise<Strategy[]> {
    return this.repo.find({ order: { createdAt: 'ASC' } });
  }

  async findEnabled(): Promise<Strategy[]> {
    return this.repo.find({
      where: { enabled: true },
      order: { createdAt: 'ASC' },
    });
  }

  async findBacktestEnabled(): Promise<Strategy[]> {
    return this.repo.find({
      where: { backtestEnabled: true },
      order: { createdAt: 'ASC' },
    });
  }

  async findOne(id: number): Promise<Strategy> {
    return this.repo.findOneByOrFail({ id });
  }

  async create(dto: CreateStrategyDto): Promise<Strategy> {
    const entity = this.repo.create(dto);
    return this.repo.save(entity);
  }

  async update(id: number, dto: UpdateStrategyDto): Promise<Strategy> {
    await this.repo.update(id, dto);
    return this.findOne(id);
  }

  async toggle(id: number): Promise<Strategy> {
    const strategy = await this.findOne(id);
    strategy.enabled = !strategy.enabled;
    return this.repo.save(strategy);
  }

  async toggleBacktest(id: number): Promise<Strategy> {
    const strategy = await this.findOne(id);
    strategy.backtestEnabled = !strategy.backtestEnabled;
    return this.repo.save(strategy);
  }

  async bulkSetEnabled(enabled: boolean): Promise<Strategy[]> {
    await this.repo.createQueryBuilder()
      .update(Strategy)
      .set({ enabled })
      .execute();
    return this.findAll();
  }

  async bulkSetBacktest(backtestEnabled: boolean): Promise<Strategy[]> {
    await this.repo.createQueryBuilder()
      .update(Strategy)
      .set({ backtestEnabled })
      .execute();
    return this.findAll();
  }

  async remove(id: number): Promise<void> {
    await this.repo.delete(id);
  }

  async findByAuthor(): Promise<Record<string, Strategy[]>> {
    const all = await this.repo.find({ order: { createdAt: 'ASC' } });
    const grouped: Record<string, Strategy[]> = {};
    for (const s of all) {
      const key = s.author || 'Unknown';
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(s);
    }
    return grouped;
  }

  async getAuthorDefaults(): Promise<Record<string, { stopLoss: number; takeProfit: number }>> {
    const grouped = await this.findByAuthor();
    const defaults: Record<string, { stopLoss: number; takeProfit: number }> = {};
    for (const [author, strategies] of Object.entries(grouped)) {
      // Only include authors that have at least one backtest-enabled strategy
      const btEnabled = strategies.filter((s) => s.backtestEnabled);
      if (btEnabled.length === 0) continue;
      const primary = btEnabled.find((s) => s.enabled) || btEnabled[0];
      const params = primary?.params || {};
      defaults[author] = {
        stopLoss: params.stopLossPercent ?? 1,
        takeProfit: params.takeProfitPercent ?? 2,
      };
    }
    return defaults;
  }

  private async seedDefaults() {
    // Delete old fragmented Emanuel strategies that were split into 6
    const oldEmanuelNames = [
      'Strat 1 - Gap Scalp Trend Reversal',
      'Strat 2 - Opening Range Breakout',
      'Strat 3 - 20MA Trend Following',
      'Strat 4 - 200MA Support & Resistance',
      'Strat 5 - Bar-by-Bar Trail Management',
      'Strat 6 - 1-2-3 Pattern Entry',
      // Also clean up any older naming variants
      'Gap Scalp - Trend Reversal',
      'Opening Range Breakout',
      'Opening Range Breakout (High-Low)',
      '20MA Trend Following',
      '200MA Support & Resistance',
      'Bar-by-Bar Trail Management',
      '1-2-3 Pattern Entry',
      'AAA Value Area Setup',
      'Momentum Squeeze',
      'Claude - Stop Gap Reversal',
      'Hyper-Scalping Risk Model',
      'The \u201cONE CANDLE" Scalping Strategy I Will Use For Life',
    ];
    for (const oldName of oldEmanuelNames) {
      const old = await this.repo.findOneBy({ name: oldName });
      if (old) {
        await this.repo.remove(old);
        this.logger.log(`Deleted old fragmented strategy: ${oldName}`);
      }
    }

    const defaults = [
      {
        name: 'Emanuel - Gap Scalp System',
        author: 'Emanuel',
        description: `Emanuel's complete gap-scalping system, consolidated from all four transcripts (emmanuel-1, emmanuel-2, "My Scalping Strategy is BORING", "The ONLY 2 indicators I use"). ~6 years full-time day trading, $460k in 2025, $100k+ in Q1 2026, $548k trailing-12-months. Father taught him. Charles Schwab account. This is ONE integrated system — do not fragment it.

═══════════════════════════════════════════════
PHILOSOPHY — "ONE AND DONE"
═══════════════════════════════════════════════
Goal is ONE high-quality trade per day, executed in the first 5 min to 1 hour of the open. One trade can make a day, a week ($5k-$15k winners). Pass on 95% of gaps seen in pre-market. High-quality daily gap + high-quality intraday setup = the only recipe. Everything must be predefined (entry, stop, target, size) BEFORE entry — random entries → random risk → random results. "The simplest things in life are oftentimes the most brilliant" — no MACD, RSI, Bollinger Bands, VWAP, Elliott Wave, Fibonacci, stochastics. Only 20 SMA + 200 SMA + volume. No overnight holds — day trading only.

═══════════════════════════════════════════════
STEP 1 — PRE-MARKET SCANNING
═══════════════════════════════════════════════
Wake up a couple of hours before the open. Start scanning ~1 hour before the bell (8:30 ET or earlier). Scan tools:
• TradingView (free): Products → Screeners → Stocks → Extended Hours → Pre-market gap % → sort descending (gap ups) / ascending (gap downs). https://www.tradingview.com/screener/
• Market Chameleon (marketchameleon.com → Stocks → Pre-Market Trading): top gainers, top decliners, most active.
• ThinkOrSwim: right-click watchlist column → Customize → add "mark percent change" → sort.

Copy every gap stock to a watchlist. Typical morning: 100+ gaps → narrow to favorites → trade maybe 1-2. Primary focus for this system is gap UPS; gap downs follow the same rules inverted.

═══════════════════════════════════════════════
STEP 2 — GAP QUALITY CRITERIA (DAILY CHART)
═══════════════════════════════════════════════
Three rules on the DAILY time frame. Don't care WHY it gapped (earnings, news, CEO tweet, macro). Only care what the gap does to the chart:

1. GAP ENDS A TREND. A gap up that ends an established daily downtrend is powerful — shorts taken here/here/here are suddenly underwater and must cover (adds buying pressure = squeeze). Buyers who sold at the prior low feel FOMO and re-enter. Gap down that ends an uptrend = inverse.

2. GAP CLEARS RESISTANCE (or SUPPORT for shorts). Gap up above a daily consolidation / prior pivots / multiple failed breakouts triggers a larger-term breakout on weekly/monthly time frames.

3. GAP OPENS DIRECTLY ABOVE RESISTANCE (not far above). The closer the gap opens to the resistance level, the more power. Gaps that open way above resistance are already extended and less tradable.

Exact gap % is NOT the filter — it's about what the gap does to price structure. Proven examples: ESTC 35% gap ended downtrend ($318 → $645 same day). UGRO 64% gap ended downtrend (→ 100%+ same day; 14% gap above 200MA 2 days later → $36). UKAR 58% gap ($0.55 → $2.99). BENF 75% gap. WGRX 122% gap ended established September downtrend. Beyond Meat initial 58% gap was the catalyst that sparked the multi-day run. PGNY 15% gap above a red bar that ended the downtrend. EXPE 12% gap directly above a daily consolidation = clean daily breakout.

═══════════════════════════════════════════════
STEP 3 — THE TWO INDICATORS
═══════════════════════════════════════════════
Only 20 SMA and 200 SMA (not EMA — Simple). Applied to every time frame (daily, 15-min, 5-min, 2-min, 1-min). Indicators COMPLEMENT price action, never drive decisions. "Analysis paralysis" kills beginners who stack indicators that disagree.

20 SMA — TREND-FOLLOWING TOOL:
• Must be TRENDING, not flat. Rising 20MA under price = uptrend → look for longs. Declining 20MA over price = downtrend → look for shorts.
• Flat 20MA = no momentum → skip.
• Price "respects" the trending 20MA — retracements INTO the 20MA are the highest-probability entries. Multiple time frames (2/5/15-min intraday) all respect their own 20MA during clean trends.
• EXTENSION: Distance between price and 20MA = how overextended. Far from 20MA = don't chase longs (may revert to mean / reversal setup).
• Daily 20MA sets bias. Intraday 20MA is where entries form.

200 SMA — BIAS LINE (daily):
• Want it relatively FLAT (opposite of 20MA).
• Price ABOVE flat 200MA → 200MA acts as FLOOR / support. Dips into it get bought (BNS example: 8% gap down right into daily 200 → instant bounce, then back to uptrend).
• Price BELOW flat 200MA → 200MA acts as CEILING / resistance. Rallies to it get rejected (RR example: 200MA rejected breakdowns repeatedly until eventual 500%+ breakout up; KDP/MAT gapped directly below 200MA → beautiful intraday downtrends).
• GAP UP ABOVE 200MA = maximum bullish (Coinbase example — triggered base breakout on daily, clean 5-min uptrend off rising intraday 20MA).
• GAP DOWN BELOW 200MA = maximum bearish.
• Gap INTO 200MA = potential bounce trade (support/resistance at the line itself).

SQUEEZE PLAY (rare, powerful): Flat 200MA + rising 20MA passing through it → price oscillates between the two (200 = ceiling, 20 = floor) until it can't compress any more → explosive breakout. RR example rallied 500%+. Better on daily/weekly for swing trading.

═══════════════════════════════════════════════
STEP 4 — INTRADAY ENTRY SETUPS (first 30-60 min)
═══════════════════════════════════════════════
Just because the gap is A+ doesn't mean you buy the open. REQUIRE a predefined setup. Choose whichever the chart gives you:

A. HIGH-LOW / OPENING RANGE BREAKOUT
• Wait for first candle to close. Entry over its high (longs) / below its low (shorts). Stop = other side.
• Time frame matters: 1-min = hyper aggressive (often shakes out → then rips). 2-min = aggressive. 5-min = safest, 5 min of data already, more controlled. Default to 5-min unless you're in love with the gap.
• IGNORE if the first candle is too wide (huge range) — kills R:R. Want a NARROW RANGE first candle.

B. BREAKOUT
• Price moves up, consolidates / forms a tight base, ideally INTO the rising intraday 20MA. Entry above the base's high. Stop below the base's low. Works equally if the stock dips first, rallies, then bases.
• The rising 20MA acting as support under the base = A+ confirmation.

C. RETRACEMENT (pullback buy)
• After the initial move, price pulls back to the rising 20MA (longs) or declining 20MA (shorts). Look for an ENTRY CANDLE at the retracement low:
  – Bottoming tail (long lower wick, close near high) for longs
  – Doji (indecision bar)
  – Topping tail for shorts
• Entry above the entry candle's high (longs) / below its low (shorts). Stop on the opposite side of the entry candle.

D. 1-2-3 PATTERN
• Bar 1 = IGNITING bar (strong directional move).
• Bar 2 = RESTING bar (ideally a doji or bottoming/topping tail — small range, consolidation).
• Bar 3 = TRIGGERING bar that breaks resting bar's high (longs) / low (shorts).
• Entry over resting bar's high / below resting bar's low. Stop at the opposite extreme of the resting bar. Works across all time frames: UKAR showed a 15-min 1-2-3 late-day (a student caught it with 2,000 shares); IAUX showed a gap-down 1-2-3 on 2-cent stop → $7,234 winner.

If the intraday chart is choppy, sideways, sloppy (CYPH example — opened, chopped, topping tail, sold off, no setup) → pass entirely regardless of how good the daily gap looked. No setup = no trade.

Flexibility clause: if the daily gap is exceptional, you can take a slightly less clean intraday setup.

═══════════════════════════════════════════════
STEP 5 — TARGETS & R:R
═══════════════════════════════════════════════
Minimum 2:1 R:R or no trade. To find the target:
• Go to the DAILY time frame and look LEFT for the next area of pivots / congestion / prior resistance. Resistance is always an AREA, never a single price.
• Confirm the intraday entry has room to run to that daily level.
• ARM example: entry above intraday base, target = next daily resistance area, 5-min bar-by-bar management captured the full move to ~$162.80.

═══════════════════════════════════════════════
STEP 6 — POSITION SIZING
═══════════════════════════════════════════════
Shares = PredefinedRiskDollars / (Entry − Stop). Because entry and stop are known before entry, share size is mechanical. Never enter without both prices locked. Predetermined risk protects capital from "random risk, random results."

═══════════════════════════════════════════════
STEP 7 — TRADE MANAGEMENT (BAR-BY-BAR TRAIL)
═══════════════════════════════════════════════
The key to letting winners run. Most traders cut winners too early — bar-by-bar solves it systematically.

Once trade reaches 2:1 R:R, ACTIVATE bar-by-bar trailing:
• Each time a candle completes, raise the stop to that completed candle's low (longs) / lower the stop to its high (shorts).
• Stop keeps ratcheting in the trade's favor; never moves backwards.
• Once stop is above entry + 2R, the trade is "locked profit."

Time frame ladder (loose → tight):
• 15-MIN BAR-BY-BAR — widest trail, maximum room to breathe, captures multi-hour runners. Start here. IAUX $7,234 winner rode 15-min bars all day.
• 5-MIN BAR-BY-BAR — TIGHTEN to this once trade is 4-5-6R in profit / accelerating / approaching major resistance. Locks in more on reversal. ARM example used pure 5-min and caught the top.
• 2-MIN BAR-BY-BAR — even tighter; secures profits faster but shakes out more often.
• 1-MIN BAR-BY-BAR — tightest; reserved for very late in a parabolic run.

Trade-off: Looser trail = more given back on reversal but catches bigger runners. Tighter trail = locks profit but risks shake-out. Don't go too tight too early (ASTC example — Emanuel took profits at the first pop for $350; 15-min bar-by-bar would have ridden to $5+; he left $1.50+/share on the table by over-managing).

Bar-by-bar activation at 2R guarantees minimum 2R captured even if the next bar stops you out (stop is already above the 2R level).

═══════════════════════════════════════════════
STEP 8 — EXECUTION DISCIPLINE
═══════════════════════════════════════════════
• Prepared trader = successful trader. Rolling out of bed 5 min before the open = fail.
• Not every watchlist stock hits. Pick top 1-3 favorites. BBGI example: Emanuel had the right thesis but got in too early (frontrunning the consolidation), stopped out for −$500, then watched his exact setup break out hours later for +25%. Right read, wrong execution.
• Don't trade setups you don't have conviction in just because the daily gap is on your list.
• Honor the stop. No adding to losers.
• Exit all positions by close.`,
        source: 'emmanuel-1.txt, emmanuel-2.txt, Emmanuel "My Scalping Strategy is BORING", Emmanuel "The ONLY 2 indicators I use"',
        params: {
          stopLossPercent: 1,
          takeProfitPercent: 2,
          minGapPercent: 5,
          ma20Period: 20,
          ma200Period: 200,
          // ORB first-candle timeframe in minutes — Emanuel's stated preference is 5
          // ("safer, more controlled"). 1 or 2 are supported by the param shape but
          // currently skip ORB because intraday data is only available at 5-min bars.
          orbTimeframeMinutes: 5,
          // Skip ORB if the first candle's range exceeds this % (need narrow-range bar).
          orbMaxRangePercent: 3,
          // Minimum gap-setup score to consider the trade at all.
          minScore: 50,
          // Normal minimum R:R.
          minRR: 2,
          // Flexibility clause: "if the gap is so high quality, I'll take the trade even
          // if the intraday setup isn't A+." When setup.score >= exceptionalGapScore,
          // the engine relaxes R:R, base tightness, retracement zone and NRB count.
          exceptionalGapScore: 70,
          flexibilityMinRR: 1.5,
          // Risk per trade as fraction of capital.
          riskPercent: 0.02,
          // Bar-by-bar trail activation + tightening R:R.
          trailActivateRR: 2,
          trailTightenRR: 4,
          initialTrailBars: 3,
          tightTrailBars: 1,
        },
        enabled: true,
        backtestEnabled: true,
      },
      {
        name: 'Claude - Enhanced Gap Strategy',
        author: 'Claude',
        description: `Claude's strategy — built on Emanuel's gap scalping rules but optimised for $1,000 capital targeting $50/day (5% daily return). Uses 2+ years of backtested NASDAQ gap data to improve on Emanuel's approach.

IMPROVEMENTS OVER EMANUEL:
1. UP TO 3 TRADES/DAY — Emanuel does "one and done". Claude allows 3 attempts with strict daily loss cap. If trade #1 stops out, take trade #2 from the watchlist. Daily risk budget: $60 (6% of capital across up to 3 trades at 2% each).

2. SCORE-WEIGHTED SIZING — Risk 3% on score 60+ setups (high conviction), 2% on 40-59 (standard), 1.5% on 30-39 (marginal). Emanuel risks the same regardless.

3. EXTENDED ENTRY WINDOW — First 2 hours (24 bars) not just 1 hour. More time to find clean setups. Many of Emanuel's best entries (20MA retracement, base breakout) form 30-60 min into the session.

4. FASTER TRAIL ACTIVATION — Activate bar-by-bar at 1.5R instead of 2R. Secures profits sooner on the many trades that hit 1.5R but reverse before 2R.

5. PARTIAL PROFITS — Take 50% of position at 2:1 R:R, trail the rest. This guarantees profit on trades that reach 2R while keeping upside for runners.

6. INTRADAY 20MA RE-ENTRY — If stopped out but price then retraces back to the intraday 20MA with a reversal bar, re-enter (counts as trade #2). The setup is still valid, just the timing was off.

7. END-OF-DAY TIGHTENING — In the last 30 min, switch to 1-bar trailing regardless of R:R. Lock in any remaining profit before close.

DAILY RISK MANAGEMENT: Max $60 loss/day (6%). If hit, stop trading. This limits worst-case drawdown to ~3 losing days before reassessing.`,
        source: 'Claude analysis of 2+ years of NASDAQ gap data',
        params: {
          maxTradesPerDay: 3,
          riskPercentHigh: 3,
          riskPercentStandard: 2,
          riskPercentLow: 1.5,
          highScoreThreshold: 60,
          lowScoreThreshold: 30,
          entryWindowBars: 24,
          trailActivateRR: 1.5,
          partialProfitRR: 2,
          partialProfitPercent: 50,
          maxDailyLossPercent: 6,
          eodTightenBar: 72,
        },
        enabled: true,
        backtestEnabled: true,
      },
      {
        name: 'Strat 1 - AAA Value Area Setup',
        author: 'Fabio',
        description: `Fabio's AAA (Triple-A) setup. Trade from the value area low to value area high using order flow analysis. Wait for the first 30 minutes of the session for market participants to establish direction. Look for aggressive sellers getting absorbed at the value area low - big trades hitting a "wall" of buyers. Enter long with tight stop below the absorption zone, target the value area high. Risk:reward typically 1:4 to 1:5. Scale in as position moves in your favour. Move to risk-free as soon as possible. Best on momentum/trending days, not consolidation days.`,
        source: 'trading-live-best-scalper.txt',
        params: {
          stopLossPercent: 0.5,
          takeProfitPercent: 2.5,
          waitMinutes: 30,
          minRiskReward: 4,
          scaleIn: true,
          moveToBreakEvenASAP: true,
        },
        enabled: false,
        backtestEnabled: true,
      },
      {
        name: 'Strat 2 - Momentum Squeeze',
        author: 'Fabio',
        description: `Fabio's momentum/squeeze setup. Place buy stops above resistance levels where sellers are being absorbed. When sellers fail to push through and get "annihilated", the resulting short squeeze creates rapid upward expansion. Use tight stops below the absorption zone. Risk is small ($800-2000) with potential for $5,000-10,000 profit. Key: only enter when you see aggressive buyers protecting a level and sellers failing. Cancel orders if sellers break through - the setup is invalidated. Dynamic position scaling: start small, add contracts as you get confirmed.`,
        source: 'trading-live-best-scalper.txt',
        params: {
          entryType: 'buy_stop_above_resistance',
          maxRiskPerTrade: 2000,
          targetMultiple: 5,
          dynamicScaling: true,
        },
        enabled: false,
        backtestEnabled: true,
      },
      {
        name: 'Strat 3 - Hyper-Scalping Risk Model',
        author: 'Fabio',
        description: `Fabio's overall risk management framework. Set a maximum daily drawdown (e.g. $10,000). Take consistent small wins with high R:R (average win $1,000/contract, average loss $600/contract). Win rate 43-49% is acceptable when average winners significantly exceed average losers. Never hold for the full move - take partials and re-enter. Risk only profits on subsequent trades after hitting daily target. Stop trading after capturing the main move - don't trade consolidation (expensive due to commissions). 70% of market time is consolidation, so trade the 30% expansion efficiently. Walk away after a great session.`,
        source: 'trading-live-best-scalper.txt',
        params: {
          stopLossPercent: 0.6,
          takeProfitPercent: 1.0,
          maxDailyDrawdown: 10000,
          targetWinRate: 0.45,
          avgWinToLossRatio: 1.67,
          riskProfitsOnly: true,
          stopAfterTarget: true,
        },
        enabled: false,
        backtestEnabled: true,
      },
      {
        name: 'ProRealAlgos - Quick Flip Scalper',
        author: 'ProRealAlgos',
        description: `Carl's "Quick Flip Scalper" strategy from ProRealAlgos. Exploits institutional liquidity manipulation in the first 90 minutes of the market open. 15+ year proven edge.

STEP 1 — BOX THE OPENING RANGE: On a 15-min chart, let the first candle close. Box the high-to-low range. This is the "manipulation zone."

STEP 2 — CONFIRM MANIPULATION CANDLE: The first 15-min candle must be >= 25% of the 14-day ATR. This confirms it's a liquidity event — institutions engineering stop hunts to create liquidity for their large positions. If < 25% ATR, no trade.

STEP 3 — FIND THE REVERSAL ENTRY (within 90 min of open, on 5-min chart):
- If opening candle was GREEN (bullish manipulation): look for BEARISH reversal ABOVE the box → inverted hammer or bearish engulfing candle
- If opening candle was RED (bearish manipulation): look for BULLISH reversal BELOW the box → hammer or bullish engulfing candle
- The reversal candle MUST be OUTSIDE the boxed range to be valid

ENTRY: On break of the reversal candle (next 5-min bar). For hammer: entry above the candle high. For engulfing: entry at the high/low of the previous candle.

STOP LOSS: At the extreme of the reversal candle (low of hammer, high of inverted hammer, low/high of engulfing).

TARGET: Opposite side of the opening range box. Green open → target is box LOW. Red open → target is box HIGH. This gives R:R typically 2:1 to 3:1+.

EDGE: "The best trades occur after the masses have been stopped out." Institutions engineer the first 15 min to create liquidity, then reverse. This happens almost every day.`,
        source: 'ProRealAlgos - ONE CANDLE Scalping Strategy',
        params: {
          openingRangeMinutes: 15,
          atrPeriod: 14,
          manipulationThreshold: 0.25,
          entryTimeframe: '5Min',
          maxEntryMinutes: 90,
          targetSide: 'opposite_box',
        },
        enabled: true,
        backtestEnabled: true,
      },
    ];

    for (const def of defaults) {
      const exists = await this.repo.findOneBy({ name: def.name });
      if (exists) {
        exists.description = def.description;
        exists.source = def.source;
        exists.params = def.params;
        exists.author = def.author;
        if (exists.backtestEnabled === undefined || exists.backtestEnabled === null) {
          exists.backtestEnabled = def.backtestEnabled ?? true;
        }
        await this.repo.save(exists);
        this.logger.log(`Updated strategy: ${def.name}`);
      } else {
        await this.repo.save(this.repo.create(def));
        this.logger.log(`Seeded strategy: ${def.name}`);
      }
    }
  }
}
