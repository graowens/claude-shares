import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BacktestResult } from './entities/backtest-result.entity';
import { AlpacaService } from '../alpaca/alpaca.service';
import { GapScannerService } from '../gap-scanner/gap-scanner.service';
import { StrategiesService } from '../strategies/strategies.service';
import { RunBacktestDto } from './dto/run-backtest.dto';
import { simulateEmanuel, simulateFabio, simulateClaude, simulateProRealAlgos, simulateDumbHunter, simulateGeneric, generateDumbHunterSwingSignals, DUMB_HUNTER_SWING_DEFAULT_PARAMS, type ClaudeParams, CLAUDE_DEFAULT_PARAMS, type EmanuelParams, EMANUEL_DEFAULT_PARAMS, type SimResult, type DumbHunterSwingParams, type DumbHunterSwingSignal } from './strategy-engines';

interface SimulatedTrade {
  date: string;
  symbol?: string;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  pnlPercent: number;
  side: 'buy' | 'sell';
  exitReason: 'stop_loss' | 'take_profit' | 'end_of_day' | 'end_of_hour' | 'time_stop' | 'end_of_backtest';
  shares?: number;
  gapPercent?: number;
  equityAfter?: number;
  // Swing-only optional fields (multi-day holds)
  entryDate?: string;
  exitDate?: string;
  holdDays?: number;
  stopLevel?: number;
  targetPrice?: number;
}

interface BarData {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface StockSetup {
  symbol: string;
  bars: BarData[];
  gapPercent: number;
  isGapUp: boolean;
  side: 'buy' | 'sell';
  // Gap scan context for strategy engines
  ma20?: number;
  ma200?: number;
  trendDirection?: string;
  dailyContext?: string;
  score?: number;
  // Daily bars for S/R detection (Claude's strategy)
  dailyBars?: BarData[];
  prevClose?: number;
}

export type { SimulatedTrade, BarData, StockSetup };

@Injectable()
export class BacktestService {
  private readonly logger = new Logger(BacktestService.name);
  // In-memory cache: "SYMBOL:endDate" → daily bars
  private readonly dailyBarsCache = new Map<string, BarData[]>();

  constructor(
    @InjectRepository(BacktestResult)
    private readonly repo: Repository<BacktestResult>,
    private readonly alpaca: AlpacaService,
    private readonly gapScanner: GapScannerService,
    private readonly strategies: StrategiesService,
  ) {}

  /**
   * Fetch up to 30 trading days of daily bars ending at `endDate`, with caching.
   */
  /**
   * Load Emanuel's saved strategy params (ORB timeframe, flexibility clause
   * thresholds, etc.) so the backtest engine honours the user's configured values.
   */
  private async loadEmanuelParams(): Promise<Partial<EmanuelParams>> {
    const all = await this.strategies.findAll();
    const emanuel = all.find(
      (s) => s.author === 'Emanuel' && s.name === 'Emanuel - Gap Scalp System',
    );
    const raw = emanuel?.params ?? {};
    const out: Partial<EmanuelParams> = {};
    if (raw.orbTimeframeMinutes === 1 || raw.orbTimeframeMinutes === 2 || raw.orbTimeframeMinutes === 5) {
      out.orbTimeframeMinutes = raw.orbTimeframeMinutes;
    }
    if (typeof raw.orbMaxRangePercent === 'number') out.orbMaxRangePercent = raw.orbMaxRangePercent;
    if (typeof raw.minScore === 'number') out.minScore = raw.minScore;
    if (typeof raw.minRR === 'number') out.minRR = raw.minRR;
    if (typeof raw.exceptionalGapScore === 'number') out.exceptionalGapScore = raw.exceptionalGapScore;
    if (typeof raw.flexibilityMinRR === 'number') out.flexibilityMinRR = raw.flexibilityMinRR;
    if (typeof raw.riskPercent === 'number') out.riskPercent = raw.riskPercent;
    if (typeof raw.trailActivateRR === 'number') out.trailActivateRR = raw.trailActivateRR;
    if (typeof raw.trailTightenRR === 'number') out.trailTightenRR = raw.trailTightenRR;
    return out;
  }

  private async getDailyBars(symbol: string, endDate: string): Promise<BarData[]> {
    const cacheKey = `${symbol}:${endDate}`;
    const cached = this.dailyBarsCache.get(cacheKey);
    if (cached) return cached;

    // Go back ~300 calendar days to get ~200 trading days (enough for 200MA)
    const end = new Date(endDate + 'T00:00:00');
    const start = new Date(end);
    start.setDate(start.getDate() - 300);
    const startStr = start.toISOString().split('T')[0];

    try {
      const bars = await this.alpaca.getHistoricalBars(
        symbol,
        '1Day',
        startStr,
        endDate,
      );
      this.dailyBarsCache.set(cacheKey, bars);
      return bars;
    } catch (err) {
      this.logger.warn(`Failed to fetch daily bars for ${symbol}: ${err.message}`);
      return [];
    }
  }

  async runBacktest(dto: RunBacktestDto): Promise<BacktestResult> {
    const stopLoss = dto.stopLossPercent || 1;
    const takeProfit = dto.takeProfitPercent || 2;
    const gapThreshold = dto.gapThresholdPercent || 1.5;
    const strategy = dto.strategy || 'gap-scalp';

    this.logger.log(
      `Running backtest for ${dto.symbol} from ${dto.startDate} to ${dto.endDate}`,
    );

    // Fetch daily bars from Alpaca
    const bars = await this.alpaca.getHistoricalBars(
      dto.symbol,
      '1Day',
      dto.startDate,
      dto.endDate,
    );

    if (bars.length < 2) {
      throw new Error('Not enough historical data for backtest');
    }

    const startingCapital = dto.startingCapital || 10000;
    const simulatedTrades: SimulatedTrade[] = [];
    let equity = startingCapital;
    let maxEquity = equity;
    let maxDrawdown = 0;

    // Simulate gap scalping on daily bars
    for (let i = 1; i < bars.length; i++) {
      const prevBar = bars[i - 1];
      const currentBar = bars[i];

      // Calculate gap percentage
      const gapPercent =
        ((currentBar.open - prevBar.close) / prevBar.close) * 100;

      // Check if gap exceeds threshold
      if (Math.abs(gapPercent) < gapThreshold) continue;

      const isGapUp = gapPercent > 0;
      const entryPrice = currentBar.open;

      // For gap up: buy expecting continuation
      // For gap down: sell expecting continuation
      const side: 'buy' | 'sell' = isGapUp ? 'buy' : 'sell';

      // Calculate stop and target levels
      const stopLevel = isGapUp
        ? entryPrice * (1 - stopLoss / 100)
        : entryPrice * (1 + stopLoss / 100);

      const targetLevel = isGapUp
        ? entryPrice * (1 + takeProfit / 100)
        : entryPrice * (1 - takeProfit / 100);

      // Simulate intraday price action using the daily bar
      let exitPrice: number;
      let exitReason: SimulatedTrade['exitReason'];

      if (isGapUp) {
        // Long position
        if (currentBar.low <= stopLevel) {
          // Stop loss hit
          exitPrice = stopLevel;
          exitReason = 'stop_loss';
        } else if (currentBar.high >= targetLevel) {
          // Take profit hit
          exitPrice = targetLevel;
          exitReason = 'take_profit';
        } else {
          // Close at end of day
          exitPrice = currentBar.close;
          exitReason = 'end_of_day';
        }
      } else {
        // Short position
        if (currentBar.high >= stopLevel) {
          // Stop loss hit
          exitPrice = stopLevel;
          exitReason = 'stop_loss';
        } else if (currentBar.low <= targetLevel) {
          // Take profit hit
          exitPrice = targetLevel;
          exitReason = 'take_profit';
        } else {
          // Close at end of day
          exitPrice = currentBar.close;
          exitReason = 'end_of_day';
        }
      }

      // Calculate P/L using position sized from current equity
      const shares = Math.floor(equity / entryPrice);
      if (shares <= 0) continue;
      const multiplier = isGapUp ? 1 : -1;
      const pnlPerShare = (exitPrice - entryPrice) * multiplier;
      const pnlPercent = (pnlPerShare / entryPrice) * 100;
      const pnl = pnlPerShare * shares;

      equity += pnl;
      maxEquity = Math.max(maxEquity, equity);
      const drawdown = ((maxEquity - equity) / maxEquity) * 100;
      maxDrawdown = Math.max(maxDrawdown, drawdown);

      simulatedTrades.push({
        date: currentBar.timestamp,
        entryPrice,
        exitPrice,
        pnl,
        pnlPercent,
        side,
        exitReason,
        shares,
        equityAfter: equity,
      });
    }

    // Calculate summary statistics
    const totalTrades = simulatedTrades.length;
    const wins = simulatedTrades.filter((t) => t.pnl > 0).length;
    const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
    const totalPnl = simulatedTrades.reduce((sum, t) => sum + t.pnl, 0);

    // Save result
    const result = this.repo.create({
      symbol: dto.symbol.toUpperCase(),
      strategy,
      startDate: dto.startDate,
      endDate: dto.endDate,
      totalTrades,
      winRate: Math.round(winRate * 100) / 100,
      totalPnl: Math.round(totalPnl * 100) / 100,
      maxDrawdown: Math.round(maxDrawdown * 100) / 100,
      params: {
        stopLossPercent: stopLoss,
        takeProfitPercent: takeProfit,
        gapThresholdPercent: gapThreshold,
        startingCapital,
        finalEquity: equity,
        trades: simulatedTrades,
      },
    });

    return this.repo.save(result);
  }

  private getNextTradingDay(dateStr: string): string {
    const date = new Date(dateStr + 'T00:00:00');
    date.setDate(date.getDate() + 1);
    const dayOfWeek = date.getDay();
    if (dayOfWeek === 6) date.setDate(date.getDate() + 2); // Sat -> Mon
    if (dayOfWeek === 0) date.setDate(date.getDate() + 1); // Sun -> Mon
    return date.toISOString().split('T')[0];
  }

