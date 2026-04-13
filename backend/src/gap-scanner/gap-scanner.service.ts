import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { GapScanResult } from './entities/gap-scan-result.entity';
import { AlpacaService } from '../alpaca/alpaca.service';
import { AssetCacheService } from '../alpaca/asset-cache.service';
import { WatchlistService } from '../watchlist/watchlist.service';
import { SettingsService } from '../settings/settings.service';

const SCAN_UNIVERSE = [
  // NASDAQ - Tech & Growth
  'AAPL','MSFT','TSLA','NVDA','AMD','META','AMZN','GOOG','NFLX',
  'SOFI','PLTR','NIO','LCID','RIVN','MARA','RIOT','COIN',
  'GME','AMC','BB','NOK','SNAP','PINS','SQ','PYPL','SHOP',
  'DKNG','RBLX','U','CRWD','NET','SNOW','MDB','ABNB','UBER','LYFT',
  'ARM','SMCI','MSTR','IONQ','RGTI','QUBT','SOUN','RKLB','LUNR','ACHR',
  'INTC','CSCO','CMCSA','PEP','COST','ADBE','CRM','ORCL','QCOM','AVGO',
  // NYSE - Blue Chips & Financials
  'JPM','BAC','WFC','GS','MS','C','V','MA','DIS','NKE',
  'WMT','HD','MCD','KO','PG','JNJ','UNH','PFE','MRK','ABBV',
  'XOM','CVX','COP','BA','CAT','DE','GE','HON','MMM','IBM',
  'F','GM','T','VZ','SO','DUK','NEE',
  // ARCA - ETFs
  'SPY','QQQ','IWM','DIA','XLF','XLE','XLK','XLV','XLI','XLP',
  'GLD','SLV','TLT','HYG','VXX','ARKK','ARKG','EEM','EFA','VWO',
  // AMEX/BATS
  'UVXY','SQQQ','TQQQ','SPXS','SPXL',
];

@Injectable()
export class GapScannerService {
  private readonly logger = new Logger(GapScannerService.name);
  private readonly dataBaseUrl = 'https://data.alpaca.markets';

  constructor(
    @InjectRepository(GapScanResult)
    private readonly repo: Repository<GapScanResult>,
    private readonly alpaca: AlpacaService,
    private readonly assetCache: AssetCacheService,
    private readonly config: ConfigService,
    private readonly watchlistService: WatchlistService,
    private readonly settingsService: SettingsService,
  ) {}

