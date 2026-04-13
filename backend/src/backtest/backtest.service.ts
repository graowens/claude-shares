import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BacktestResult } from './entities/backtest-result.entity';
import { AlpacaService } from '../alpaca/alpaca.service';
import { GapScannerService } from '../gap-scanner/gap-scanner.service';
import { RunBacktestDto } from './dto/run-backtest.dto';

interface SimulatedTrade {
  date: string;
  symbol?: string;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  pnlPercent: number;
  side: 'buy' | 'sell';
  exitReason: 'stop_loss' | 'take_profit' | 'end_of_day' | 'end_of_hour';
  shares?: number;
  gapPercent?: number;
  equityAfter?: number;
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
}

@Injectable()
export class BacktestService {
  private readonly logger = new Logger(BacktestService.name);

  constructor(
    @InjectRepository(BacktestResult)
    private readonly repo: Repository<BacktestResult>,
    private readonly alpaca: AlpacaService,
    private readonly gapScanner: GapScannerService,
  ) {}

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

    // Market open 09:30 ET, first hour ends 10:30 ET
    const startTime = `${tradingDay}T09:30:00-04:00`;
    const endTime = `${tradingDay}T10:30:00-04:00`;

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

        const gapPercent = Number(gap.gapPercent);
        const isGapUp = gapPercent > 0;
        setups.push({
          symbol: gap.symbol,
          bars,
          gapPercent,
          isGapUp,
          side: isGapUp ? 'buy' : 'sell',
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
      },
    });

    return this.repo.save(result);
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
}