  async backtestFromGaps(
    scanDate: string,
    stopLossPercent?: number,
    takeProfitPercent?: number,
    startingCapital?: number,
  ): Promise<BacktestResult> {
    const stopLoss = stopLossPercent || 1;
    const takeProfit = takeProfitPercent || 2;
    const capital = startingCapital || 10000;

    const selected = await this.gapScanner.getSelected(scanDate);
    if (selected.length === 0) {
      throw new Error(`No selected gap scan results for ${scanDate}`);
    }

    const tradingDay = this.getNextTradingDay(scanDate);
    this.logger.log(
      `Running gap-scan backtest: scanDate=${scanDate}, tradingDay=${tradingDay}, ${selected.length} stocks, capital=${capital}`,
    );

    // Full trading day — Emanuel holds positions all day with bar-by-bar trail
    const startTime = `${tradingDay}T09:30:00-04:00`;
    const endTime = `${tradingDay}T16:00:00-04:00`;

    // Fetch bars once for all selected stocks
    const setups: StockSetup[] = [];
    for (const gap of selected) {
      try {
        const bars = await this.alpaca.getHistoricalBars(
          gap.symbol,
          '5Min',
          startTime,
          endTime,
        );

        if (bars.length < 2) {
          this.logger.warn(`Not enough intraday bars for ${gap.symbol} on ${tradingDay}`);
          continue;
        }

        // Fetch daily bars for S/R detection (Claude's strategy needs these)
        const dailyBars = await this.getDailyBars(gap.symbol, scanDate);

        const gapPercent = Number(gap.gapPercent);
        const isGapUp = gapPercent > 0;
        setups.push({
          symbol: gap.symbol,
          bars,
          gapPercent,
          isGapUp,
          side: isGapUp ? 'buy' : 'sell',
          ma20: gap.ma20 != null ? Number(gap.ma20) : undefined,
          ma200: gap.ma200 != null ? Number(gap.ma200) : undefined,
          trendDirection: gap.trendDirection || undefined,
          dailyContext: gap.dailyContext || undefined,
          score: gap.score ?? undefined,
          dailyBars,
          prevClose: gap.prevClose != null ? Number(gap.prevClose) : undefined,
        });
      } catch (err) {
        this.logger.error(`Error fetching bars for ${gap.symbol}: ${err.message}`);
      }
    }

    // Run the backtest with user-specified params
    const sim = this.simulateWithParams(setups, stopLoss, takeProfit, capital);

    // Find optimal SL/TP for this day
    const optimal = this.findOptimalParams(setups, capital);
    this.logger.log(
      `Optimal params for ${scanDate}: SL=${optimal.stopLoss}%, TP=${optimal.takeProfit}%, P/L=${optimal.totalPnl}`,
    );

    const totalTrades = sim.trades.length;
    const wins = sim.trades.filter((t) => t.pnl > 0).length;
    const losses = sim.trades.filter((t) => t.pnl < 0).length;

    // Per-author strategy comparison using actual strategy engines
    const authorDefaults = await this.strategies.getAuthorDefaults();
    const perAuthorResults: Record<string, any> = {};

    // Load Emanuel's strategy params from the DB so backtests honour the saved ORB
    // timeframe and flexibility-clause thresholds.
    const emanuelParams = await this.loadEmanuelParams();

    // Map known authors to their engines
    const engines: Record<string, (s: StockSetup[], c: number) => any> = {
      'Emanuel': (s, c) => simulateEmanuel(s, c, emanuelParams),
      'Fabio': simulateFabio,
      'Claude': simulateClaude,
      'ProRealAlgos': simulateProRealAlgos,
      'Dumb Hunter': simulateDumbHunter,
    };

    for (const [author, defaults] of Object.entries(authorDefaults)) {
      const engine = engines[author];
      const authorSim = engine
        ? engine(setups, capital)
        : simulateGeneric(setups, capital, defaults.stopLoss, defaults.takeProfit);

      const authorWins = authorSim.trades.filter((t: SimulatedTrade) => t.pnl > 0).length;
      const authorLosses = authorSim.trades.filter((t: SimulatedTrade) => t.pnl < 0).length;

      perAuthorResults[author] = {
        stopLoss: defaults.stopLoss,
        takeProfit: defaults.takeProfit,
        totalPnl: Math.round(authorSim.totalPnl * 100) / 100,
        winRate: Math.round(authorSim.winRate * 100) / 100,
        totalTrades: authorSim.trades.length,
        wins: authorWins,
        losses: authorLosses,
        maxDrawdown: Math.round(authorSim.maxDrawdown * 100) / 100,
        finalEquity: Math.round(authorSim.finalEquity * 100) / 100,
        entryMethod: authorSim.entryMethod || `Fixed SL/TP`,
        skippedStocks: authorSim.skippedStocks || 0,
        skippedReasons: authorSim.skippedReasons || [],
        explanation: this.generateAuthorExplanation(
          author,
          defaults,
          authorSim,
          sim.totalPnl,
        ),
      };
    }

    const result = this.repo.create({
      symbol: 'MULTI',
      strategy: 'gap-scan-backtest',
      startDate: scanDate,
      endDate: tradingDay,
      totalTrades,
      winRate: Math.round(sim.winRate * 100) / 100,
      totalPnl: Math.round(sim.totalPnl * 100) / 100,
      maxDrawdown: Math.round(sim.maxDrawdown * 100) / 100,
      params: {
        scanDate,
        tradingDay,
        stopLossPercent: stopLoss,
        takeProfitPercent: takeProfit,
        startingCapital: capital,
        finalEquity: sim.finalEquity,
        wins,
        losses,
        trades: sim.trades,
        optimalParams: optimal,
        perAuthorResults,
      },
    });

    return this.repo.save(result);
  }

  private generateAuthorExplanation(
    author: string,
    defaults: { stopLoss: number; takeProfit: number },
    authorSim: {
      totalPnl: number;
      winRate: number;
      trades: SimulatedTrade[];
      maxDrawdown: number;
      entryMethod?: string;
      skippedStocks?: number;
      skippedReasons?: string[];
    },
    userPnl: number,
  ): string {
    const profitable = authorSim.totalPnl > 0;
    const betterThanUser = authorSim.totalPnl > userPnl;

    const stopHits = authorSim.trades.filter((t) => t.exitReason === 'stop_loss').length;
    const tpHits = authorSim.trades.filter((t) => t.exitReason === 'take_profit').length;
    const eohHits = authorSim.trades.filter((t) => t.exitReason === 'end_of_hour').length;

    let explanation = '';

    // Strategy method
    if (authorSim.entryMethod) {
      explanation += `Entry: ${authorSim.entryMethod}. `;
    }

    // Skipped stocks
    if (authorSim.skippedStocks && authorSim.skippedStocks > 0) {
      explanation += `Skipped ${authorSim.skippedStocks} stock${authorSim.skippedStocks > 1 ? 's' : ''} (didn't meet rules). `;
    }

    // Trade outcomes
    if (authorSim.trades.length > 0) {
      explanation += `Traded ${authorSim.trades.length}: ${tpHits} hit target, ${stopHits} stopped out, ${eohHits} end-of-hour. `;
    } else {
      explanation += `No trades taken — all stocks filtered out by strategy rules. `;
    }

    // P/L
    if (profitable) {
      explanation += `Net +$${authorSim.totalPnl.toFixed(2)} (${authorSim.winRate.toFixed(0)}% win rate). `;
    } else {
      explanation += `Net -$${Math.abs(authorSim.totalPnl).toFixed(2)} (${authorSim.winRate.toFixed(0)}% win rate). `;
    }

    // Comparison
    if (betterThanUser) {
      explanation += `Outperformed your params by $${(authorSim.totalPnl - userPnl).toFixed(2)}.`;
    } else if (Math.abs(authorSim.totalPnl - userPnl) < 0.01) {
      explanation += `Same result as your params.`;
    } else {
      explanation += `Your params were $${(userPnl - authorSim.totalPnl).toFixed(2)} better.`;
    }

    return explanation;
  }

  /**
   * Simulate trades for a set of stocks with given SL/TP values.
   * Bars are pre-fetched so this is pure computation.
   */
  private simulateWithParams(
    setups: StockSetup[],
    stopLoss: number,
    takeProfit: number,
    startingCapital: number,
  ): { trades: SimulatedTrade[]; totalPnl: number; winRate: number; maxDrawdown: number; finalEquity: number } {
    const capitalPerStock = startingCapital / setups.length;
    let equity = startingCapital;
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

    return { trades, totalPnl, winRate, maxDrawdown, finalEquity: equity };
  }

  /**
   * Sweep a grid of SL/TP values to find the optimal combination.
   */
  private findOptimalParams(
    setups: StockSetup[],
    startingCapital: number,
  ): { stopLoss: number; takeProfit: number; totalPnl: number; winRate: number } {
    let bestPnl = -Infinity;
    let bestSL = 1;
    let bestTP = 2;
    let bestWinRate = 0;

    // Sweep SL: 0.3% to 3% in 0.3% steps, TP: 0.3% to 5% in 0.3% steps
    for (let sl = 0.3; sl <= 3.0; sl = Math.round((sl + 0.3) * 10) / 10) {
      for (let tp = 0.3; tp <= 5.0; tp = Math.round((tp + 0.3) * 10) / 10) {
        const result = this.simulateWithParams(setups, sl, tp, startingCapital);
        if (result.totalPnl > bestPnl) {
          bestPnl = result.totalPnl;
          bestSL = sl;
          bestTP = tp;
          bestWinRate = result.winRate;
        }
      }
    }

    return {
      stopLoss: Math.round(bestSL * 10) / 10,
      takeProfit: Math.round(bestTP * 10) / 10,
      totalPnl: Math.round(bestPnl * 100) / 100,
      winRate: Math.round(bestWinRate * 100) / 100,
    };
  }

