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

    const simulatedTrades: SimulatedTrade[] = [];
    let equity = capital;
    let maxEquity = equity;
    let maxDrawdown = 0;
    // Split capital evenly across selected stocks
    const capitalPerStock = capital / selected.length;

    // Market open 09:30 ET, first hour ends 10:30 ET
    const startTime = `${tradingDay}T09:30:00-04:00`;
    const endTime = `${tradingDay}T10:30:00-04:00`;

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
        const side: 'buy' | 'sell' = isGapUp ? 'buy' : 'sell';
        const entryPrice = bars[0].open;

        const stopLevel = isGapUp
          ? entryPrice * (1 - stopLoss / 100)
          : entryPrice * (1 + stopLoss / 100);

        const targetLevel = isGapUp
          ? entryPrice * (1 + takeProfit / 100)
          : entryPrice * (1 - takeProfit / 100);

        let exitPrice: number | null = null;
        let exitReason: SimulatedTrade['exitReason'] = 'end_of_hour';

        // Check each bar (skip the first since we enter at its open)
        for (let i = 0; i < bars.length; i++) {
          const bar = bars[i];

          if (isGapUp) {
            if (bar.low <= stopLevel) {
              exitPrice = stopLevel;
              exitReason = 'stop_loss';
              break;
            }
            if (bar.high >= targetLevel) {
              exitPrice = targetLevel;
              exitReason = 'take_profit';
              break;
            }
          } else {
            if (bar.high >= stopLevel) {
              exitPrice = stopLevel;
              exitReason = 'stop_loss';
              break;
            }
            if (bar.low <= targetLevel) {
              exitPrice = targetLevel;
              exitReason = 'take_profit';
              break;
            }
          }
        }

        // If no exit triggered, close at last bar's close
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

        simulatedTrades.push({
          date: tradingDay,
          symbol: gap.symbol,
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
      } catch (err) {
        this.logger.error(`Error backtesting ${gap.symbol}: ${err.message}`);
      }
    }

    const totalTrades = simulatedTrades.length;
    const wins = simulatedTrades.filter((t) => t.pnl > 0).length;
    const losses = simulatedTrades.filter((t) => t.pnl < 0).length;
    const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
    const totalPnl = simulatedTrades.reduce((sum, t) => sum + t.pnl, 0);

    const result = this.repo.create({
      symbol: 'MULTI',
      strategy: 'gap-scan-backtest',
      startDate: scanDate,
      endDate: tradingDay,
      totalTrades,
      winRate: Math.round(winRate * 100) / 100,
      totalPnl: Math.round(totalPnl * 100) / 100,
      maxDrawdown: Math.round(maxDrawdown * 100) / 100,
      params: {
        scanDate,
        tradingDay,
        stopLossPercent: stopLoss,
        takeProfitPercent: takeProfit,
        startingCapital: capital,
        finalEquity: equity,
        wins,
        losses,
        trades: simulatedTrades,
      },
    });

    return this.repo.save(result);
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
