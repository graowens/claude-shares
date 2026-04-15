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
  /**
   * Check if 200MA is "relatively flat" as Emanuel requires.
   * Compares 200MA now vs 200MA from 20 bars ago — if slope > 5%, it's trending.
   */
  private is200MAFlat(bars: Array<{ close: number }>, ma200Now: number): boolean {
    if (bars.length < 220) return true; // not enough data, assume flat
    const slice20ago = bars.slice(-220, -20);
    if (slice20ago.length < 200) return true;
    const ma200then = slice20ago.slice(-200).reduce((s, b) => s + b.close, 0) / 200;
    const slopePercent = Math.abs(ma200Now - ma200then) / ma200then * 100;
    return slopePercent < 5; // < 5% change over 20 bars = relatively flat
  }

  /**
   * Find swing highs/lows from daily bars for proper S/R detection.
   * A swing high has lower highs on both sides (3-bar pivot).
   * A swing low has higher lows on both sides.
   */
  private findSwingLevels(bars: Array<{ high: number; low: number; close: number }>): {
    swingHighs: number[];
    swingLows: number[];
  } {
    const swingHighs: number[] = [];
    const swingLows: number[] = [];
    for (let i = 2; i < bars.length - 2; i++) {
      // 5-bar pivot: middle bar higher/lower than 2 on each side
      if (
        bars[i].high > bars[i - 1].high && bars[i].high > bars[i - 2].high &&
        bars[i].high > bars[i + 1].high && bars[i].high > bars[i + 2].high
      ) {
        swingHighs.push(bars[i].high);
      }
      if (
        bars[i].low < bars[i - 1].low && bars[i].low < bars[i - 2].low &&
        bars[i].low < bars[i + 1].low && bars[i].low < bars[i + 2].low
      ) {
        swingLows.push(bars[i].low);
      }
    }
    return { swingHighs, swingLows };
  }

  /**
   * Determine dailyContext using proper swing structure analysis.
   * Uses full daily bar history, not just 10-day high/low.
   */
  private determineDailyContext(
    bars: Array<{ high: number; low: number; close: number }>,
    gapPercent: number,
    prevClose: number,
    openPrice: number,
    ma200: number | null,
    trendDirection: string,
  ): string {
    const isGapUp = gapPercent > 0;
    const { swingHighs, swingLows } = bars.length >= 10
      ? this.findSwingLevels(bars.slice(-60)) // Use last 60 bars (~3 months)
      : { swingHighs: [], swingLows: [] };

    if (isGapUp) {
      // Best: gap ends a downtrend (Emanuel's #1 rule)
      if (trendDirection === 'downtrend') {
        return 'gap_ends_downtrend';
      }
      // Gap crosses above 200MA
      if (ma200 !== null && prevClose < ma200 && openPrice > ma200) {
        return 'gap_above_200ma';
      }
      // Gap breaks above swing high resistance (proper S/R)
      if (swingHighs.length >= 1) {
        const recentSwingHigh = swingHighs[swingHighs.length - 1];
        if (prevClose <= recentSwingHigh && openPrice > recentSwingHigh) {
          return 'gap_above_resistance';
        }
      }
      // Fallback: breaks above recent 20-day high
      if (bars.length >= 20) {
        const recentMax = Math.max(...bars.slice(-20).map(b => b.high));
        if (openPrice > recentMax) {
          return 'gap_above_resistance';
        }
      }
    } else {
      // Gap crosses below 200MA
      if (ma200 !== null && prevClose > ma200 && openPrice < ma200) {
        return 'gap_below_200ma';
      }
      // Gap ends an uptrend
      if (trendDirection === 'uptrend') {
        return 'gap_ends_uptrend';
      }
      // Gap breaks below swing low support (proper S/R)
      if (swingLows.length >= 1) {
        const recentSwingLow = swingLows[swingLows.length - 1];
        if (prevClose >= recentSwingLow && openPrice < recentSwingLow) {
          return 'gap_below_support';
        }
      }
      // Fallback: breaks below recent 20-day low
      if (bars.length >= 20) {
        const recentMin = Math.min(...bars.slice(-20).map(b => b.low));
        if (openPrice < recentMin) {
          return 'gap_below_support';
        }
      }
    }

    return 'other';
  }

  /**
   * Calculate trend direction using a wider window (10-day comparison).
   * Also returns the 20MA values for use in scoring.
   */
  private calculateTrend(bars: Array<{ close: number }>): {
    trendDirection: string;
    ma20: number | null;
    ma20TenDaysAgo: number | null;
  } {
    if (bars.length < 20) return { trendDirection: 'sideways', ma20: null, ma20TenDaysAgo: null };

    const last20 = bars.slice(-20);
    const ma20 = last20.reduce((sum, b) => sum + b.close, 0) / 20;

    let ma20TenDaysAgo: number | null = null;
    if (bars.length >= 30) {
      // 20MA from 10 bars ago (wider window than the old 5-bar comparison)
      const prev20 = bars.slice(-30, -10);
      ma20TenDaysAgo = prev20.reduce((sum, b) => sum + b.close, 0) / 20;
    }

    let trendDirection = 'sideways';
    if (ma20 !== null && ma20TenDaysAgo !== null) {
      const changePct = ((ma20 - ma20TenDaysAgo) / ma20TenDaysAgo) * 100;
      // Need > 0.5% change over 10 bars to count as trending (avoids noise)
      if (changePct > 0.5) trendDirection = 'uptrend';
      else if (changePct < -0.5) trendDirection = 'downtrend';
    }

    return { trendDirection, ma20, ma20TenDaysAgo };
  }

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
    ma200Flat?: boolean;
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
    if (candidate.bars && candidate.bars.length >= 10) {
      const pivotBreak = this.detectPivotBreak(candidate.bars, candidate.currentPrice, isGapUp);
      if (pivotBreak) {
        score += 20;
        reasons.push('Gap breaks above prior pivot highs — confirms trend reversal');
      }
    }

    // ──────────────────────────────────────────────────────────
    // RULE 3: Gap crosses key level — 200MA or support/resistance (20 pts)
    // Emanuel: "It gapped above the 200 MA" = very bullish
    // A gap crossing 200MA triggers institutional participation
    // 200MA should be "relatively flat" to be effective
    // ──────────────────────────────────────────────────────────
    if (candidate.dailyContext === 'gap_above_200ma' || candidate.dailyContext === 'gap_below_200ma') {
      if (candidate.ma200Flat !== false) {
        score += 20;
        reasons.push('Gap crosses flat 200MA — major institutional level');
      } else {
        score += 10;
        reasons.push('Gap crosses 200MA but MA is steeply trending (less effective)');
      }
    } else if (candidate.dailyContext === 'gap_above_resistance' || candidate.dailyContext === 'gap_below_support') {
      score += 15;
      reasons.push('Gap clears key support/resistance level');
    } else if (candidate.dailyContext === 'other') {
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
        score += 15;
        reasons.push('20MA confirms prior trend existed — real reversal');
      } else {
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
    // Use the last 40 bars (~2 months) for relevant pivot detection
    const recent = bars.slice(-40);
    if (recent.length < 5) return false;

    // Find swing highs and lows using 3-bar pivot detection
    const pivotHighs: number[] = [];
    const pivotLows: number[] = [];

    for (let i = 1; i < recent.length - 1; i++) {
      if (recent[i].high > recent[i - 1].high && recent[i].high > recent[i + 1].high) {
        pivotHighs.push(recent[i].high);
      }
      if (recent[i].low < recent[i - 1].low && recent[i].low < recent[i + 1].low) {
        pivotLows.push(recent[i].low);
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

        // Calculate trend using wider 10-day window
        const trend = this.calculateTrend(bars);
        const { trendDirection, ma20 } = trend;

        // Calculate 200MA
        let ma200: number | null = null;
        let ma200Flat = true;
        if (bars.length >= 200) {
          const last200 = bars.slice(-200);
          ma200 = last200.reduce((sum, b) => sum + b.close, 0) / 200;
          ma200Flat = this.is200MAFlat(bars, ma200);
        }

        // Determine daily context using proper swing structure
        const dailyContext = this.determineDailyContext(
          bars,
          candidate.gapPercent,
          candidate.prevClose,
          candidate.currentPrice,
          ma200,
          trendDirection,
        );

        // Score with full bars for pivot detection
        const { score, reasons } = this.scoreGap({
          gapPercent: candidate.gapPercent,
          prevClose: candidate.prevClose,
          currentPrice: candidate.currentPrice,
          volume: candidate.preMarketVolume,
          ma20,
          ma200,
          trendDirection,
          dailyContext,
          bars,
          ma200Flat,
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

  async getAllScanDates(): Promise<string[]> {
    const raw = await this.repo
      .createQueryBuilder('g')
      .select('DISTINCT g.scanDate', 'scanDate')
      .orderBy('g.scanDate', 'ASC')
      .getRawMany();
    return raw.map((r) => {
      // MySQL may return Date object or string — normalise to YYYY-MM-DD
      const d = r.scanDate;
      if (d instanceof Date) return d.toISOString().split('T')[0];
      if (typeof d === 'string' && d.length > 10) return d.split('T')[0];
      return String(d);
    });
  }

  async getAllResults(date: string): Promise<GapScanResult[]> {
    return this.repo.find({
      where: { scanDate: date },
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

        // Calculate trend using wider 10-day window
        const trend = this.calculateTrend(barsUpToDate);
        const { trendDirection, ma20 } = trend;

        // Calculate 200MA + flatness check
        let ma200: number | null = null;
        let ma200Flat = true;
        if (barsUpToDate.length >= 200) {
          const last200 = barsUpToDate.slice(-200);
          ma200 = last200.reduce((sum, b) => sum + b.close, 0) / 200;
          ma200Flat = this.is200MAFlat(barsUpToDate, ma200);
        }

        // Determine daily context using proper swing structure
        const dailyContext = this.determineDailyContext(
          barsUpToDate,
          candidate.gapPercent,
          prevBar.close,
          candidate.openPrice,
          ma200,
          trendDirection,
        );

        // Score with full bars for pivot detection
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
          ma200Flat,
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