  /**
   * Emanuel Score (0-100).
   *
   * Based on Emanuel's exact rules from his transcripts:
   *  1. Gaps that END a preexisting trend (his #1 rule — "pass on 95% of gaps")
   *  2. Gap breaks above prior pivot highs (lower highs) or below prior pivot lows (higher lows)
   *  3. Gap crosses a key level (200MA, support/resistance)
   *  4. 20MA must be trending, not flat ("I don't trade flat 20MAs")
   *  5. Significant volume ("gapping up on significant volume")
   *  6. Daily chart structure makes sense
   *
   * Gap size alone does NOT determine quality — a 15% gap can fail,
   * a 58% gap can work. Structure > size.
   */
  private scoreGap(candidate: {
    gapPercent: number;
    prevClose: number;
    currentPrice: number;
    volume: number;
    ma20: number | null;
    ma200: number | null;
    trendDirection: string;
    dailyContext: string;
    bars?: Array<{ close: number; high: number; low: number }>;
  }): { score: number; reasons: string[] } {
    let score = 0;
    const reasons: string[] = [];
    const isGapUp = candidate.gapPercent > 0;

    // ──────────────────────────────────────────────────────────
    // RULE 1: Gap ends a preexisting trend (35 pts)
    // Emanuel: "You want to find gap ups that end preexisting downtrends
    //  on the daily time frame... these gaps can be extremely powerful
    //  because they shock all sellers that were participating"
    // ──────────────────────────────────────────────────────────
    if (
      (isGapUp && candidate.dailyContext === 'gap_ends_downtrend') ||
      (!isGapUp && candidate.dailyContext === 'gap_ends_uptrend')
    ) {
      score += 35;
      reasons.push('Ends prior trend — trapped traders must exit (Emanuel\'s #1 rule)');
    }

    // ──────────────────────────────────────────────────────────
    // RULE 2: Gap breaks above prior pivot highs / below pivot lows (20 pts)
    // Emanuel: "It gapped above this prior pivot. It gapped above
    //  this lower high" — confirms the trend break is real
    // ──────────────────────────────────────────────────────────
    if (candidate.bars && candidate.bars.length >= 20) {
      const recent = candidate.bars.slice(-20);
      const pivotBreak = this.detectPivotBreak(recent, candidate.currentPrice, isGapUp);
      if (pivotBreak) {
        score += 20;
        reasons.push('Gap breaks above prior pivot highs — confirms trend reversal');
      }
    }

    // ──────────────────────────────────────────────────────────
    // RULE 3: Gap crosses key level — 200MA or support/resistance (20 pts)
    // Emanuel: "It gapped above the 200 MA" = very bullish
    // A gap crossing 200MA triggers institutional participation
    // ──────────────────────────────────────────────────────────
    if (candidate.dailyContext === 'gap_above_200ma' || candidate.dailyContext === 'gap_below_200ma') {
      score += 20;
      reasons.push('Gap crosses 200MA — major level break, institutional trigger');
    } else if (candidate.dailyContext === 'gap_above_resistance' || candidate.dailyContext === 'gap_below_support') {
      score += 15;
      reasons.push('Gap clears key support/resistance level');
    } else if (candidate.dailyContext === 'other') {
      // No recognisable daily structure — Emanuel would skip this
      score -= 10;
      reasons.push('No clear daily chart context — Emanuel would skip');
    }

    // ──────────────────────────────────────────────────────────
    // RULE 4: 20MA must be trending (15 pts)
    // Emanuel: "I don't trade flat 20MAs — they indicate no momentum"
    // Rising 20MA trending against gap = confirms prior trend to reverse
    // Flat 20MA = avoid entirely
    // ──────────────────────────────────────────────────────────
    if (candidate.trendDirection === 'sideways') {
      score -= 15;
      reasons.push('Flat 20MA — no momentum, Emanuel says avoid');
    } else if (candidate.ma20 !== null) {
      if (
        (isGapUp && candidate.trendDirection === 'downtrend') ||
        (!isGapUp && candidate.trendDirection === 'uptrend')
      ) {
        // 20MA was trending against the gap — confirms there IS a trend to reverse
        score += 15;
        reasons.push('20MA confirms prior trend existed — real reversal');
      } else {
        // 20MA already aligned with gap — continuation, not reversal
        // Emanuel's strategy is about reversals, not continuations
        score += 5;
        reasons.push('20MA already aligned with gap — continuation (not Emanuel\'s primary setup)');
      }
    }

    // ──────────────────────────────────────────────────────────
    // RULE 5: Significant volume (10 pts)
    // Emanuel: "gapping up on significant volume" is required
    // ──────────────────────────────────────────────────────────
    if (candidate.volume >= 1_000_000) {
      score += 10;
      reasons.push('Significant volume (1M+) — strong participation');
    } else if (candidate.volume >= 500_000) {
      score += 5;
      reasons.push('Decent volume (500K+)');
    } else if (candidate.volume < 100_000) {
      score -= 5;
      reasons.push('Low volume — weak participation');
    }

    // Clamp to 0-100
    score = Math.max(0, Math.min(100, score));

    return { score, reasons };
  }

  /**
   * Detect whether the gap price breaks above prior pivot highs (for gap-ups)
   * or below prior pivot lows (for gap-downs).
   *
   * Emanuel: "It gapped above this prior pivot. It gapped above this lower high."
   *
   * For a downtrend, we look for "lower highs" — the swing highs are descending.
   * If the gap opens above the most recent lower high, the downtrend structure is broken.
   */
  private detectPivotBreak(
    bars: Array<{ close: number; high: number; low: number }>,
    gapPrice: number,
    isGapUp: boolean,
  ): boolean {
    // Find swing highs and lows using a simple 3-bar pivot detection
    const pivotHighs: number[] = [];
    const pivotLows: number[] = [];

    for (let i = 1; i < bars.length - 1; i++) {
      if (bars[i].high > bars[i - 1].high && bars[i].high > bars[i + 1].high) {
        pivotHighs.push(bars[i].high);
      }
      if (bars[i].low < bars[i - 1].low && bars[i].low < bars[i + 1].low) {
        pivotLows.push(bars[i].low);
      }
    }

    if (isGapUp && pivotHighs.length >= 2) {
      // Check for lower highs (downtrend structure)
      const lastTwo = pivotHighs.slice(-2);
      const hasLowerHighs = lastTwo[1] < lastTwo[0];
      // Gap breaks above the most recent lower high = trend break
      if (hasLowerHighs && gapPrice > lastTwo[1]) {
        return true;
      }
    } else if (!isGapUp && pivotLows.length >= 2) {
      // Check for higher lows (uptrend structure)
      const lastTwo = pivotLows.slice(-2);
      const hasHigherLows = lastTwo[1] > lastTwo[0];
      // Gap breaks below the most recent higher low = trend break
      if (hasHigherLows && gapPrice < lastTwo[1]) {
        return true;
      }
    }

    return false;
  }

