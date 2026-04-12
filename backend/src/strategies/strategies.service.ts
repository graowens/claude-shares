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
        description: `Emanuel's core gap scalping strategy. Every morning, scan for stocks gapping up that END a pre-existing downtrend on the daily timeframe, OR stocks gapping down that END a pre-existing uptrend. For gap-ups: the gap should break above prior lower highs, trapping short sellers and triggering a squeeze. For gap-downs: the gap should break below prior higher lows, trapping long holders and triggering a sell-off. Three criteria for high-quality gaps: (1) Gap ends a trend - surprises all participants on the wrong side, forcing them to exit. (2) Gap clears a key support/resistance area, triggering a larger-term daily/weekly breakout/breakdown. (3) Gap opens directly above resistance (longs) or directly below support (shorts). Focus on stocks showing clear momentum with significant pre-market volume. Pass on 95% of gaps - only take the highest quality ones with a matching intraday setup.`,
        source: 'Emmanuel - My Scalping Strategy is BORING.txt',
        params: {
          minGapPercent: 5,
          preferredGapPercent: 15,
          entryTypes: ['opening_range_breakout', 'breakout', 'retracement'],
          maxEntryDelayMinutes: 60,
          dailyTimeframeAnalysis: true,
        },
        enabled: true,
      },
      {
        name: 'Opening Range Breakout (High-Low)',
        description: `Emanuel's opening range breakout / high-low setup. Wait for the first candle to form after market open (preferably 5-minute for safety, or 1-2 minute for aggressive entries). For gap-ups: place entry ABOVE the candle's high, stop-loss BELOW the candle's low. For gap-downs: place entry BELOW the candle's low, stop-loss ABOVE the candle's high. The smaller the first candle (narrow range), the better the risk:reward. Avoid if the first candle is massive. This is the most aggressive entry method - best used when you're very confident in the daily gap quality. On 1-2 minute timeframes you can get shaken out easily; 5-minute is recommended.`,
        source: 'Emmanuel - My Scalping Strategy is BORING.txt',
        params: {
          preferredTimeframe: '5m',
          aggressiveTimeframe: '1m',
          preferNarrowRangeBar: true,
        },
        enabled: true,
      },
      {
        name: '20MA Trend Following',
        description: `Emanuel's primary indicator strategy. Use the 20-period Simple Moving Average as the ultimate trend-following tool. In an uptrend: 20MA is RISING and UNDER price - every retracement or consolidation into the 20MA is a potential long entry. In a downtrend: 20MA is DECLINING and OVER price - every retracement into the 20MA is a potential short entry. IGNORE flat 20MAs - they indicate no momentum/sideways action. Works on all timeframes: use daily 20MA for bias, then 5min/2min/1min 20MA for precise entries. Prices literally trade off the 20MA in trending stocks. Also use 20MA to measure extension - if price is far from 20MA, it's overextended and may revert.`,
        source: 'Emmanuel - The ONLY 2 indicators.txt',
        params: {
          maPeriod: 20,
          maType: 'SMA',
          entryOn: 'retracement_to_20ma',
          avoidFlat20MA: true,
          timeframes: ['1m', '2m', '5m', '15m', '1D'],
          extensionWarning: true,
        },
        enabled: true,
      },
      {
        name: '200MA Support & Resistance',
        description: `Emanuel's 200-period SMA strategy. The 200MA acts as a FLOOR (support) when price is above it, and a CEILING (resistance) when price is below it. Key setups: (1) Gap DOWN below 200MA = bearish bias, look for shorts off the declining 20MA on intraday. (2) Gap UP above 200MA = very bullish, triggering a major breakout. (3) Price bouncing off 200MA as support = long opportunity. (4) Squeeze play: when rising 20MA crosses through flat 200MA and price oscillates between them, eventually breaks out explosively. The 200MA should be relatively FLAT to be effective. Combine with 20MA for entries.`,
        source: 'Emmanuel - The ONLY 2 indicators.txt',
        params: {
          maPeriod: 200,
          maType: 'SMA',
          gapAbove200MA: 'very_bullish',
          gapBelow200MA: 'bearish',
          squeezePlay: true,
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
      if (exists) {
        exists.description = def.description;
        exists.source = def.source;
        exists.params = def.params;
        await this.repo.save(exists);
        this.logger.log(`Updated strategy: ${def.name}`);
      } else {
        await this.repo.save(this.repo.create(def));
        this.logger.log(`Seeded strategy: ${def.name}`);
      }
    }
  }
}
