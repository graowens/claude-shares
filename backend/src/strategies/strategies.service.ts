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
      'Claude - Enhanced Gap Strategy',
      'Claude - Author Blend',
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
        name: 'Claude - Hybrid',
        author: 'Claude',
        description: `Claude is a TWO-LAYER HYBRID that leans hardest into the edge that's winning — Dumb Hunter's multi-day SWING reclaims — while still deploying the intraday author blend as a same-day supplement. Both layers share the running equity pool.

═══════════════════════════════════════════════
WHY A HYBRID
═══════════════════════════════════════════════
The swing backtest proved DMC level-reclaims (daily/weekly/monthly pivots) have a real edge on multi-day holds — the ~80%+ WR regime the author advocates. But that edge only fires when a reclaim signal appears on the watchlist, which can be quiet for days. The intraday blend fills those quiet days by trading the gap-of-the-day universe, so capital is deployed continuously.

═══════════════════════════════════════════════
LAYERS
═══════════════════════════════════════════════
SWING LAYER (primary — the edge):
  • Engine: Dumb Hunter swing signal generator
  • Walks daily bars on a configurable watchlist (default: GLD, SPY, QQQ, IWM, NVDA, TSLA, AAPL, MSFT, AMZN, GOOGL, META, AMD)
  • Signal: daily close reclaims a previously-lost HTF level (monthly + weekly + daily body pivots)
  • Stop: reclaim-bar extreme. Target: next HTF level. Time-stop: 20 days.
  • Risk sizing: 2% of current equity per position
  • Max concurrent: 5 positions (configurable)

INTRADAY LAYER (supplement — fills quiet days):
  • Engine: the existing Claude intraday blend (Emanuel + Dumb Hunter intraday + ProRealAlgos + Fabio)
  • Runs on each trading day's top-3 gap-scan setups
  • Blend picks the highest-conviction per symbol (multi-author vote)
  • Sub-engines own their own entry/exit logic (ORB trail, DMC reclaim, manipulation box, absorption)
  • Tight per-day cap: maxIntradayPerDay (default 2) so swing doesn't get starved of capital
  • Uses the current equity when sizing — grows/shrinks alongside swing P/L

═══════════════════════════════════════════════
CAPITAL MODEL
═══════════════════════════════════════════════
Shared equity pool. Each position (swing or intraday) risks 2% of CURRENT equity at the time of entry. Swing wins → intraday sizes bigger next day. Intraday losses → swing sizes smaller next signal. No separate buckets — the layers compound each other.

Max risk on the books at any one moment:
  5 swing × 2% + 2 intraday × 2% = 14% theoretical max
  Realistic max drawdown much smaller because positions rarely all hit stops.

═══════════════════════════════════════════════
ALGORITHM
═══════════════════════════════════════════════
For each trading day in the lookback window:
  1. SWING EXITS — for every open swing position, check today's daily bar:
     stop hit → exit at stop
     target hit → exit at target
     held 20+ days → exit at close (time stop)
  2. SWING ENTRIES — take any new swing signal(s) from today's scan, FCFS
     up to maxConcurrentSwing, one position per symbol at a time.
  3. INTRADAY — run the gap scanner, build top-3 setups, call the intraday blend
     with maxTradesPerDay = maxIntradayPerDay. Record the day's intraday trades.
At end of window: close any remaining swing positions at their last close.

═══════════════════════════════════════════════
KEY PARAMS
═══════════════════════════════════════════════
  lookbackWeeks — backtest window length (default 20)
  swingSymbols — watchlist for the swing layer (user-editable)
  maxConcurrentSwing — swing position cap (default 5)
  maxIntradayPerDay — intraday trade cap per day (default 2)
  Swing risk/hold rules inherit from Dumb Hunter swing defaults (2% risk, 20-day time stop, 1.5 min R:R)

═══════════════════════════════════════════════
WHAT THIS GIVES YOU
═══════════════════════════════════════════════
One equity curve combining:
  • The high-conviction, patient DMC swing edge
  • Same-day gap opportunities from 4 intraday experts
Per-layer breakdown shows which side is contributing (swing vs intraday trades, wins, P/L). Per-symbol breakdown shows which tickers are doing work.

═══════════════════════════════════════════════
NOTE ON THE OLD CLAUDE
═══════════════════════════════════════════════
The previous "Claude - Author Blend" was intraday-only (same-day gap trades via voting). That engine still exists and is used in the per-author daily comparison table on the main backtest page. The strategy record now describes the hybrid (swing + intraday) because that is the version you run for validation.`,
        source: 'Hybrid: Dumb Hunter swing (primary) + intraday blend (Emanuel + Dumb Hunter + ProRealAlgos + Fabio)',
        params: {
          lookbackWeeks: 20,
          maxConcurrentSwing: 5,
          maxIntradayPerDay: 2,
          swingRiskPercent: 0.02,
          swingMaxHoldDays: 20,
          swingMinRR: 1.5,
          stopLossPercent: 1,
          takeProfitPercent: 2,
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
      {
        name: 'Dumb Hunter - DMC Level Reclaim',
        author: 'Dumb Hunter',
        description: `Dumb Hunter's Dumb Money Concepts (DMC) method — synthesised from all five of his transcripts (DMC Gold Strategy, Updated Method, ICT-Flagged video, Trend Determination, Identifying Levels). Tagline: "It's so dumb that your grandma could do it." SMC simplified.

═══════════════════════════════════════════════
CORE THESIS
═══════════════════════════════════════════════
"The only thing you need to know is how price reacts to the levels of the candle bodies." Market moves are driven by algorithms and hedge funds reacting at significant levels. DMC distills this to a single, mechanical observation: price either GAINS or LOSES a level, and the next move is always determinable.

═══════════════════════════════════════════════
THE FOUR RULES
═══════════════════════════════════════════════
R1. FAIL-TO-LOSE-A-LEVEL → price must RETEST that level, then continue the opposite way.
    "After you failed to lose a level, what we must do is retest it."

R2. FAIL NEW HIGH / FAIL NEW LOW → price must travel to the opposite side.
    Fails to make a new low → targets a new high. Fails to make a new high → targets a new low.
    Market has only two directions — one has to happen.

R3. REGAIN A LOST ZONE → when price closes BACK INTO a zone it was previously outside of, it will travel to the OPPOSITE side of the move that created the zone. Enter on the reclaim candle close.

R4. TREND CONTINUATION → when a candle body CLOSES beyond a new level, that level becomes "gained." Price will come back, retest the gained level, then continue in the trend direction. Every gained level must be retested before continuation.

The only time these rules fail: a LARGER FRACTAL (higher time frame) overrides. E.g., an untested daily level will pull price down through smaller-TF setups to test it.

═══════════════════════════════════════════════
WHAT IS A LEVEL (transcript 16)
═══════════════════════════════════════════════
Only candle BODIES matter — opens and closes. Wicks are ignored. Each pivot candle contributes BOTH body-open AND body-close as valid levels: "you can also draw the level on the opposite side of the candle — these both exist, they're both possibilities."

THREE CATEGORIES of levels:

1. STANDARD LEVELS — body-open and body-close of any pivot candle (or any significant candle body). Draw on monthly, weekly, daily first. These are the most important.

2. PASS-THROUGH LEVELS — when a candle is very wide (FVG-like, big expansion), price is unlikely to come all the way back to retest that candle's own body. Instead it uses OLDER body levels from before the wide candle. These age-decay: "as the level passes through more and more candles it's weaker and weaker."

3. SKIPPING / JUMPING LEVELS — when volatility is high, price can skip nearby levels entirely and retest a further, more significant older level. When price jumps, nearer levels become less likely retest targets.

DRAW A ZONE, NOT A LINE: "You never know exactly which level they're going to take." Place orders across multiple candidate levels. The actual retest might pick any one of them.

═══════════════════════════════════════════════
FRACTAL / TIME-FRAME HIERARCHY
═══════════════════════════════════════════════
Higher time frames create the BASE STRUCTURE. Lower time frames are sub-fractals of that structure. Explicit ranking:
  • MONTHLY / WEEKLY — most important, "super critical"
  • DAILY — primary
  • HOURLY — context / confirmation
  • INTRADAY (15-min, 5-min) — entry timing only, avoid for core setups

Author: "Don't use anything lower than hourly" for the 80%+ WR swing version.

═══════════════════════════════════════════════
SWING vs DAY TRADING (transcript 14)
═══════════════════════════════════════════════
The method is explicitly SWING-ORIENTED. Stated performance tiers:
  • SWING (daily/weekly/monthly setups, hourly context) → ~80%+ win rate
  • DAY TRADING (intraday entries) → ~60% win rate — "a lot harder"
  • SCALPING (sub-hourly) → author doesn't recommend it

"High win rate methods don't work well for day trading." Day trades miss setups because you're too slow; swing gives you time to read HTF structure properly. He prefers swing for "low stress longer-term swing trades."

LIVE RESULTS: $5,000 → $96,000 in ~3 months swing-trading gold (broker statements shown on live stream). "We know with certainty that this target was going to be hit. We just didn't know exactly how it was going to get there."

═══════════════════════════════════════════════
OLD vs NEW METHOD (transcript 13)
═══════════════════════════════════════════════
OLD (zone-averaging) — enter into zones, average into the position. Imprecise.
NEW (this strategy) — precise candle-close entry. When a candle CLOSES back into the lost zone, buy/sell at the close. No averaging, no scaling entries through a zone. Clean 1R risk, clean target.

"It's the exact same thing basically... the difference is it's a lot easier than averaging in, scaling in and out."

═══════════════════════════════════════════════
TREND DETERMINATION (transcript 15)
═══════════════════════════════════════════════
Trend continuation signal: candle bodies CLOSE BEYOND new levels in the trend direction. Each such close confirms the trend continues.

Trend reversal signal: price attempts a new low (or high), fails (doesn't close beyond), and the bodies all start closing on the other side. At that point every level created on the losing move becomes a retest target.

"Front-running" a level is VALID — price only needs to touch it "just barely" for the retest to count. Don't require a perfect tag.

When a lower time frame looks like it's reversing but a higher TF candle is still closing with the original direction, the lower move is a RETEST not a reversal. Prove direction with HTF closes, not intraday noise.

═══════════════════════════════════════════════
ENTRY RULES
═══════════════════════════════════════════════
LONG RECLAIM:
  • Prior candle close below an HTF level
  • Current candle closes ABOVE the level
  • Buy at the close. Optionally scale in: blind initial entry, add at confirmation retest.
  • Stop: reclaim candle's low ("don't lose that back wick")
  • Target: next significant HTF level above

SHORT RECLAIM (mirror):
  • Prior close above level, current close below
  • Sell at close, stop at high, target next level below

FAIL-RETEST FLOW (transcript 14):
  Step 1: price fails to lose the level (first signal)
  Step 2: price retests the level (second signal — entry)
  Step 3: price continues in the expected direction (target)

TREND-CONTINUATION ENTRY:
  • After a body-close beyond a new level (level gained)
  • Wait for the retest of the gained level
  • Enter with trend on the retest bounce, target next level

═══════════════════════════════════════════════
STOP / TARGET / RISK
═══════════════════════════════════════════════
STOP: at the reclaim candle's extreme. If that bar's body is invalidated (close back on the wrong side), thesis is dead.

TARGET: next significant HTF level in trade direction. Pre-tested levels are preferred targets because they're more likely to break. If a daily level is UNTESTED, price tends to test it eventually — good target.

R:R: typically 1.5–3R per trade. "One R. Boom. Every single time" is the minimum claim on clean reclaims.

SCALING: "We were buying there blindly at first, and after we did get that confirmation, we again bought here off that level." Multi-entry on strong setups is allowed.

═══════════════════════════════════════════════
CONVICTION BUILDERS (optional, transcript 12)
═══════════════════════════════════════════════
No required bias, but extra context helps:
  • Macro fundamentals (war, economic data, commodity flows)
  • HTF structure (daily failed to make new low → overall bullish lean)
  • Larger-fractal untested levels (price WILL visit them eventually)

═══════════════════════════════════════════════
EXAMPLES (from transcripts)
═══════════════════════════════════════════════
• GOLD — large dump, daily failed to make new low, reclaim of the zone, targeted next weekly level up, ~2-hour trade. Repeated over weeks → $5k → $96k swing.
• NASDAQ 5-min — repeated clean reclaims traded to the opposite side: "One R. Boom. Every single time."
• Power-hour scalp — 5-min candle failed new high, re-entered on the short side, went straight to the next low. (Author noted he was "too slow" — intraday is harder.)
• Bearish HTF override — lower TF looked reversing but the 4H candle closed bearishly → next move was DOWN (retest, not reversal).

═══════════════════════════════════════════════
BACKTEST ENGINE IMPLEMENTATION
═══════════════════════════════════════════════
LEVEL BUILDING (daily + weekly + monthly pivots, pooled):
  • DAILY pivots: pivotLookback bars either side (default 3)
  • WEEKLY pivots: daily bars are resampled to weekly OHLC (Mon–Fri aggregation) and pivots detected with htfPivotLookback (default 2 bars either side)
  • MONTHLY pivots: daily bars resampled by calendar month, same htfPivotLookback
  • Each pivot contributes BOTH body-open AND body-close as levels (set includeBothBodySides=false to use only the body extreme)
  • Pass-through levels: when a recent daily bar's range exceeds passThroughWideRangeMultiple × 20-bar-avg range, add body levels from the preceding passThroughLookback bars as fallback retest targets
  • Dedupe: levels within levelMergeTolerance (default 0.3%) are merged

Per transcript 14 & 16 the author ranks monthly > weekly > daily ("super critical" on the higher TFs). Including HTF pivots in the zone gives the backtest access to the levels he actually cares about, even though execution still happens on 5-min intraday.

ENTRY DETECTION (on 5-min intraday bars):
  • For each bar, scan all levels: if prior close is on one side and current close is on the other (a reclaim), tag as signal
  • Distance filters: ignore levels closer than minLevelDistancePercent (noise) or farther than maxLevelDistancePercent (unreachable)
  • Compute R:R from reclaim close to next level; require >= minRR (default 1.5)

RISK: shares = (capital × riskPercent) / (entry − stop).
EXIT: stop hit, target hit, or EOD bar (default 76 = ~10 min before close).

⚠️ BACKTEST CAVEAT: this runs on 5-min intraday bars — the ~60% WR day-trading regime, NOT the ~80%+ WR swing regime the author advocates. The swing edge is outside this backtest's scope (would need a daily/weekly bar engine).`,
        source: 'Dumb Hunter transcripts #12-16: DMC Gold Strategy, Updated Method, ICT-Flagged, Trend Determination, Identifying Levels',
        params: {
          pivotLookback: 3,
          minRR: 1.5,
          levelMergeTolerance: 0.003,
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
          stopLossPercent: 1,
          takeProfitPercent: 2,
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
