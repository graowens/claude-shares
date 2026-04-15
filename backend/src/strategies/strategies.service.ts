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
      'Hyper-Scalping Risk Model',
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
        description: `Emanuel's complete gap scalping system (consolidated from all transcripts). This is ONE integrated strategy with multiple components:

SCANNING: Every morning, scan for stocks gapping up that END a pre-existing downtrend, or gapping down that END an uptrend. Three criteria for high-quality gaps: (1) Gap ends a trend, (2) Gap clears key support/resistance, (3) Gap opens directly above resistance or below support. Pass on 95% of gaps.

200MA BIAS: The 200MA (daily, should be relatively flat) acts as a FLOOR when price is above it and a CEILING when price is below it. Gap UP above 200MA = very bullish, triggers major breakout. Gap DOWN below 200MA = bearish, look for shorts. Squeeze play: rising 20MA crosses through flat 200MA, prices oscillate until explosive breakout.

20MA TREND FILTER: The 20MA is the primary trend-following tool. Rising 20MA under price = uptrend (buy retrace to 20MA). Declining 20MA over price = downtrend (short retrace to 20MA). IGNORE flat 20MAs — no momentum. Use daily 20MA for bias, intraday 20MA for entries. Also measures extension — too far from 20MA means overextended.

ENTRY METHODS (try in order):
1. Opening Range Breakout: First 5-min candle high/low as entry trigger, stop other side. Skip if candle too wide (>3%).
2. Breakout: Consolidation into rising 20MA, entry over base, stop under base.
3. Retracement: Pullback to 20MA, look for bottoming tail or doji, entry above it.
4. 1-2-3 Pattern: Igniting bar → resting bar (doji/bottoming tail) → triggering bar breaks resting bar high/low.

TRADE MANAGEMENT (Bar-by-Bar Trail): Once at 2:1 R:R, activate bar-by-bar trailing — raise stop to each completed bar's low (longs) or high (shorts). Start on 15-min bars for room to breathe. Tighten to 5-min bars once past 4-5R to lock in profits.`,
        source: 'All Emanuel transcripts',
        params: {
          stopLossPercent: 1,
          takeProfitPercent: 2,
          minGapPercent: 5,
          minScoreForTrade: 30,
          maxOpeningRangePercent: 3,
          ma20Period: 20,
          ma200Period: 200,
          barByBarActivateAtRR: 2,
          barByBarTightenAtRR: 5,
          initialTrailBars: 3,
          tightTrailBars: 1,
        },
        enabled: true,
        backtestEnabled: true,
      },
      {
        name: 'Claude - Stop Gap Reversal',
        author: 'Claude',
        description: `Claude's counter-trend strategy exploiting stop-loss cascades. When a stock gaps through a key support/resistance level (recent swing highs/lows, 200MA, 20MA), it triggers a wave of stop-loss orders. This creates a temporary liquidity imbalance — once the stops are exhausted, selling/buying pressure disappears and price tends to snap back toward the breached level.

S/R DETECTION (from 30 days of daily bars): Identify swing lows (higher bars on both sides) and swing highs as key levels where stop orders cluster. Also use 200MA and 20MA as institutional S/R levels.

STOP GAP FILTER: The gap must punch THROUGH at least one identified S/R level. Gap down through support = sell stops triggered = reversal buy. Gap up through resistance = buy stops triggered = reversal short. Stronger signal when multiple S/R levels are breached.

ENTRY: Wait 2-3 intraday bars (10-15 min) for the stop cascade to exhaust. Look for a reversal bar showing rejection: bottoming tail after gap down (buyers stepping in) or topping tail after gap up (sellers stepping in). Enter counter-trend on break of the reversal bar.

STOP: Below the extreme low of the stop run (for longs) or above the extreme high (for shorts). This is tight because if the stop hunt thesis is correct, price should not make new extremes.

TARGETS: Target 1 = the breached S/R level (price returning to where it came from). Target 2 = previous day's close (full gap fill). Trail remainder bar-by-bar.

EDGE: This is a mean-reversion strategy — the opposite of Emanuel's trend-following approach. It works specifically because stop cascades create predictable overreactions that institutions then fade.`,
        source: 'Claude analysis of stop gap mechanics',
        params: {
          dailyLookback: 30,
          swingLookback: 5,
          waitBarsForExhaustion: 3,
          minSRLevelsBreached: 1,
          stopBufferPercent: 0.1,
          trailAfterTarget1: true,
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