  private get alpacaHeaders() {
    return {
      'APCA-API-KEY-ID': this.config.get('ALPACA_API_KEY'),
      'APCA-API-SECRET-KEY': this.config.get('ALPACA_API_SECRET'),
    };
  }

  async scanGaps(): Promise<GapScanResult[]> {
    const today = new Date().toISOString().split('T')[0];
    const gapThreshold = await this.settingsService.getNumber('gapThresholdPercent', 5);
    const allowShortSelling = await this.settingsService.getBoolean('allowShortSelling', true);

    this.logger.log(`Starting gap scan for ${today} with threshold ${gapThreshold}% (short selling: ${allowShortSelling})`);

    // Step 1: Get top movers from Alpaca screener
    let moverSymbols: string[] = [];
    try {
      const moversResp = await axios.get(
        `${this.dataBaseUrl}/v1beta1/screener/stocks/movers?top=50`,
        { headers: this.alpacaHeaders },
      );
      const movers = moversResp.data;
      // Extract symbols from gainers (gap ups)
      if (movers.gainers) {
        moverSymbols = movers.gainers.map((m: any) => m.symbol);
      }
      // Include losers (gap downs) if short selling is allowed
      if (allowShortSelling && movers.losers) {
        const loserSymbols = movers.losers.map((m: any) => m.symbol);
        moverSymbols = [...moverSymbols, ...loserSymbols];
      }
      this.logger.log(`Found ${moverSymbols.length} top movers`);
    } catch (err) {
      this.logger.error(`Failed to fetch movers: ${err.message}`);
      return [];
    }

    if (moverSymbols.length === 0) return [];

    // Filter by configured exchanges
    const exchangesSetting = await this.settingsService.getString('exchanges', 'NASDAQ,NYSE');
    const allowedExchanges = exchangesSetting.split(',').map(e => e.trim());
    moverSymbols = moverSymbols.filter(symbol => {
      const exchange = this.assetCache.getExchangeForSymbol(symbol);
      return exchange && allowedExchanges.includes(exchange);
    });
    this.logger.log(`After exchange filter (${allowedExchanges.join(',')}): ${moverSymbols.length} movers`);

    // Step 2: Get snapshots for all mover symbols
    let snapshots: Record<string, any> = {};
    try {
      const symbolsParam = moverSymbols.join(',');
      const snapResp = await axios.get(
        `${this.dataBaseUrl}/v2/stocks/snapshots?symbols=${symbolsParam}&feed=iex`,
        { headers: this.alpacaHeaders },
      );
      snapshots = snapResp.data;
    } catch (err) {
      this.logger.error(`Failed to fetch snapshots: ${err.message}`);
      return [];
    }

    // Step 3: Calculate gaps and filter
    const candidates: Array<{
      symbol: string;
      prevClose: number;
      currentPrice: number;
      gapPercent: number;
      preMarketVolume: number;
    }> = [];

    for (const symbol of moverSymbols) {
      const snap = snapshots[symbol];
      if (!snap) continue;

      const prevClose = snap.prevDailyBar?.c;
      const currentPrice = snap.latestTrade?.p;
      if (!prevClose || !currentPrice || prevClose === 0) continue;

      // Price filter
      if (currentPrice < 0.5) continue;

      const gapPercent = ((currentPrice - prevClose) / prevClose) * 100;

      // Filter by threshold: gap-ups must exceed threshold, gap-downs must exceed negative threshold
      if (gapPercent > 0 && gapPercent < gapThreshold) continue;
      if (gapPercent < 0 && gapPercent > -gapThreshold) continue;
      if (gapPercent === 0) continue;

      const preMarketVolume = snap.minuteBar?.v || 0;

      candidates.push({
        symbol,
        prevClose,
        currentPrice,
        gapPercent,
        preMarketVolume,
      });
    }

    // Sort by absolute gap percent descending (biggest movers first, whether up or down)
    candidates.sort((a, b) => Math.abs(b.gapPercent) - Math.abs(a.gapPercent));
    const top = candidates.slice(0, 20);

    this.logger.log(`Found ${candidates.length} gap candidates, processing top ${top.length}`);

    // Step 4: For top results, fetch daily bars for MA calculation
    const results: GapScanResult[] = [];

    for (const candidate of top) {
      try {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 300); // ~200 trading days + buffer

        const bars = await this.alpaca.getHistoricalBars(
          candidate.symbol,
          '1Day',
          startDate.toISOString().split('T')[0],
          endDate.toISOString().split('T')[0],
        );

        let ma20: number | null = null;
        let ma200: number | null = null;
        let ma20FiveDaysAgo: number | null = null;
        let trendDirection = 'sideways';
        let dailyContext = 'other';

        if (bars.length >= 20) {
          // Calculate 20MA (last 20 bars)
          const last20 = bars.slice(-20);
          ma20 = last20.reduce((sum, b) => sum + b.close, 0) / 20;

          // Calculate 20MA from 5 bars ago
          if (bars.length >= 25) {
            const prev20 = bars.slice(-25, -5);
            ma20FiveDaysAgo = prev20.reduce((sum, b) => sum + b.close, 0) / 20;
          }
        }

        if (bars.length >= 200) {
          const last200 = bars.slice(-200);
          ma200 = last200.reduce((sum, b) => sum + b.close, 0) / 200;
        }

        // Determine trend direction
        if (ma20 !== null && ma20FiveDaysAgo !== null) {
          if (ma20 > ma20FiveDaysAgo) {
            trendDirection = 'uptrend';
          } else if (ma20 < ma20FiveDaysAgo) {
            trendDirection = 'downtrend';
          }
        }

        // Determine daily context
        if (candidate.gapPercent > 0) {
          // Gap-up contexts
          if (trendDirection === 'downtrend') {
            dailyContext = 'gap_ends_downtrend';
          } else if (
            ma200 !== null &&
            candidate.prevClose < ma200 &&
            candidate.currentPrice > ma200
          ) {
            dailyContext = 'gap_above_200ma';
          } else if (bars.length >= 10) {
            const recentHighs = bars.slice(-10).map((b) => b.close);
            const recentMax = Math.max(...recentHighs);
            if (candidate.currentPrice > recentMax) {
              dailyContext = 'gap_above_resistance';
            }
          }
        } else {
          // Gap-down contexts
          if (
            ma200 !== null &&
            candidate.prevClose > ma200 &&
            candidate.currentPrice < ma200
          ) {
            dailyContext = 'gap_below_200ma';
          } else if (trendDirection === 'uptrend') {
            dailyContext = 'gap_ends_uptrend';
          } else if (bars.length >= 10) {
            const recentLows = bars.slice(-10).map((b) => b.close);
            const recentMin = Math.min(...recentLows);
            if (candidate.currentPrice < recentMin) {
              dailyContext = 'gap_below_support';
            }
          }
        }

        const { score, reasons } = this.scoreGap({
          gapPercent: candidate.gapPercent,
          prevClose: candidate.prevClose,
          currentPrice: candidate.currentPrice,
          volume: candidate.preMarketVolume,
          ma20,
          ma200,
          trendDirection,
          dailyContext,
        });

        const result = this.repo.create({
          symbol: candidate.symbol,
          prevClose: candidate.prevClose,
          currentPrice: candidate.currentPrice,
          gapPercent: candidate.gapPercent,
          preMarketVolume: candidate.preMarketVolume,
          ma20,
          ma200,
          trendDirection,
          dailyContext,
          exchange: this.assetCache.getExchangeForSymbol(candidate.symbol) || undefined,
          selected: false,
          score,
          scoreReasons: reasons,
          scanDate: today,
        });

        results.push(result);
      } catch (err) {
        this.logger.error(`Error processing ${candidate.symbol}: ${err.message}`);
      }
    }