  async getResults(limit = 50): Promise<BacktestResult[]> {
    return this.repo.find({
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async getResult(id: number): Promise<BacktestResult> {
    return this.repo.findOneBy({ id });
  }

  /**
   * Optimise Claude's Stop Gap Reversal strategy across all cached scan dates.
   *
   * 1. Get every scan date that has cached gap results
   * 2. For each date, build StockSetups (intraday + daily bars) for ALL stocks
   * 3. Sweep parameter combinations of Claude's engine
   * 4. Return best params, per-date breakdown, and aggregate stats
   */
  async optimiseClaude(capital = 10000): Promise<{
    bestParams: ClaudeParams;
    bestPnl: number;
    bestWinRate: number;
    bestTrades: number;
    allParamResults: Array<{
      params: ClaudeParams;
      totalPnl: number;
      winRate: number;
      totalTrades: number;
      wins: number;
      losses: number;
    }>;
    perDateBreakdown: Array<{
      scanDate: string;
      tradingDay: string;
      stocks: number;
      setupsBuilt: number;
      trades: number;
      pnl: number;
      winRate: number;
    }>;
    datesScanned: number;
    totalStocksAnalysed: number;
  }> {
    const scanDates = await this.gapScanner.getAllScanDates();
    this.logger.log(`Claude optimiser: found ${scanDates.length} cached scan dates`);

    // ── Build setups for every date ──
    const allSetupsByDate: Array<{ scanDate: string; tradingDay: string; setups: StockSetup[] }> = [];
    let totalStocksAnalysed = 0;

    for (const scanDate of scanDates) {
      const allGaps = await this.gapScanner.getAllResults(scanDate);
      if (allGaps.length === 0) continue;

      const tradingDay = this.getNextTradingDay(scanDate);
      const startTime = `${tradingDay}T09:30:00-04:00`;
      const endTime = `${tradingDay}T16:00:00-04:00`;

      const setups: StockSetup[] = [];
      for (const gap of allGaps) {
        try {
          const bars = await this.alpaca.getHistoricalBars(
            gap.symbol,
            '5Min',
            startTime,
            endTime,
          );

          if (bars.length < 4) continue;

          const dailyBars = await this.getDailyBars(gap.symbol, scanDate);
          const gapPercent = Number(gap.gapPercent);
          const isGapUp = gapPercent > 0;

          setups.push({
            symbol: gap.symbol,
            bars,
            gapPercent,
            isGapUp,
            side: isGapUp ? 'buy' : 'sell',
            ma20: gap.ma20 != null ? Number(gap.ma20) : undefined,
            ma200: gap.ma200 != null ? Number(gap.ma200) : undefined,
            trendDirection: gap.trendDirection || undefined,
            dailyContext: gap.dailyContext || undefined,
            score: gap.score ?? undefined,
            dailyBars,
            prevClose: gap.prevClose != null ? Number(gap.prevClose) : undefined,
          });
        } catch (err) {
          // Skip stocks with bar fetch errors silently
        }
      }

      totalStocksAnalysed += allGaps.length;
      if (setups.length > 0) {
        allSetupsByDate.push({ scanDate, tradingDay, setups });
      }
      this.logger.log(
        `Claude optimiser: ${scanDate} → ${setups.length}/${allGaps.length} setups built`,
      );
    }

    this.logger.log(
      `Claude optimiser: ${allSetupsByDate.length} dates with usable setups, sweeping params...`,
    );

    // ── Parameter sweep — Claude's blend params ──
    // The blend engine ignores entry/trail/partial params (those are delegated
    // to the sub-engines) so the optimiser sweeps the meta-allocator knobs.
    const maxTradesOptions = [1, 2, 3];
    const minConvictionOptions = [1, 2];
    const convictionBonusOptions = [5, 10, 20];
    const maxDailyLossOptions = [4, 6, 10]; // %

    let bestPnl = -Infinity;
    let bestParams = CLAUDE_DEFAULT_PARAMS;
    let bestWinRate = 0;
    let bestTrades = 0;
    const allParamResults: Array<{
      params: ClaudeParams;
      totalPnl: number;
      winRate: number;
      totalTrades: number;
      wins: number;
      losses: number;
    }> = [];

    for (const maxTradesPerDay of maxTradesOptions) {
      for (const minConviction of minConvictionOptions) {
        for (const convictionBonus of convictionBonusOptions) {
          for (const maxDailyLossPercent of maxDailyLossOptions) {
            const params: ClaudeParams = {
              ...CLAUDE_DEFAULT_PARAMS,
              maxTradesPerDay,
              minConviction,
              convictionBonus,
              maxDailyLossPercent,
            };

            let totalPnl = 0;
            let totalTradesCount = 0;
            let totalWins = 0;

            for (const { setups } of allSetupsByDate) {
              const sim = simulateClaude(setups, capital, params);
              totalPnl += sim.totalPnl;
              totalTradesCount += sim.trades.length;
              totalWins += sim.trades.filter((t) => t.pnl > 0).length;
            }

            const winRate = totalTradesCount > 0 ? (totalWins / totalTradesCount) * 100 : 0;

            allParamResults.push({
              params,
              totalPnl: Math.round(totalPnl * 100) / 100,
              winRate: Math.round(winRate * 100) / 100,
              totalTrades: totalTradesCount,
              wins: totalWins,
              losses: totalTradesCount - totalWins,
            });

            if (totalPnl > bestPnl) {
              bestPnl = totalPnl;
              bestParams = params;
              bestWinRate = winRate;
              bestTrades = totalTradesCount;
            }
          }
        }
      }
    }

    // ── Per-date breakdown with best params ──
    const perDateBreakdown: Array<{
      scanDate: string;
      tradingDay: string;
      stocks: number;
      setupsBuilt: number;
      trades: number;
      pnl: number;
      winRate: number;
    }> = [];

    for (const { scanDate, tradingDay, setups } of allSetupsByDate) {
      const sim = simulateClaude(setups, capital, bestParams);
      const wins = sim.trades.filter((t) => t.pnl > 0).length;
      perDateBreakdown.push({
        scanDate,
        tradingDay,
        stocks: setups.length,
        setupsBuilt: setups.length,
        trades: sim.trades.length,
        pnl: Math.round(sim.totalPnl * 100) / 100,
        winRate: sim.trades.length > 0 ? Math.round((wins / sim.trades.length) * 100 * 100) / 100 : 0,
      });
    }

    // Sort allParamResults by P/L descending, keep top 20
    allParamResults.sort((a, b) => b.totalPnl - a.totalPnl);
    const topParams = allParamResults.slice(0, 20);

    this.logger.log(
      `Claude optimiser complete: best P/L=$${bestPnl.toFixed(2)}, ` +
      `winRate=${bestWinRate.toFixed(1)}%, trades=${bestTrades}, ` +
      `params=${JSON.stringify(bestParams)}`,
    );

    return {
      bestParams,
      bestPnl: Math.round(bestPnl * 100) / 100,
      bestWinRate: Math.round(bestWinRate * 100) / 100,
      bestTrades,
      allParamResults: topParams,
      perDateBreakdown,
      datesScanned: allSetupsByDate.length,
      totalStocksAnalysed,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  //  BATCH DATA BACKFILL
  // ═══════════════════════════════════════════════════════════════

  private backfillRunning = false;
  private backfillProgress = {
    status: 'idle' as 'idle' | 'running' | 'complete' | 'error',
    currentDate: '',
    datesTotal: 0,
    datesComplete: 0,
    gapScansComplete: 0,
    intradayBarsFetched: 0,
    dailyBarsFetched: 0,
    errors: 0,
    startedAt: '',
    lastUpdate: '',
    message: '',
  };

  getBackfillProgress() {
    return this.backfillProgress;
  }

  /**
   * Generate all NYSE trading days between two dates (skip weekends).
   * Holidays are not filtered — Alpaca will just return no data for those.
   */
  private getTradingDays(startDate: string, endDate: string): string[] {
    const days: string[] = [];
    const cur = new Date(startDate + 'T12:00:00');
    const end = new Date(endDate + 'T12:00:00');
    while (cur <= end) {
      const dow = cur.getDay();
      if (dow !== 0 && dow !== 6) {
        days.push(cur.toISOString().split('T')[0]);
      }
      cur.setDate(cur.getDate() + 1);
    }
    return days;
  }

  /**
   * Long-running backfill: scan historical gaps for every trading day in range,
   * then fetch intraday + daily bars for each gap result.
   * Throttles API calls to stay under Alpaca rate limits.
   */
  async runBackfill(startDate: string, endDate: string): Promise<void> {
    if (this.backfillRunning) {
      this.logger.warn('Backfill already running');
      return;
    }

    this.backfillRunning = true;
    const p = this.backfillProgress;
    p.status = 'running';
    p.startedAt = new Date().toISOString();
    p.datesComplete = 0;
    p.gapScansComplete = 0;
    p.intradayBarsFetched = 0;
    p.dailyBarsFetched = 0;
    p.errors = 0;
    p.message = 'Starting backfill...';

    const tradingDays = this.getTradingDays(startDate, endDate);
    p.datesTotal = tradingDays.length;
    this.logger.log(`BACKFILL: ${tradingDays.length} trading days from ${startDate} to ${endDate}`);

    try {
      for (const scanDate of tradingDays) {
        p.currentDate = scanDate;
        p.lastUpdate = new Date().toISOString();

        // Step 1: Check if we already have gap scan results for this date
        const existing = await this.gapScanner.getAllResults(scanDate);
        let gapResults = existing;

        if (existing.length === 0) {
          // Run a historical gap scan for this date
          p.message = `Scanning gaps for ${scanDate}...`;
          try {
            gapResults = await this.gapScanner.scanHistoricalGaps(scanDate);
            p.gapScansComplete++;
            this.logger.log(`BACKFILL: ${scanDate} → ${gapResults.length} gaps found`);
          } catch (err) {
            p.errors++;
            this.logger.warn(`BACKFILL: Gap scan failed for ${scanDate}: ${err.message}`);
            p.datesComplete++;
            continue;
          }
        } else {
          this.logger.log(`BACKFILL: ${scanDate} → ${existing.length} gaps already cached`);
          p.gapScansComplete++;
        }

        if (gapResults.length === 0) {
          p.datesComplete++;
          continue;
        }

        // Step 2: For each gap result, fetch 5-min intraday bars + daily bars
        const tradingDay = this.getNextTradingDay(scanDate);
        const startTime = `${tradingDay}T09:30:00-04:00`;
        const endTime = `${tradingDay}T16:00:00-04:00`;

        p.message = `Fetching bars for ${gapResults.length} stocks on ${scanDate}...`;

        for (const gap of gapResults) {
          // Throttle: 300ms between API calls to stay under 200 req/min
          await new Promise(r => setTimeout(r, 300));

          // Fetch 5-min intraday bars
          try {
            await this.alpaca.getHistoricalBars(
              gap.symbol,
              '5Min',
              startTime,
              endTime,
            );
            p.intradayBarsFetched++;
          } catch (err) {
            p.errors++;
          }

          // Throttle again
          await new Promise(r => setTimeout(r, 300));

          // Fetch daily bars for S/R detection
          try {
            await this.getDailyBars(gap.symbol, scanDate);
            p.dailyBarsFetched++;
          } catch (err) {
            p.errors++;
          }

          p.lastUpdate = new Date().toISOString();
        }

        p.datesComplete++;
        this.logger.log(
          `BACKFILL: ${scanDate} complete (${p.datesComplete}/${p.datesTotal}), ` +
          `intraday=${p.intradayBarsFetched}, daily=${p.dailyBarsFetched}, errors=${p.errors}`,
        );
      }

      p.status = 'complete';
      p.message = `Backfill complete: ${p.datesComplete} dates, ${p.intradayBarsFetched} intraday + ${p.dailyBarsFetched} daily bars fetched`;
      this.logger.log(`BACKFILL COMPLETE: ${p.message}`);
    } catch (err) {
      p.status = 'error';
      p.message = `Backfill error: ${err.message}`;
      this.logger.error(`BACKFILL ERROR: ${err.message}`);
    } finally {
      this.backfillRunning = false;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  EMANUEL'S TOP PICKS — 2-week lookback
  // ═══════════════════════════════════════════════════════════════

  async emanuelTopPicks(
    endDate: string,
    capital = 1000,
    lookbackDays = 10,
    longOnly = false,
  ): Promise<{
    days: Array<{
      scanDate: string;
      tradingDay: string;
      picks: Array<{
        symbol: string;
        gapPercent: number;
        score: number;
        scoreReasons: string[];
        dailyContext: string;
        trendDirection: string;
        ma20: number | null;
        ma200: number | null;
        trade: {
          side: string;
          entryPrice: number;
          exitPrice: number;
          pnl: number;
          pnlPercent: number;
          exitReason: string;
          shares: number;
        } | null;
        skippedReason: string | null;
      }>;
      dayPnl: number;
      dayTrades: number;
      dayWins: number;
    }>;
    totals: {
      totalPnl: number;
      totalTrades: number;
      totalWins: number;
      winRate: number;
      daysAnalysed: number;
      bestDay: { date: string; pnl: number } | null;
      worstDay: { date: string; pnl: number } | null;
    };
  }> {
    const end = new Date(endDate + 'T00:00:00');
    const start = new Date(end);
    start.setDate(start.getDate() - Math.ceil(lookbackDays * 1.6)); // calendar days buffer
    const tradingDays = this.getTradingDays(
      start.toISOString().split('T')[0],
      endDate,
    ).slice(-lookbackDays);

    this.logger.log(
      `Emanuel top picks: ${tradingDays.length} trading days up to ${endDate}`,
    );

    const emanuelParams = await this.loadEmanuelParams();

    const days: Array<any> = [];
    let totalPnl = 0;
    let totalTrades = 0;
    let totalWins = 0;

    for (const scanDate of tradingDays) {
      // Get gap scan results for this date (use cached or scan)
      let gapResults = await this.gapScanner.getAllResults(scanDate);
      if (gapResults.length === 0) {
        try {
          gapResults = await this.gapScanner.scanHistoricalGaps(scanDate);
        } catch {
          continue;
        }
      }
      if (gapResults.length === 0) continue;

      // Filter long-only if set (only gap-ups = buy setups)
      const filtered = longOnly
        ? gapResults.filter(g => Number(g.gapPercent) > 0)
        : gapResults;

      // Sort by Emanuel score descending, take top 3
      const top3 = [...filtered]
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, 3);

      const tradingDay = this.getNextTradingDay(scanDate);
      const startTime = `${tradingDay}T09:30:00-04:00`;
      const endTime = `${tradingDay}T16:00:00-04:00`;

      // Build setups for all top 3 picks
      const picks: Array<any> = [];
      const daySetups: StockSetup[] = [];
      const pickMap = new Map<string, any>();

      for (const gap of top3) {
        const pick: any = {
          symbol: gap.symbol,
          gapPercent: Number(gap.gapPercent),
          score: gap.score ?? 0,
          scoreReasons: gap.scoreReasons || [],
          dailyContext: gap.dailyContext || 'other',
          trendDirection: gap.trendDirection || 'sideways',
          ma20: gap.ma20 != null ? Number(gap.ma20) : null,
          ma200: gap.ma200 != null ? Number(gap.ma200) : null,
          trade: null,
          skippedReason: null,
          isEmanuelPick: false, // Will mark which one the engine actually trades
        };

        try {
          const bars = await this.alpaca.getHistoricalBars(
            gap.symbol,
            '5Min',
            startTime,
            endTime,
          );

          if (bars.length < 6) {
            pick.skippedReason = 'Not enough intraday bars';
            picks.push(pick);
            continue;
          }

          const dailyBars = await this.getDailyBars(gap.symbol, scanDate);
          const gapPercent = Number(gap.gapPercent);
          const isGapUp = gapPercent > 0;

          const setup: StockSetup = {
            symbol: gap.symbol,
            bars,
            gapPercent,
            isGapUp,
            side: isGapUp ? 'buy' : 'sell',
            ma20: gap.ma20 != null ? Number(gap.ma20) : undefined,
            ma200: gap.ma200 != null ? Number(gap.ma200) : undefined,
            trendDirection: gap.trendDirection || undefined,
            dailyContext: gap.dailyContext || undefined,
            score: gap.score ?? undefined,
            dailyBars,
            prevClose: gap.prevClose != null ? Number(gap.prevClose) : undefined,
          };

          daySetups.push(setup);
          pickMap.set(gap.symbol, pick);
        } catch (err) {
          pick.skippedReason = `Bar fetch error: ${err.message}`;
        }

        picks.push(pick);
      }

      // Run Emanuel's engine on ALL setups — it will pick the best one (one-and-done)
      let dayPnl = 0;
      let dayTrades = 0;
      let dayWins = 0;

      if (daySetups.length > 0) {
        const sim = simulateEmanuel(daySetups, capital, emanuelParams);

        // Map the trade back to the pick
        if (sim.trades.length > 0) {
          const t = sim.trades[0];
          const pick = pickMap.get(t.symbol!);
          if (pick) {
            pick.trade = {
              side: t.side,
              entryPrice: t.entryPrice,
              exitPrice: t.exitPrice,
              pnl: Math.round(t.pnl * 100) / 100,
              pnlPercent: Math.round(t.pnlPercent * 100) / 100,
              exitReason: t.exitReason,
              shares: t.shares || 0,
            };
            pick.isEmanuelPick = true;
            dayPnl = t.pnl;
            dayTrades = 1;
            if (t.pnl > 0) dayWins = 1;
          }
        }

        // Mark skipped reasons for non-traded picks
        for (const reason of sim.skippedReasons) {
          const sym = reason.split(':')[0];
          const pick = pickMap.get(sym);
          if (pick && !pick.trade && !pick.skippedReason) {
            pick.skippedReason = reason.split(': ').slice(1).join(': ');
          }
        }
      }

      dayPnl = Math.round(dayPnl * 100) / 100;
      totalPnl += dayPnl;
      totalTrades += dayTrades;
      totalWins += dayWins;

      days.push({
        scanDate,
        tradingDay,
        picks,
        dayPnl,
        dayTrades,
        dayWins,
      });
    }

    // Find best and worst days. With only one trading day, best==worst so both are
    // redundant with total P/L — omit them.
    const daysWithTrades = days.filter((d) => d.dayTrades > 0);
    const showBestWorst = daysWithTrades.length >= 2;
    const bestDay = showBestWorst
      ? daysWithTrades.reduce((best, d) => d.dayPnl > best.dayPnl ? d : best)
      : null;
    const worstDay = showBestWorst
      ? daysWithTrades.reduce((worst, d) => d.dayPnl < worst.dayPnl ? d : worst)
      : null;

    return {
      days,
      totals: {
        totalPnl: Math.round(totalPnl * 100) / 100,
        totalTrades,
        totalWins,
        winRate: totalTrades > 0 ? Math.round((totalWins / totalTrades) * 100 * 100) / 100 : 0,
        daysAnalysed: days.length,
        bestDay: bestDay ? { date: bestDay.scanDate, pnl: bestDay.dayPnl } : null,
        worstDay: worstDay ? { date: worstDay.scanDate, pnl: worstDay.dayPnl } : null,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════
  //  WEEKLY COMPARISON — 10 weeks, Mon–Fri, every strategy, daily budget resets each day
  // ═══════════════════════════════════════════════════════════════

  async weeklyComparison(
    endDate: string,
    dailyBudget: number,
    weeks = 10,
  ): Promise<{
    weeks: Array<{
      weekStart: string;
      weekEnd: string;
      daysTraded: number;
      strategies: Record<string, { pnl: number; trades: number; wins: number }>;
    }>;
    totals: Record<string, { pnl: number; trades: number; wins: number; winRate: number }>;
  }> {
    // Find the most recent Friday on or before endDate
    const endRef = new Date(endDate + 'T12:00:00');
    const mostRecentFriday = new Date(endRef);
    while (mostRecentFriday.getDay() !== 5) {
      mostRecentFriday.setDate(mostRecentFriday.getDate() - 1);
    }

    // Build week blocks (oldest → newest)
    type WeekBlock = { mon: string; fri: string; days: string[] };
    const weekBlocks: WeekBlock[] = [];
    for (let w = weeks - 1; w >= 0; w--) {
      const friday = new Date(mostRecentFriday);
      friday.setDate(friday.getDate() - w * 7);
      const monday = new Date(friday);
      monday.setDate(monday.getDate() - 4);
      const monStr = monday.toISOString().split('T')[0];
      const friStr = friday.toISOString().split('T')[0];
      weekBlocks.push({ mon: monStr, fri: friStr, days: this.getTradingDays(monStr, friStr) });
    }

    const strategyNames = ['Emanuel', 'Claude', 'Dumb Hunter', 'ProRealAlgos', 'Fabio'];
    const makeEmpty = () => Object.fromEntries(
      strategyNames.map((n) => [n, { pnl: 0, trades: 0, wins: 0 }]),
    ) as Record<string, { pnl: number; trades: number; wins: number }>;

    const weeklyResults = weekBlocks.map((wb) => ({
      weekStart: wb.mon,
      weekEnd: wb.fri,
      daysTraded: 0,
      strategies: makeEmpty(),
    }));

    const emanuelParams = await this.loadEmanuelParams();

    this.logger.log(
      `Weekly comparison: ${weeks} weeks (${weekBlocks[0].mon} → ${weekBlocks[weekBlocks.length - 1].fri}), budget $${dailyBudget}/day`,
    );

    for (const [weekIdx, wb] of weekBlocks.entries()) {
      for (const scanDate of wb.days) {
        let gapResults = await this.gapScanner.getAllResults(scanDate);
        if (gapResults.length === 0) {
          try {
            gapResults = await this.gapScanner.scanHistoricalGaps(scanDate);
          } catch {
            continue;
          }
        }
        if (gapResults.length === 0) continue;

        const top3 = [...gapResults]
          .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
          .slice(0, 3);

        const tradingDay = this.getNextTradingDay(scanDate);
        const startTime = `${tradingDay}T09:30:00-04:00`;
        const endTime = `${tradingDay}T16:00:00-04:00`;

        const daySetups: StockSetup[] = [];
        for (const gap of top3) {
          try {
            const bars = await this.alpaca.getHistoricalBars(
              gap.symbol,
              '5Min',
              startTime,
              endTime,
            );
            if (bars.length < 6) continue;
            const dailyBars = await this.getDailyBars(gap.symbol, scanDate);
            const gapPercent = Number(gap.gapPercent);
            const isGapUp = gapPercent > 0;
            daySetups.push({
              symbol: gap.symbol,
              bars,
              gapPercent,
              isGapUp,
              side: isGapUp ? 'buy' : 'sell',
              ma20: gap.ma20 != null ? Number(gap.ma20) : undefined,
              ma200: gap.ma200 != null ? Number(gap.ma200) : undefined,
              trendDirection: gap.trendDirection || undefined,
              dailyContext: gap.dailyContext || undefined,
              score: gap.score ?? undefined,
              dailyBars,
              prevClose: gap.prevClose != null ? Number(gap.prevClose) : undefined,
            });
          } catch {
            /* skip symbol on fetch error */
          }
        }
        if (daySetups.length === 0) continue;

        weeklyResults[weekIdx].daysTraded++;

        const runSafe = (fn: () => SimResult): SimResult | null => {
          try { return fn(); } catch { return null; }
        };

        const runs: Record<string, SimResult | null> = {
          Emanuel: runSafe(() => simulateEmanuel(daySetups, dailyBudget, emanuelParams)),
          Claude: runSafe(() => simulateClaude(daySetups, dailyBudget)),
          'Dumb Hunter': runSafe(() => simulateDumbHunter(daySetups, dailyBudget)),
          ProRealAlgos: runSafe(() => simulateProRealAlgos(daySetups, dailyBudget)),
          Fabio: runSafe(() => simulateFabio(daySetups, dailyBudget)),
        };

        for (const name of strategyNames) {
          const sim = runs[name];
          if (!sim) continue;
          const rec = weeklyResults[weekIdx].strategies[name];
          rec.pnl += sim.totalPnl;
          rec.trades += sim.trades.length;
          rec.wins += sim.trades.filter((t) => t.pnl > 0).length;
        }
      }
    }

    // Round pnl, compute totals
    for (const w of weeklyResults) {
      for (const s of Object.values(w.strategies)) {
        s.pnl = Math.round(s.pnl * 100) / 100;
      }
    }

    const totals: Record<string, { pnl: number; trades: number; wins: number; winRate: number }> = {};
    for (const name of strategyNames) {
      let tp = 0, tt = 0, tw = 0;
      for (const w of weeklyResults) {
        tp += w.strategies[name].pnl;
        tt += w.strategies[name].trades;
        tw += w.strategies[name].wins;
      }
      totals[name] = {
        pnl: Math.round(tp * 100) / 100,
        trades: tt,
        wins: tw,
        winRate: tt > 0 ? Math.round((tw / tt) * 100 * 100) / 100 : 0,
      };
    }

    return { weeks: weeklyResults, totals };
  }

  // ═══════════════════════════════════════════════════════════════
  //  DUMB HUNTER'S TOP PICKS — DMC level reclaim over same universe as Emanuel
  // ═══════════════════════════════════════════════════════════════

  async dumbHunterTopPicks(
    endDate: string,
    capital = 1000,
    lookbackDays = 10,
    longOnly = false,
  ) {
    const end = new Date(endDate + 'T00:00:00');
    const start = new Date(end);
    start.setDate(start.getDate() - Math.ceil(lookbackDays * 1.6));
    const tradingDays = this.getTradingDays(
      start.toISOString().split('T')[0],
      endDate,
    ).slice(-lookbackDays);

    this.logger.log(
      `Dumb Hunter top picks: ${tradingDays.length} trading days up to ${endDate}`,
    );

    const days: Array<any> = [];
    let totalPnl = 0;
    let totalTrades = 0;
    let totalWins = 0;

    for (const scanDate of tradingDays) {
      let gapResults = await this.gapScanner.getAllResults(scanDate);
      if (gapResults.length === 0) {
        try {
          gapResults = await this.gapScanner.scanHistoricalGaps(scanDate);
        } catch {
          continue;
        }
      }
      if (gapResults.length === 0) continue;

      const filtered = longOnly
        ? gapResults.filter((g) => Number(g.gapPercent) > 0)
        : gapResults;

      const top3 = [...filtered]
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, 3);

      const tradingDay = this.getNextTradingDay(scanDate);
      const startTime = `${tradingDay}T09:30:00-04:00`;
      const endTime = `${tradingDay}T16:00:00-04:00`;

      const picks: Array<any> = [];
      const daySetups: StockSetup[] = [];
      const pickMap = new Map<string, any>();

      for (const gap of top3) {
        const pick: any = {
          symbol: gap.symbol,
          gapPercent: Number(gap.gapPercent),
          score: gap.score ?? 0,
          scoreReasons: gap.scoreReasons || [],
          dailyContext: gap.dailyContext || 'other',
          trendDirection: gap.trendDirection || 'sideways',
          ma20: gap.ma20 != null ? Number(gap.ma20) : null,
          ma200: gap.ma200 != null ? Number(gap.ma200) : null,
          trade: null,
          skippedReason: null,
          isDumbHunterPick: false,
        };

        try {
          const bars = await this.alpaca.getHistoricalBars(
            gap.symbol,
            '5Min',
            startTime,
            endTime,
          );
          if (bars.length < 6) {
            pick.skippedReason = 'Not enough intraday bars';
            picks.push(pick);
            continue;
          }

          const dailyBars = await this.getDailyBars(gap.symbol, scanDate);
          const gapPercent = Number(gap.gapPercent);
          const isGapUp = gapPercent > 0;

          const setup: StockSetup = {
            symbol: gap.symbol,
            bars,
            gapPercent,
            isGapUp,
            side: isGapUp ? 'buy' : 'sell',
            ma20: gap.ma20 != null ? Number(gap.ma20) : undefined,
            ma200: gap.ma200 != null ? Number(gap.ma200) : undefined,
            trendDirection: gap.trendDirection || undefined,
            dailyContext: gap.dailyContext || undefined,
            score: gap.score ?? undefined,
            dailyBars,
            prevClose: gap.prevClose != null ? Number(gap.prevClose) : undefined,
          };

          daySetups.push(setup);
          pickMap.set(gap.symbol, pick);
        } catch (err) {
          pick.skippedReason = `Bar fetch error: ${err.message}`;
        }

        picks.push(pick);
      }

      let dayPnl = 0;
      let dayTrades = 0;
      let dayWins = 0;

      if (daySetups.length > 0) {
        const sim = simulateDumbHunter(daySetups, capital);

        for (const t of sim.trades) {
          const pick = pickMap.get(t.symbol!);
          if (pick) {
            pick.trade = {
              side: t.side,
              entryPrice: t.entryPrice,
              exitPrice: t.exitPrice,
              pnl: Math.round(t.pnl * 100) / 100,
              pnlPercent: Math.round(t.pnlPercent * 100) / 100,
              exitReason: t.exitReason,
              shares: t.shares || 0,
            };
            pick.isDumbHunterPick = true;
            dayPnl += t.pnl;
            dayTrades++;
            if (t.pnl > 0) dayWins++;
          }
        }

        for (const reason of sim.skippedReasons) {
          const sym = reason.split(':')[0];
          const pick = pickMap.get(sym);
          if (pick && !pick.trade && !pick.skippedReason) {
            pick.skippedReason = reason.split(': ').slice(1).join(': ');
          }
        }
      }

      dayPnl = Math.round(dayPnl * 100) / 100;
      totalPnl += dayPnl;
      totalTrades += dayTrades;
      totalWins += dayWins;

      days.push({ scanDate, tradingDay, picks, dayPnl, dayTrades, dayWins });
    }

    const daysWithTrades = days.filter((d) => d.dayTrades > 0);
    const showBestWorst = daysWithTrades.length >= 2;
    const bestDay = showBestWorst
      ? daysWithTrades.reduce((b, d) => (d.dayPnl > b.dayPnl ? d : b))
      : null;
    const worstDay = showBestWorst
      ? daysWithTrades.reduce((w, d) => (d.dayPnl < w.dayPnl ? d : w))
      : null;

    return {
      days,
      totals: {
        totalPnl: Math.round(totalPnl * 100) / 100,
        totalTrades,
        totalWins,
        winRate: totalTrades > 0 ? Math.round((totalWins / totalTrades) * 100 * 100) / 100 : 0,
        daysAnalysed: days.length,
        bestDay: bestDay ? { date: bestDay.scanDate, pnl: bestDay.dayPnl } : null,
        worstDay: worstDay ? { date: worstDay.scanDate, pnl: worstDay.dayPnl } : null,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════
  //  CLAUDE'S TOP PICKS — 2-week lookback with running balance + fees
  // ═══════════════════════════════════════════════════════════════

  /**
   * Calculate Alpaca regulatory fees for a trade.
   * Alpaca is commission-free but passes through SEC + FINRA fees.
   * - SEC fee: $0.0000278 per dollar on SELL transactions
   * - FINRA TAF: $0.000166 per share sold (capped at $8.30)
   */
  private calculateFees(
    side: string,
    shares: number,
    entryPrice: number,
    exitPrice: number,
  ): number {
    let fees = 0;
    // On the sell side (or closing a buy, or opening a short)
    const sellValue = side === 'buy' ? exitPrice * shares : entryPrice * shares;
    // SEC fee on sells
    fees += sellValue * 0.0000278;
    // FINRA TAF on sells
    fees += Math.min(shares * 0.000166, 8.30);
    // Round up to nearest cent
    return Math.ceil(fees * 100) / 100;
  }

  // ═══════════════════════════════════════════════════════════════
  //  DUMB HUNTER — SWING BACKTEST (multi-day holds, daily-close entries)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Default swing watchlist — gold proxy (GLD), major indices, mega-caps.
   * User can override via `symbols` in the request body.
   */
  private readonly DUMB_HUNTER_SWING_WATCHLIST = [
    'GLD', 'SPY', 'QQQ', 'IWM',
    'NVDA', 'TSLA', 'AAPL', 'MSFT', 'AMZN', 'GOOGL', 'META', 'AMD',
  ];

  async dumbHunterSwingBacktest(
    endDate: string,
    capital: number,
    lookbackWeeks: number,
    symbols?: string[],
    paramsOverride?: Partial<DumbHunterSwingParams>,
  ): Promise<{
    trades: Array<{
      symbol: string;
      side: 'buy' | 'sell';
      entryDate: string;
      exitDate: string;
      holdDays: number;
      entryPrice: number;
      exitPrice: number;
      stopLevel: number;
      targetPrice: number;
      shares: number;
      pnl: number;
      pnlPercent: number;
      exitReason: string;
      equityAfter: number;
    }>;
    bySymbol: Record<string, { trades: number; wins: number; pnl: number }>;
    totals: {
      startingCapital: number;
      finalEquity: number;
      totalPnl: number;
      totalReturnPercent: number;
      totalTrades: number;
      wins: number;
      losses: number;
      winRate: number;
      maxDrawdown: number;
      avgHoldDays: number;
      startDate: string;
      endDate: string;
      signalsGenerated: number;
      signalsSkippedNoSlot: number;
    };
  }> {
    const params = { ...DUMB_HUNTER_SWING_DEFAULT_PARAMS, ...(paramsOverride ?? {}) };
    const watchlist = symbols && symbols.length > 0 ? symbols : this.DUMB_HUNTER_SWING_WATCHLIST;

    this.logger.log(
      `Dumb Hunter SWING backtest: ${watchlist.length} symbols × ${lookbackWeeks}w lookback, capital $${capital}`,
    );

    // Fetch daily bars per symbol. For level building we want ~1 year of history
    // behind the backtest window, so extend the getDailyBars lookback generously.
    const barsBySymbol = new Map<string, BarData[]>();
    for (const symbol of watchlist) {
      try {
        const bars = await this.getDailyBars(symbol, endDate);
        if (bars.length > 0) barsBySymbol.set(symbol, bars);
      } catch (err: any) {
        this.logger.warn(`Swing: daily bars failed for ${symbol}: ${err?.message ?? err}`);
      }
    }

    // Determine the entry window: last `lookbackWeeks * 5` trading days.
    // (Trading days ≈ weekdays; approximate with lookbackWeeks * 5.)
    const windowBarCount = lookbackWeeks * 5;

    // Generate swing signals per symbol.
    const allSignals: DumbHunterSwingSignal[] = [];
    for (const [symbol, bars] of barsBySymbol) {
      const startIdx = Math.max(0, bars.length - windowBarCount);
      const sigs = generateDumbHunterSwingSignals(symbol, bars, startIdx, params);
      allSignals.push(...sigs);
    }

    // Sort chronologically for the portfolio simulator.
    allSignals.sort((a, b) => a.entryDate.localeCompare(b.entryDate));

    // Build the union timeline of bar dates across all symbols, restricted to the
    // window we care about (one bar before the first signal through the last bar).
    const dateSet = new Set<string>();
    for (const [, bars] of barsBySymbol) {
      for (const b of bars) {
        const d = b.timestamp.split('T')[0];
        dateSet.add(d);
      }
    }
    const timeline = [...dateSet].sort();

    type OpenPosition = {
      symbol: string;
      side: 'buy' | 'sell';
      entryDate: string;
      entryBarIndex: number;
      entryPrice: number;
      stopLevel: number;
      targetPrice: number;
      shares: number;
    };

    const openPositions: OpenPosition[] = [];
    const trades: Array<any> = [];
    let equity = capital;
    let peakEquity = equity;
    let maxDrawdown = 0;
    let signalsSkippedNoSlot = 0;

    // Pre-index signals by date for O(1) lookup on each timeline day.
    const signalsByDate = new Map<string, DumbHunterSwingSignal[]>();
    for (const s of allSignals) {
      const d = s.entryDate.split('T')[0];
      if (!signalsByDate.has(d)) signalsByDate.set(d, []);
      signalsByDate.get(d)!.push(s);
    }

    // Pre-index daily bars by (symbol, date-prefix) for O(1) lookup.
    const barByKey = new Map<string, BarData>();
    for (const [symbol, bars] of barsBySymbol) {
      for (const b of bars) {
        const d = b.timestamp.split('T')[0];
        barByKey.set(`${symbol}::${d}`, b);
      }
    }

    for (const date of timeline) {
      // 1. Close any open positions whose stop/target/time-stop hit today.
      for (let idx = openPositions.length - 1; idx >= 0; idx--) {
        const pos = openPositions[idx];
        const bar = barByKey.get(`${pos.symbol}::${date}`);
        if (!bar) continue; // non-trading day for this symbol (unlikely but safe)

        const holdDays =
          Math.round(
            (new Date(date + 'T00:00:00Z').getTime() -
              new Date(pos.entryDate.split('T')[0] + 'T00:00:00Z').getTime()) /
              86400000,
          );

        let exitPrice: number | null = null;
        let exitReason: SimulatedTrade['exitReason'] = 'end_of_backtest';

        if (pos.side === 'buy') {
          if (bar.low <= pos.stopLevel) {
            exitPrice = pos.stopLevel; exitReason = 'stop_loss';
          } else if (bar.high >= pos.targetPrice) {
            exitPrice = pos.targetPrice; exitReason = 'take_profit';
          }
        } else {
          if (bar.high >= pos.stopLevel) {
            exitPrice = pos.stopLevel; exitReason = 'stop_loss';
          } else if (bar.low <= pos.targetPrice) {
            exitPrice = pos.targetPrice; exitReason = 'take_profit';
          }
        }

        if (exitPrice === null && holdDays >= params.maxHoldDays) {
          exitPrice = bar.close;
          exitReason = 'time_stop';
        }

        if (exitPrice !== null) {
          const mult = pos.side === 'buy' ? 1 : -1;
          const pnl = (exitPrice - pos.entryPrice) * mult * pos.shares;
          const pnlPercent = ((exitPrice - pos.entryPrice) * mult / pos.entryPrice) * 100;
          equity += pnl;
          peakEquity = Math.max(peakEquity, equity);
          const dd = ((peakEquity - equity) / peakEquity) * 100;
          maxDrawdown = Math.max(maxDrawdown, dd);

          trades.push({
            symbol: pos.symbol,
            side: pos.side,
            entryDate: pos.entryDate,
            exitDate: bar.timestamp,
            holdDays,
            entryPrice: pos.entryPrice,
            exitPrice,
            stopLevel: pos.stopLevel,
            targetPrice: pos.targetPrice,
            shares: pos.shares,
            pnl: Math.round(pnl * 100) / 100,
            pnlPercent: Math.round(pnlPercent * 100) / 100,
            exitReason,
            equityAfter: Math.round(equity * 100) / 100,
          });
          openPositions.splice(idx, 1);
        }
      }

      // 2. Open new positions from signals entering today, up to the concurrent cap.
      const todaySignals = signalsByDate.get(date) ?? [];
      for (const sig of todaySignals) {
        if (openPositions.length >= params.maxConcurrentPositions) {
          signalsSkippedNoSlot++;
          continue;
        }
        // One position per symbol at a time
        if (openPositions.some((p) => p.symbol === sig.symbol)) continue;

        const riskPerShare = Math.abs(sig.entryPrice - sig.stopLevel);
        if (riskPerShare <= 0) continue;
        const riskDollars = equity * params.riskPercent;
        const shares = Math.floor(riskDollars / riskPerShare);
        if (shares <= 0) continue;

        openPositions.push({
          symbol: sig.symbol,
          side: sig.side,
          entryDate: sig.entryDate,
          entryBarIndex: sig.entryBarIndex,
          entryPrice: sig.entryPrice,
          stopLevel: sig.stopLevel,
          targetPrice: sig.targetPrice,
          shares,
        });
      }
    }

    // 3. Close any still-open positions at the last available bar.
    for (const pos of openPositions) {
      const bars = barsBySymbol.get(pos.symbol) ?? [];
      const lastBar = bars[bars.length - 1];
      if (!lastBar) continue;
      const mult = pos.side === 'buy' ? 1 : -1;
      const pnl = (lastBar.close - pos.entryPrice) * mult * pos.shares;
      const pnlPercent = ((lastBar.close - pos.entryPrice) * mult / pos.entryPrice) * 100;
      equity += pnl;
      peakEquity = Math.max(peakEquity, equity);
      maxDrawdown = Math.max(maxDrawdown, ((peakEquity - equity) / peakEquity) * 100);

      const holdDays = Math.round(
        (new Date(lastBar.timestamp.split('T')[0] + 'T00:00:00Z').getTime() -
          new Date(pos.entryDate.split('T')[0] + 'T00:00:00Z').getTime()) /
          86400000,
      );

      trades.push({
        symbol: pos.symbol,
        side: pos.side,
        entryDate: pos.entryDate,
        exitDate: lastBar.timestamp,
        holdDays,
        entryPrice: pos.entryPrice,
        exitPrice: lastBar.close,
        stopLevel: pos.stopLevel,
        targetPrice: pos.targetPrice,
        shares: pos.shares,
        pnl: Math.round(pnl * 100) / 100,
        pnlPercent: Math.round(pnlPercent * 100) / 100,
        exitReason: 'end_of_backtest',
        equityAfter: Math.round(equity * 100) / 100,
      });
    }

    // Aggregate per-symbol stats + totals.
    const bySymbol: Record<string, { trades: number; wins: number; pnl: number }> = {};
    for (const t of trades) {
      if (!bySymbol[t.symbol]) bySymbol[t.symbol] = { trades: 0, wins: 0, pnl: 0 };
      bySymbol[t.symbol].trades++;
      if (t.pnl > 0) bySymbol[t.symbol].wins++;
      bySymbol[t.symbol].pnl = Math.round((bySymbol[t.symbol].pnl + t.pnl) * 100) / 100;
    }

    const wins = trades.filter((t) => t.pnl > 0).length;
    const losses = trades.filter((t) => t.pnl < 0).length;
    const totalPnl = Math.round(trades.reduce((s, t) => s + t.pnl, 0) * 100) / 100;
    const avgHoldDays = trades.length > 0
      ? Math.round((trades.reduce((s, t) => s + t.holdDays, 0) / trades.length) * 10) / 10
      : 0;

    const startDate = timeline[Math.max(0, timeline.length - windowBarCount)] ?? timeline[0] ?? endDate;
    const finalEndDate = timeline[timeline.length - 1] ?? endDate;

    return {
      trades,
      bySymbol,
      totals: {
        startingCapital: capital,
        finalEquity: Math.round(equity * 100) / 100,
        totalPnl,
        totalReturnPercent: Math.round((totalPnl / capital) * 100 * 100) / 100,
        totalTrades: trades.length,
        wins,
        losses,
        winRate: trades.length > 0 ? Math.round((wins / trades.length) * 100 * 100) / 100 : 0,
        maxDrawdown: Math.round(maxDrawdown * 100) / 100,
        avgHoldDays,
        startDate,
        endDate: finalEndDate,
        signalsGenerated: allSignals.length,
        signalsSkippedNoSlot,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════
  //  CLAUDE HYBRID — Swing-primary + Intraday-blend supplement
  // ═══════════════════════════════════════════════════════════════
  //
  // Leans into the Dumb Hunter SWING edge (multi-day HTF-reclaim holds) as the
  // primary capital deployment. Layers the intraday author blend (Emanuel +
  // Dumb Hunter intraday + ProRealAlgos + Fabio) on top for same-day gap plays.
  //
  //   SWING LAYER  — up to maxConcurrentSwing positions held many days
  //   INTRADAY LAYER — up to maxIntradayPerDay trades per day on gap setups
  //                    (uses the existing simulateClaude blend engine)
  //
  // Both layers share the running equity pool: swing wins let intraday size
  // bigger, intraday losses shrink swing size. Max-concurrent caps protect
  // against correlated drawdown.

  async claudeHybridBacktest(
    endDate: string,
    capital = 10000,
    lookbackWeeks = 20,
    swingSymbols?: string[],
    maxConcurrentSwing = 5,
    maxIntradayPerDay = 2,
  ): Promise<{
    trades: Array<{
      tradeType: 'swing' | 'intraday';
      symbol: string;
      side: 'buy' | 'sell';
      entryDate: string;
      exitDate: string;
      holdDays: number;
      entryPrice: number;
      exitPrice: number;
      stopLevel?: number;
      targetPrice?: number;
      shares: number;
      pnl: number;
      pnlPercent: number;
      exitReason: string;
      equityAfter: number;
    }>;
    bySymbol: Record<string, { trades: number; wins: number; pnl: number }>;
    byLayer: {
      swing: { trades: number; wins: number; pnl: number };
      intraday: { trades: number; wins: number; pnl: number };
    };
    totals: {
      startingCapital: number;
      finalEquity: number;
      totalPnl: number;
      totalReturnPercent: number;
      totalTrades: number;
      wins: number;
      losses: number;
      winRate: number;
      maxDrawdown: number;
      avgHoldDays: number;
      startDate: string;
      endDate: string;
      swingSignals: number;
      swingSignalsSkippedNoSlot: number;
    };
  }> {
    const params = DUMB_HUNTER_SWING_DEFAULT_PARAMS;
    const watchlist = swingSymbols && swingSymbols.length > 0
      ? swingSymbols
      : this.DUMB_HUNTER_SWING_WATCHLIST;

    this.logger.log(
      `Claude HYBRID: ${watchlist.length} swing syms × ${lookbackWeeks}w + per-day intraday blend, capital $${capital}`,
    );

    // ── Phase 1: fetch swing daily bars + generate signals ──
    const barsBySymbol = new Map<string, BarData[]>();
    for (const symbol of watchlist) {
      try {
        const bars = await this.getDailyBars(symbol, endDate);
        if (bars.length > 0) barsBySymbol.set(symbol, bars);
      } catch (err: any) {
        this.logger.warn(`Hybrid: swing bars failed for ${symbol}: ${err?.message ?? err}`);
      }
    }

    const windowBars = lookbackWeeks * 5;
    const allSwingSignals: DumbHunterSwingSignal[] = [];
    for (const [symbol, bars] of barsBySymbol) {
      const startIdx = Math.max(0, bars.length - windowBars);
      allSwingSignals.push(...generateDumbHunterSwingSignals(symbol, bars, startIdx, params));
    }
    allSwingSignals.sort((a, b) => a.entryDate.localeCompare(b.entryDate));

    const signalsByDate = new Map<string, DumbHunterSwingSignal[]>();
    for (const s of allSwingSignals) {
      const d = s.entryDate.split('T')[0];
      if (!signalsByDate.has(d)) signalsByDate.set(d, []);
      signalsByDate.get(d)!.push(s);
    }

    const barByKey = new Map<string, BarData>();
    for (const [symbol, bars] of barsBySymbol) {
      for (const b of bars) {
        barByKey.set(`${symbol}::${b.timestamp.split('T')[0]}`, b);
      }
    }

    // ── Phase 2: build the portfolio timeline (union of trading days in window) ──
    const dateSet = new Set<string>();
    for (const [, bars] of barsBySymbol) {
      for (const b of bars.slice(-windowBars - 10)) {
        dateSet.add(b.timestamp.split('T')[0]);
      }
    }
    const timeline = [...dateSet].sort();
    if (timeline.length === 0) {
      return {
        trades: [],
        bySymbol: {},
        byLayer: { swing: { trades: 0, wins: 0, pnl: 0 }, intraday: { trades: 0, wins: 0, pnl: 0 } },
        totals: {
          startingCapital: capital, finalEquity: capital, totalPnl: 0, totalReturnPercent: 0,
          totalTrades: 0, wins: 0, losses: 0, winRate: 0, maxDrawdown: 0, avgHoldDays: 0,
          startDate: endDate, endDate, swingSignals: 0, swingSignalsSkippedNoSlot: 0,
        },
      };
    }

    // ── Phase 3: walk forward day-by-day, running swing + intraday ──
    type OpenSwing = {
      symbol: string;
      side: 'buy' | 'sell';
      entryDate: string;
      entryPrice: number;
      stopLevel: number;
      targetPrice: number;
      shares: number;
    };

    const openSwing: OpenSwing[] = [];
    const trades: Array<any> = [];
    let equity = capital;
    let peak = equity;
    let maxDrawdown = 0;
    let swingSignalsSkipped = 0;

    for (const date of timeline) {
      // 3a. Close any open swing positions that hit stop / target / time-stop today.
      for (let i = openSwing.length - 1; i >= 0; i--) {
        const pos = openSwing[i];
        const bar = barByKey.get(`${pos.symbol}::${date}`);
        if (!bar) continue;

        const holdDays = Math.round(
          (new Date(date + 'T00:00:00Z').getTime() -
            new Date(pos.entryDate.split('T')[0] + 'T00:00:00Z').getTime()) /
            86400000,
        );

        let exitPrice: number | null = null;
        let exitReason: SimulatedTrade['exitReason'] = 'end_of_backtest';
        if (pos.side === 'buy') {
          if (bar.low <= pos.stopLevel) { exitPrice = pos.stopLevel; exitReason = 'stop_loss'; }
          else if (bar.high >= pos.targetPrice) { exitPrice = pos.targetPrice; exitReason = 'take_profit'; }
        } else {
          if (bar.high >= pos.stopLevel) { exitPrice = pos.stopLevel; exitReason = 'stop_loss'; }
          else if (bar.low <= pos.targetPrice) { exitPrice = pos.targetPrice; exitReason = 'take_profit'; }
        }
        if (exitPrice === null && holdDays >= params.maxHoldDays) {
          exitPrice = bar.close;
          exitReason = 'time_stop';
        }

        if (exitPrice !== null) {
          const mult = pos.side === 'buy' ? 1 : -1;
          const pnl = (exitPrice - pos.entryPrice) * mult * pos.shares;
          const pnlPercent = ((exitPrice - pos.entryPrice) * mult / pos.entryPrice) * 100;
          equity += pnl;
          peak = Math.max(peak, equity);
          maxDrawdown = Math.max(maxDrawdown, ((peak - equity) / peak) * 100);

          trades.push({
            tradeType: 'swing',
            symbol: pos.symbol, side: pos.side,
            entryDate: pos.entryDate, exitDate: bar.timestamp, holdDays,
            entryPrice: pos.entryPrice, exitPrice,
            stopLevel: pos.stopLevel, targetPrice: pos.targetPrice,
            shares: pos.shares,
            pnl: Math.round(pnl * 100) / 100,
            pnlPercent: Math.round(pnlPercent * 100) / 100,
            exitReason, equityAfter: Math.round(equity * 100) / 100,
          });
          openSwing.splice(i, 1);
        }
      }

      // 3b. Open new swing signals entering today (FCFS under concurrent cap, one per symbol).
      const todaySignals = signalsByDate.get(date) ?? [];
      for (const sig of todaySignals) {
        if (openSwing.length >= maxConcurrentSwing) { swingSignalsSkipped++; continue; }
        if (openSwing.some((p) => p.symbol === sig.symbol)) continue;
        const riskPerShare = Math.abs(sig.entryPrice - sig.stopLevel);
        if (riskPerShare <= 0) continue;
        const riskDollars = equity * params.riskPercent;
        const shares = Math.floor(riskDollars / riskPerShare);
        if (shares <= 0) continue;
        openSwing.push({
          symbol: sig.symbol, side: sig.side,
          entryDate: sig.entryDate, entryPrice: sig.entryPrice,
          stopLevel: sig.stopLevel, targetPrice: sig.targetPrice, shares,
        });
      }

      // 3c. INTRADAY LAYER — run the existing Claude blend on this date's gap setups.
      // Only executes on weekdays; uses the day's gap scan → top 3 setups.
      const dow = new Date(date + 'T12:00:00Z').getUTCDay();
      if (dow === 0 || dow === 6) continue; // skip weekends

      let gapResults = await this.gapScanner.getAllResults(date);
      if (gapResults.length === 0) {
        try { gapResults = await this.gapScanner.scanHistoricalGaps(date); }
        catch { continue; }
      }
      if (gapResults.length === 0) continue;

      const top3 = [...gapResults]
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, 3);

      const tradingDay = this.getNextTradingDay(date);
      const startTime = `${tradingDay}T09:30:00-04:00`;
      const endTime = `${tradingDay}T16:00:00-04:00`;

      const daySetups: StockSetup[] = [];
      for (const gap of top3) {
        try {
          const bars = await this.alpaca.getHistoricalBars(gap.symbol, '5Min', startTime, endTime);
          if (bars.length < 6) continue;
          const dailyBars = await this.getDailyBars(gap.symbol, date);
          const gapPercent = Number(gap.gapPercent);
          const isGapUp = gapPercent > 0;
          daySetups.push({
            symbol: gap.symbol, bars, gapPercent, isGapUp,
            side: isGapUp ? 'buy' : 'sell',
            ma20: gap.ma20 != null ? Number(gap.ma20) : undefined,
            ma200: gap.ma200 != null ? Number(gap.ma200) : undefined,
            trendDirection: gap.trendDirection || undefined,
            dailyContext: gap.dailyContext || undefined,
            score: gap.score ?? undefined,
            dailyBars,
            prevClose: gap.prevClose != null ? Number(gap.prevClose) : undefined,
          });
        } catch { /* skip fetch errors */ }
      }

      if (daySetups.length === 0) continue;

      // Reuse the existing intraday blend, with the tighter per-day trade cap for the hybrid.
      let intradaySim: SimResult | null = null;
      try {
        intradaySim = simulateClaude(daySetups, equity, { maxTradesPerDay: maxIntradayPerDay });
      } catch (err: any) {
        this.logger.warn(`Hybrid intraday blend failed for ${date}: ${err?.message ?? err}`);
      }
      if (!intradaySim) continue;

      for (const t of intradaySim.trades) {
        equity += t.pnl;
        peak = Math.max(peak, equity);
        maxDrawdown = Math.max(maxDrawdown, ((peak - equity) / peak) * 100);
        trades.push({
          tradeType: 'intraday',
          symbol: t.symbol ?? 'UNKNOWN', side: t.side,
          entryDate: date, exitDate: date, holdDays: 0,
          entryPrice: t.entryPrice, exitPrice: t.exitPrice,
          stopLevel: undefined, targetPrice: undefined,
          shares: t.shares ?? 0,
          pnl: Math.round(t.pnl * 100) / 100,
          pnlPercent: Math.round(t.pnlPercent * 100) / 100,
          exitReason: t.exitReason,
          equityAfter: Math.round(equity * 100) / 100,
        });
      }
    }

    // 3d. Close any still-open swing positions at their last available bar.
    for (const pos of openSwing) {
      const bars = barsBySymbol.get(pos.symbol) ?? [];
      const lastBar = bars[bars.length - 1];
      if (!lastBar) continue;
      const mult = pos.side === 'buy' ? 1 : -1;
      const pnl = (lastBar.close - pos.entryPrice) * mult * pos.shares;
      const pnlPercent = ((lastBar.close - pos.entryPrice) * mult / pos.entryPrice) * 100;
      equity += pnl;
      peak = Math.max(peak, equity);
      maxDrawdown = Math.max(maxDrawdown, ((peak - equity) / peak) * 100);
      const holdDays = Math.round(
        (new Date(lastBar.timestamp.split('T')[0] + 'T00:00:00Z').getTime() -
          new Date(pos.entryDate.split('T')[0] + 'T00:00:00Z').getTime()) /
          86400000,
      );
      trades.push({
        tradeType: 'swing',
        symbol: pos.symbol, side: pos.side,
        entryDate: pos.entryDate, exitDate: lastBar.timestamp, holdDays,
        entryPrice: pos.entryPrice, exitPrice: lastBar.close,
        stopLevel: pos.stopLevel, targetPrice: pos.targetPrice,
        shares: pos.shares,
        pnl: Math.round(pnl * 100) / 100,
        pnlPercent: Math.round(pnlPercent * 100) / 100,
        exitReason: 'end_of_backtest',
        equityAfter: Math.round(equity * 100) / 100,
      });
    }

    // ── Aggregates ──
    const bySymbol: Record<string, { trades: number; wins: number; pnl: number }> = {};
    const byLayer = {
      swing: { trades: 0, wins: 0, pnl: 0 },
      intraday: { trades: 0, wins: 0, pnl: 0 },
    };
    for (const t of trades) {
      if (!bySymbol[t.symbol]) bySymbol[t.symbol] = { trades: 0, wins: 0, pnl: 0 };
      bySymbol[t.symbol].trades++;
      if (t.pnl > 0) bySymbol[t.symbol].wins++;
      bySymbol[t.symbol].pnl = Math.round((bySymbol[t.symbol].pnl + t.pnl) * 100) / 100;

      const layer = byLayer[t.tradeType as 'swing' | 'intraday'];
      layer.trades++;
      if (t.pnl > 0) layer.wins++;
      layer.pnl = Math.round((layer.pnl + t.pnl) * 100) / 100;
    }

    const wins = trades.filter((t) => t.pnl > 0).length;
    const losses = trades.filter((t) => t.pnl < 0).length;
    const totalPnl = Math.round(trades.reduce((s, t) => s + t.pnl, 0) * 100) / 100;
    const avgHoldDays = trades.length > 0
      ? Math.round((trades.reduce((s, t) => s + t.holdDays, 0) / trades.length) * 10) / 10
      : 0;

    // Sort trades by entryDate so the UI sees them chronologically.
    trades.sort((a, b) => a.entryDate.localeCompare(b.entryDate));

    return {
      trades,
      bySymbol,
      byLayer,
      totals: {
        startingCapital: capital,
        finalEquity: Math.round(equity * 100) / 100,
        totalPnl,
        totalReturnPercent: Math.round((totalPnl / capital) * 100 * 100) / 100,
        totalTrades: trades.length,
        wins,
        losses,
        winRate: trades.length > 0 ? Math.round((wins / trades.length) * 100 * 100) / 100 : 0,
        maxDrawdown: Math.round(maxDrawdown * 100) / 100,
        avgHoldDays,
        startDate: timeline[0],
        endDate: timeline[timeline.length - 1],
        swingSignals: allSwingSignals.length,
        swingSignalsSkippedNoSlot: swingSignalsSkipped,
      },
    };
  }

  async claudeTopPicks(
    endDate: string,
    capital = 1000,
    lookbackDays = 10,
    longOnly = false,
  ): Promise<{
    days: Array<{
      scanDate: string;
      tradingDay: string;
      startBalance: number;
      picks: Array<{
        symbol: string;
        gapPercent: number;
        score: number;
        scoreReasons: string[];
        dailyContext: string;
        trendDirection: string;
        trade: {
          side: string;
          entryPrice: number;
          exitPrice: number;
          shares: number;
          grossPnl: number;
          fees: number;
          netPnl: number;
          pnlPercent: number;
          exitReason: string;
        } | null;
        skippedReason: string | null;
      }>;
      dayGrossPnl: number;
      dayFees: number;
      dayNetPnl: number;
      endBalance: number;
      dayTrades: number;
      dayWins: number;
    }>;
    totals: {
      startingCapital: number;
      finalBalance: number;
      totalGrossPnl: number;
      totalFees: number;
      totalNetPnl: number;
      totalReturn: number;
      totalTrades: number;
      totalWins: number;
      winRate: number;
      daysAnalysed: number;
      avgDailyPnl: number;
      bestDay: { date: string; pnl: number } | null;
      worstDay: { date: string; pnl: number } | null;
    };
  }> {
    const end = new Date(endDate + 'T00:00:00');
    const start = new Date(end);
    start.setDate(start.getDate() - Math.ceil(lookbackDays * 1.6));
    const tradingDays = this.getTradingDays(
      start.toISOString().split('T')[0],
      endDate,
    ).slice(-lookbackDays);

    this.logger.log(`Claude top picks: ${tradingDays.length} trading days up to ${endDate}`);

    const days: Array<any> = [];
    let runningBalance = capital;
    let totalGrossPnl = 0;
    let totalFees = 0;
    let totalTrades = 0;
    let totalWins = 0;

    for (const scanDate of tradingDays) {
      const dayStartBalance = runningBalance;

      let gapResults = await this.gapScanner.getAllResults(scanDate);
      if (gapResults.length === 0) {
        try {
          gapResults = await this.gapScanner.scanHistoricalGaps(scanDate);
        } catch { continue; }
      }
      if (gapResults.length === 0) continue;

      // Filter long-only if set
      const filtered = longOnly
        ? gapResults.filter(g => Number(g.gapPercent) > 0)
        : gapResults;

      // Sort by score, take top 5 (Claude may trade up to 3, needs candidates)
      const top5 = [...filtered]
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, 5);

      const tradingDay = this.getNextTradingDay(scanDate);
      const startTime = `${tradingDay}T09:30:00-04:00`;
      const endTime = `${tradingDay}T16:00:00-04:00`;

      // Build setups for all candidates
      const daySetups: StockSetup[] = [];
      const pickData: Array<any> = [];

      for (const gap of top5) {
        const info: any = {
          symbol: gap.symbol,
          gapPercent: Number(gap.gapPercent),
          score: gap.score ?? 0,
          scoreReasons: gap.scoreReasons || [],
          dailyContext: gap.dailyContext || 'other',
          trendDirection: gap.trendDirection || 'sideways',
          trade: null,
          skippedReason: null,
        };

        try {
          const bars = await this.alpaca.getHistoricalBars(gap.symbol, '5Min', startTime, endTime);
          if (bars.length < 6) {
            info.skippedReason = 'Not enough intraday bars';
            pickData.push(info);
            continue;
          }

          const dailyBars = await this.getDailyBars(gap.symbol, scanDate);
          const gapPercent = Number(gap.gapPercent);
          const isGapUp = gapPercent > 0;

          daySetups.push({
            symbol: gap.symbol,
            bars,
            gapPercent,
            isGapUp,
            side: isGapUp ? 'buy' : 'sell',
            ma20: gap.ma20 != null ? Number(gap.ma20) : undefined,
            ma200: gap.ma200 != null ? Number(gap.ma200) : undefined,
            trendDirection: gap.trendDirection || undefined,
            dailyContext: gap.dailyContext || undefined,
            score: gap.score ?? undefined,
            dailyBars,
            prevClose: gap.prevClose != null ? Number(gap.prevClose) : undefined,
          });
        } catch (err) {
          info.skippedReason = `Bar fetch error`;
        }

        pickData.push(info);
      }

      // Run Claude's engine on all setups (it picks up to 3)
      let dayGrossPnl = 0;
      let dayFees = 0;
      let dayTrades = 0;
      let dayWins = 0;

      if (daySetups.length > 0) {
        const sim = simulateClaude(daySetups, runningBalance);

        for (const t of sim.trades) {
          const info = pickData.find(p => p.symbol === t.symbol);
          const fees = this.calculateFees(t.side, t.shares || 0, t.entryPrice, t.exitPrice);
          const netPnl = Math.round((t.pnl - fees) * 100) / 100;

          if (info) {
            info.trade = {
              side: t.side,
              entryPrice: t.entryPrice,
              exitPrice: t.exitPrice,
              shares: t.shares || 0,
              grossPnl: Math.round(t.pnl * 100) / 100,
              fees: fees,
              netPnl: netPnl,
              pnlPercent: Math.round(t.pnlPercent * 100) / 100,
              exitReason: t.exitReason,
            };
          }

          dayGrossPnl += t.pnl;
          dayFees += fees;
          dayTrades++;
          if (t.pnl > 0) dayWins++;
        }

        // Mark skipped reasons
        for (const reason of sim.skippedReasons) {
          const sym = reason.split(':')[0];
          const info = pickData.find(p => p.symbol === sym && !p.trade && !p.skippedReason);
          if (info) info.skippedReason = reason.split(': ').slice(1).join(': ');
        }
      }

      dayGrossPnl = Math.round(dayGrossPnl * 100) / 100;
      dayFees = Math.round(dayFees * 100) / 100;
      const dayNetPnl = Math.round((dayGrossPnl - dayFees) * 100) / 100;
      runningBalance = Math.round((runningBalance + dayNetPnl) * 100) / 100;

      totalGrossPnl += dayGrossPnl;
      totalFees += dayFees;
      totalTrades += dayTrades;
      totalWins += dayWins;

      days.push({
        scanDate,
        tradingDay,
        startBalance: dayStartBalance,
        picks: pickData,
        dayGrossPnl,
        dayFees,
        dayNetPnl,
        endBalance: runningBalance,
        dayTrades,
        dayWins,
      });
    }

    const daysWithTrades = days.filter(d => d.dayTrades > 0);
    const showBestWorst = daysWithTrades.length >= 2;
    const bestDay = showBestWorst
      ? daysWithTrades.reduce((b, d) => d.dayNetPnl > b.dayNetPnl ? d : b)
      : null;
    const worstDay = showBestWorst
      ? daysWithTrades.reduce((w, d) => d.dayNetPnl < w.dayNetPnl ? d : w)
      : null;

    totalGrossPnl = Math.round(totalGrossPnl * 100) / 100;
    totalFees = Math.round(totalFees * 100) / 100;
    const totalNetPnl = Math.round((totalGrossPnl - totalFees) * 100) / 100;

    return {
      days,
      totals: {
        startingCapital: capital,
        finalBalance: runningBalance,
        totalGrossPnl,
        totalFees,
        totalNetPnl,
        totalReturn: Math.round((totalNetPnl / capital) * 100 * 100) / 100,
        totalTrades,
        totalWins,
        winRate: totalTrades > 0 ? Math.round((totalWins / totalTrades) * 100 * 100) / 100 : 0,
        daysAnalysed: days.length,
        avgDailyPnl: days.length > 0 ? Math.round((totalNetPnl / days.length) * 100) / 100 : 0,
        bestDay: bestDay ? { date: bestDay.scanDate, pnl: bestDay.dayNetPnl } : null,
        worstDay: worstDay ? { date: worstDay.scanDate, pnl: worstDay.dayNetPnl } : null,
      },
    };
  }

  /**
   * ProRealAlgos picks — same structure as Claude picks but uses the Quick Flip Scalper engine.
   */
  // Large-cap watchlist for ProRealAlgos — these have institutional liquidity manipulation
  private readonly PROREALALGOS_WATCHLIST = [
    'QQQ', 'SPY', 'AAPL', 'NVDA', 'TSLA', 'MSFT', 'AMZN', 'META', 'GOOG', 'AMD',
    'NFLX', 'CRM', 'AVGO', 'COST', 'BA', 'JPM', 'V', 'MA', 'DIS', 'PYPL',
  ];

  async proRealAlgosTopPicks(endDate: string, capital = 1000, lookbackDays = 10, symbols?: string[], longOnly = false) {
    const end = new Date(endDate + 'T00:00:00');
    const start = new Date(end);
    start.setDate(start.getDate() - Math.ceil(lookbackDays * 1.6));
    const tradingDays = this.getTradingDays(
      start.toISOString().split('T')[0],
      endDate,
    ).slice(-lookbackDays);

    const watchlist = symbols && symbols.length > 0 ? symbols : this.PROREALALGOS_WATCHLIST;
    this.logger.log(`ProRealAlgos picks: ${tradingDays.length} days, ${watchlist.length} symbols: ${watchlist.slice(0, 5).join(', ')}${watchlist.length > 5 ? '...' : ''}`);

    const days: Array<any> = [];
    let runningBalance = capital;
    let totalGrossPnl = 0;
    let totalFees = 0;
    let totalTrades = 0;
    let totalWins = 0;

    for (const scanDate of tradingDays) {
      const dayStartBalance = runningBalance;

      // Use the NEXT trading day for intraday bars (scanDate = the day we analyse, tradingDay = when we trade)
      const tradingDay = scanDate; // For large-caps we trade on the day itself
      const startTime = `${tradingDay}T09:30:00-04:00`;
      const endTime = `${tradingDay}T16:00:00-04:00`;

      const daySetups: StockSetup[] = [];
      const pickData: Array<any> = [];

      for (const symbol of watchlist) {
        const info: any = {
          symbol,
          gapPercent: 0,
          score: 0,
          scoreReasons: [],
          dailyContext: 'large_cap',
          trendDirection: '',
          trade: null,
          skippedReason: null,
        };

        try {
          const bars = await this.alpaca.getHistoricalBars(symbol, '5Min', startTime, endTime);
          if (bars.length < 6) { info.skippedReason = 'Not enough intraday bars'; pickData.push(info); continue; }

          const dailyBars = await this.getDailyBars(symbol, scanDate);

          // Calculate the gap from daily bars (prev close vs today open)
          let gapPercent = 0;
          if (dailyBars && dailyBars.length >= 2) {
            const prevClose = dailyBars[dailyBars.length - 1].close;
            const todayOpen = bars[0].open;
            gapPercent = ((todayOpen - prevClose) / prevClose) * 100;
          }
          info.gapPercent = Math.round(gapPercent * 10) / 10;
          const isGapUp = gapPercent > 0;

          daySetups.push({
            symbol, bars, gapPercent, isGapUp,
            side: isGapUp ? 'buy' : 'sell',
            dailyBars,
            prevClose: dailyBars && dailyBars.length >= 1 ? dailyBars[dailyBars.length - 1].close : undefined,
          });
        } catch { info.skippedReason = 'Bar fetch error'; }

        pickData.push(info);
      }

      let dayGrossPnl = 0;
      let dayFees = 0;
      let dayTrades = 0;
      let dayWins = 0;

      if (daySetups.length > 0) {
        const sim = simulateProRealAlgos(daySetups, runningBalance, longOnly);

        for (const t of sim.trades) {
          const info = pickData.find(p => p.symbol === t.symbol);
          const fees = this.calculateFees(t.side, t.shares || 0, t.entryPrice, t.exitPrice);
          const netPnl = Math.round((t.pnl - fees) * 100) / 100;

          if (info) {
            info.trade = {
              side: t.side, entryPrice: t.entryPrice, exitPrice: t.exitPrice,
              shares: t.shares || 0, grossPnl: Math.round(t.pnl * 100) / 100,
              fees, netPnl, pnlPercent: Math.round(t.pnlPercent * 100) / 100,
              exitReason: t.exitReason,
            };
          }
          dayGrossPnl += t.pnl;
          dayFees += fees;
          dayTrades++;
          if (t.pnl > 0) dayWins++;
        }

        for (const reason of sim.skippedReasons) {
          const sym = reason.split(':')[0];
          const info = pickData.find(p => p.symbol === sym && !p.trade && !p.skippedReason);
          if (info) info.skippedReason = reason.split(': ').slice(1).join(': ');
        }
      }

      dayGrossPnl = Math.round(dayGrossPnl * 100) / 100;
      dayFees = Math.round(dayFees * 100) / 100;
      const dayNetPnl = Math.round((dayGrossPnl - dayFees) * 100) / 100;
      runningBalance = Math.round((runningBalance + dayNetPnl) * 100) / 100;

      totalGrossPnl += dayGrossPnl;
      totalFees += dayFees;
      totalTrades += dayTrades;
      totalWins += dayWins;

      days.push({
        scanDate, tradingDay, startBalance: dayStartBalance, picks: pickData,
        dayGrossPnl, dayFees, dayNetPnl, endBalance: runningBalance, dayTrades, dayWins,
      });
    }

    const daysWithTrades = days.filter(d => d.dayTrades > 0);
    const showBestWorst = daysWithTrades.length >= 2;
    const bestDay = showBestWorst ? daysWithTrades.reduce((b, d) => d.dayNetPnl > b.dayNetPnl ? d : b) : null;
    const worstDay = showBestWorst ? daysWithTrades.reduce((w, d) => d.dayNetPnl < w.dayNetPnl ? d : w) : null;

    totalGrossPnl = Math.round(totalGrossPnl * 100) / 100;
    totalFees = Math.round(totalFees * 100) / 100;
    const totalNetPnl = Math.round((totalGrossPnl - totalFees) * 100) / 100;

    return {
      days,
      totals: {
        startingCapital: capital, finalBalance: runningBalance,
        totalGrossPnl, totalFees, totalNetPnl,
        totalReturn: Math.round((totalNetPnl / capital) * 100 * 100) / 100,
        totalTrades, totalWins,
        winRate: totalTrades > 0 ? Math.round((totalWins / totalTrades) * 100 * 100) / 100 : 0,
        daysAnalysed: days.length,
        avgDailyPnl: days.length > 0 ? Math.round((totalNetPnl / days.length) * 100) / 100 : 0,
        bestDay: bestDay ? { date: bestDay.scanDate, pnl: bestDay.dayNetPnl } : null,
        worstDay: worstDay ? { date: worstDay.scanDate, pnl: worstDay.dayNetPnl } : null,
      },
    };
  }
}
