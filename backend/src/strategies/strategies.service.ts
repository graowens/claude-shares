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

  async remove(id: number): Promise<void> {
    await this.repo.delete(id);
  }

  private async seedDefaults() {
    const defaults = [
      {
        name: 'Gap Scalp - Trend Reversal',
        description: `Emanuel's "One and Done" setup. Scan for stocks gapping up (or down) that end a pre-existing downtrend on the daily timeframe. The gap should break above prior lower highs, trapping short sellers and triggering a squeeze. Enter on the first breakout, retracement with bottoming tail, or opening range breakout (1-2-5 min high/low) in the first hour of market open. Use TradingView pre-market screener to find gap stocks, then analyse the daily chart for trend reversal criteria. Best on stocks with 15%+ gaps that break above key daily pivots.`,
        source: 'emmanuel-1.txt',
        params: {
          minGapPercent: 15,
          timeframe: '1m',
          entryType: 'breakout',
          maxEntryDelayMinutes: 60,
          useRising20MA: true,
        },
        enabled: true,
      },
      {
        name: 'Bar-by-Bar Trail Management',
        description: `Emanuel's trailing stop strategy for managing winning trades. Once a trade reaches 2:1 R:R, activate bar-by-bar management: raise stop-loss to each completed candle's low (for longs) or high (for shorts). Start on 15-minute candles for wider room, then tighten to 5-minute or 2-minute as trade accelerates past 4-5R. This allows capturing large moves while securing profits. The key is: wider timeframe trail = more room to breathe but exit later; tighter timeframe trail = secure profits faster but risk being shaken out.`,
        source: 'emmanuel-2.txt',
        params: {
          activateAtRR: 2,
          initialTrailTimeframe: '15m',
          tightenAtRR: 5,
          tightenToTimeframe: '5m',
        },
        enabled: true,
      },
      {
        name: '1-2-3 Pattern Entry',
        description: `Emanuel's 1-2-3 setup. Pattern: (1) Igniting bar - a strong momentum candle, (2) Resting bar - a doji or small-body candle (consolidation), (3) Triggering bar - breaks above the resting bar's high (long) or below its low (short). Entry above resting bar high, stop-loss below resting bar low. Works on 1m, 5m, and 15m timeframes. Best when the resting bar is a doji or bottoming tail. Often appears after initial gap momentum.`,
        source: 'emmanuel-1.txt',
        params: {
          timeframes: ['1m', '5m', '15m'],
          restingBarType: 'doji_or_bottoming_tail',
          entryBuffer: 0.01,
        },
        enabled: true,
      },
      {
        name: 'AAA Value Area Setup',
        description: `Fabio's AAA (Triple-A) setup. Trade from the value area low to value area high using order flow analysis. Wait for the first 30 minutes of the session for market participants to establish direction. Look for aggressive sellers getting absorbed at the value area low - big trades hitting a "wall" of buyers. Enter long with tight stop below the absorption zone, target the value area high. Risk:reward typically 1:4 to 1:5. Scale in as position moves in your favour. Move to risk-free as soon as possible. Best on momentum/trending days, not consolidation days.`,
        source: 'trading-live-best-scalper.txt',
        params: {
          waitMinutes: 30,
          minRiskReward: 4,
          scaleIn: true,
          moveToBreakEvenASAP: true,
        },
        enabled: false,
      },
      {
        name: 'Momentum Squeeze',
        description: `Fabio's momentum/squeeze setup. Place buy stops above resistance levels where sellers are being absorbed. When sellers fail to push through and get "annihilated", the resulting short squeeze creates rapid upward expansion. Use tight stops below the absorption zone. Risk is small ($800-2000) with potential for $5,000-10,000 profit. Key: only enter when you see aggressive buyers protecting a level and sellers failing. Cancel orders if sellers break through - the setup is invalidated. Dynamic position scaling: start small, add contracts as you get confirmed.`,
        source: 'trading-live-best-scalper.txt',
        params: {
          entryType: 'buy_stop_above_resistance',
          maxRiskPerTrade: 2000,
          targetMultiple: 5,
          dynamicScaling: true,
        },
        enabled: false,
      },
      {
        name: 'Hyper-Scalping Risk Model',
        description: `Fabio's overall risk management framework. Set a maximum daily drawdown (e.g. $10,000). Take consistent small wins with high R:R (average win $1,000/contract, average loss $600/contract). Win rate 43-49% is acceptable when average winners significantly exceed average losers. Never hold for the full move - take partials and re-enter. Risk only profits on subsequent trades after hitting daily target. Stop trading after capturing the main move - don't trade consolidation (expensive due to commissions). 70% of market time is consolidation, so trade the 30% expansion efficiently. Walk away after a great session.`,
        source: 'trading-live-best-scalper.txt',
        params: {
          maxDailyDrawdown: 10000,
          targetWinRate: 0.45,
          avgWinToLossRatio: 1.67,
          riskProfitsOnly: true,
          stopAfterTarget: true,
        },
        enabled: false,
      },
    ];

    for (const def of defaults) {
      const exists = await this.repo.findOneBy({ name: def.name });
      if (!exists) {
        await this.repo.save(this.repo.create(def));
        this.logger.log(`Seeded default strategy: ${def.name}`);
      }
    }
  }
}