    // Save all results
    const saved = await this.repo.save(results);
    this.logger.log(`Saved ${saved.length} gap scan results for ${today}`);

    return saved.sort((a, b) => Math.abs(Number(b.gapPercent)) - Math.abs(Number(a.gapPercent)));
  }

  async getResults(date?: string): Promise<GapScanResult[]> {
    const scanDate = date || new Date().toISOString().split('T')[0];
    return this.repo.find({
      where: { scanDate },
      order: { gapPercent: 'DESC' },
    });
  }

  async selectStock(id: number): Promise<GapScanResult> {
    const result = await this.repo.findOneByOrFail({ id });
    result.selected = !result.selected;
    return this.repo.save(result);
  }

  async getSelected(date?: string): Promise<GapScanResult[]> {
    const scanDate = date || new Date().toISOString().split('T')[0];
    return this.repo.find({
      where: { scanDate, selected: true },
      order: { gapPercent: 'DESC' },
    });
  }

  async scanHistoricalGaps(date: string, symbols?: string[]): Promise<GapScanResult[]> {
    const gapThreshold = await this.settingsService.getNumber('gapThresholdPercent', 5);
    const allowShortSelling = await this.settingsService.getBoolean('allowShortSelling', true);
    const exchangesSetting = await this.settingsService.getString('exchanges', 'NASDAQ,NYSE');
    const allowedExchanges = exchangesSetting.split(',').map(e => e.trim());

    // If specific symbols passed, use those. Otherwise scan ALL symbols from selected exchanges.
    let scanSymbols: string[];
    if (symbols && symbols.length > 0) {
      scanSymbols = symbols;
    } else {
      scanSymbols = this.assetCache.getSymbolsByExchanges(allowedExchanges);
      this.logger.log(`Scanning ${scanSymbols.length} symbols from exchanges: ${allowedExchanges.join(', ')}`);
    }

    if (scanSymbols.length === 0) {
      this.logger.warn('No symbols to scan');
      return [];
    }

    // Step 1: Batch-fetch just 5 days of bars around the scan date (need prev close + scan date open)
    // We fetch 5 days to account for weekends/holidays
    const endDate = new Date(date);
    endDate.setDate(endDate.getDate() + 1); // include the scan date
    const startDate = new Date(date);
    startDate.setDate(startDate.getDate() - 7); // a week back covers weekends

    this.logger.log(`Step 1: Batch-fetching bars for ${scanSymbols.length} symbols to find gaps...`);
    const allBars = await this.alpaca.getMultiSymbolBars(
      scanSymbols,
      startDate.toISOString().split('T')[0],
      endDate.toISOString().split('T')[0],
    );

    // Step 2: Calculate gaps from bars
    const candidates: Array<{
      symbol: string;
      prevClose: number;
      openPrice: number;
      gapPercent: number;
      volume: number;
    }> = [];

    for (const [symbol, bars] of Object.entries(allBars)) {
      if (bars.length < 2) continue;

      // Find the bar for the scan date and the previous bar
      const dateBarIndex = bars.findIndex((b) => b.timestamp.split('T')[0] === date);
      if (dateBarIndex < 1) continue;

      const dateBar = bars[dateBarIndex];
      const prevBar = bars[dateBarIndex - 1];

      const gapPercent = ((dateBar.open - prevBar.close) / prevBar.close) * 100;

      if (gapPercent > 0 && gapPercent < gapThreshold) continue;
      if (gapPercent < 0 && gapPercent > -gapThreshold) continue;
      if (gapPercent === 0) continue;
      if (!allowShortSelling && gapPercent < 0) continue;
      if (dateBar.open < 0.5) continue;

      // Filter out likely garbage: require min price $1 and min volume 50k
      if (dateBar.open < 1 && Math.abs(gapPercent) > 500) continue;
      if ((dateBar.volume || 0) < 50000) continue;

      candidates.push({
        symbol,
        prevClose: prevBar.close,
        openPrice: dateBar.open,
        gapPercent,
        volume: dateBar.volume || 0,
      });
    }

    // Sort by absolute gap and take top 50 for detailed MA analysis
    candidates.sort((a, b) => Math.abs(b.gapPercent) - Math.abs(a.gapPercent));
    const top = candidates.slice(0, 50);

    this.logger.log(`Found ${candidates.length} gaps above threshold, processing top ${top.length} for MA analysis`);

    // Step 3: For top candidates only, fetch longer history for 20MA/200MA
    const results: GapScanResult[] = [];
    const maStartDate = new Date(date);
    maStartDate.setDate(maStartDate.getDate() - 300);

    for (const candidate of top) {
      try {
        const bars = await this.alpaca.getHistoricalBars(
          candidate.symbol,
          '1Day',
          maStartDate.toISOString().split('T')[0],
          endDate.toISOString().split('T')[0],
        );

        const dateBarIndex = bars.findIndex((b) => b.timestamp.split('T')[0] === date);
        if (dateBarIndex < 1) continue;

        const barsUpToDate = bars.slice(0, dateBarIndex + 1);
        const prevBar = bars[dateBarIndex - 1];

        let ma20: number | null = null;
        let ma200: number | null = null;
        let ma20FiveDaysAgo: number | null = null;
        let trendDirection = 'sideways';
        let dailyContext = 'other';

        if (barsUpToDate.length >= 20) {
          const last20 = barsUpToDate.slice(-20);
          ma20 = last20.reduce((sum, b) => sum + b.close, 0) / 20;
          if (barsUpToDate.length >= 25) {
            const prev20 = barsUpToDate.slice(-25, -5);
            ma20FiveDaysAgo = prev20.reduce((sum, b) => sum + b.close, 0) / 20;
          }
        }

        if (barsUpToDate.length >= 200) {
          const last200 = barsUpToDate.slice(-200);
          ma200 = last200.reduce((sum, b) => sum + b.close, 0) / 200;
        }

        if (ma20 !== null && ma20FiveDaysAgo !== null) {
          if (ma20 > ma20FiveDaysAgo) trendDirection = 'uptrend';
          else if (ma20 < ma20FiveDaysAgo) trendDirection = 'downtrend';
        }

        if (candidate.gapPercent > 0) {
          if (trendDirection === 'downtrend') {
            dailyContext = 'gap_ends_downtrend';
          } else if (ma200 !== null && prevBar.close < ma200 && candidate.openPrice > ma200) {
            dailyContext = 'gap_above_200ma';
          } else if (barsUpToDate.length >= 10) {
            const recentMax = Math.max(...barsUpToDate.slice(-10).map((b) => b.close));
            if (candidate.openPrice > recentMax) dailyContext = 'gap_above_resistance';
          }
        } else {
          if (ma200 !== null && prevBar.close > ma200 && candidate.openPrice < ma200) {
            dailyContext = 'gap_below_200ma';
          } else if (trendDirection === 'uptrend') {
            dailyContext = 'gap_ends_uptrend';
          } else if (barsUpToDate.length >= 10) {
            const recentMin = Math.min(...barsUpToDate.slice(-10).map((b) => b.close));
            if (candidate.openPrice < recentMin) dailyContext = 'gap_below_support';
          }
        }

        const { score, reasons } = this.scoreGap({
          gapPercent: candidate.gapPercent,
          prevClose: candidate.prevClose,
          currentPrice: candidate.openPrice,
          volume: candidate.volume,
          ma20,
          ma200,
          trendDirection,
          dailyContext,
          bars: barsUpToDate,
        });

        results.push(this.repo.create({
          symbol: candidate.symbol,
          prevClose: candidate.prevClose,
          currentPrice: candidate.openPrice,
          gapPercent: candidate.gapPercent,
          preMarketVolume: candidate.volume,
          ma20,
          ma200,
          trendDirection,
          dailyContext,
          exchange: this.assetCache.getExchangeForSymbol(candidate.symbol) || undefined,
          selected: false,
          score,
          scoreReasons: reasons,
          scanDate: date,
        }));
      } catch (err) {
        this.logger.error(`Error processing ${candidate.symbol}: ${err.message}`);
      }
    }

    const saved = await this.repo.save(results);
    this.logger.log(`Saved ${saved.length} historical gap scan results for ${date}`);

    return saved.sort(
      (a, b) => Math.abs(Number(b.gapPercent)) - Math.abs(Number(a.gapPercent)),
    );
  }

  async clearSelected(date?: string): Promise<void> {
    const scanDate = date || new Date().toISOString().split('T')[0];
    await this.repo.update({ scanDate, selected: true }, { selected: false });
    this.logger.log(`Cleared selected flags for ${scanDate}`);
  }

  async addSelectedToWatchlist(): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    const selected = await this.getSelected(today);

    if (selected.length === 0) {
      this.logger.warn('No selected gap scan results to add to watchlist');
      return;
    }

    const items = selected.map((result) => ({
      symbol: result.symbol,
      gapDirection: (Number(result.gapPercent) >= 0 ? 'up' : 'down') as 'up' | 'down',
      exchange: result.exchange || this.assetCache.getExchangeForSymbol(result.symbol) || undefined,
      scheduledDate: today,
      active: true,
      notes: `Gap ${result.gapPercent}% | ${result.dailyContext} | 20MA: ${result.ma20} | 200MA: ${result.ma200}`,
    }));

    await this.watchlistService.bulkAdd(items);
    this.logger.log(`Added ${items.length} selected gap stocks to watchlist`);
  }
}
