import { Injectable, Logger } from '@nestjs/common';
import { AlpacaService } from '../alpaca/alpaca.service';
import { TradesService } from './trades.service';
import { SettingsService } from '../settings/settings.service';
import { StrategiesService } from '../strategies/strategies.service';
import { Strategy } from '../strategies/entities/strategy.entity';
import { WatchlistItem } from '../watchlist/entities/watchlist-item.entity';

@Injectable()
export class ScalpingService {
  private readonly logger = new Logger(ScalpingService.name);
  private monitoring = false;
  private monitorInterval: NodeJS.Timeout | null = null;

  private enabledStrategies: Strategy[] = [];

  constructor(
    private readonly alpaca: AlpacaService,
    private readonly trades: TradesService,
    private readonly settings: SettingsService,
    private readonly strategiesService: StrategiesService,
  ) {}

  async startMonitoring(watchlistItems: WatchlistItem[]) {
    if (this.monitoring) {
      this.logger.warn('Already monitoring, skipping');
      return;
    }

    this.monitoring = true;

    this.enabledStrategies = await this.strategiesService.findEnabled();
    this.logger.log(
      `Starting gap scalping monitor for ${watchlistItems.length} symbols`,
    );
    this.logger.log(
      `Active strategies: ${this.enabledStrategies.map((s) => s.name).join(', ')}`,
    );

    const maxConcurrent = await this.settings.getNumber(
      'maxConcurrentTrades',
      3,
    );
    const stopLossPct = await this.settings.getNumber(
      'stopLossPercent',
      1,
    );
    const takeProfitPct = await this.settings.getNumber(
      'takeProfitPercent',
      2,
    );
    const maxPositionSize = await this.settings.getNumber(
      'maxPositionSize',
      10000,
    );

    let openCount = 0;

    // Check each watchlist item for gap entry conditions
    for (const item of watchlistItems) {
      if (!item.active) continue;
      if (openCount >= maxConcurrent) break;

      try {
        await this.evaluateEntry(item, {
          stopLossPct,
          takeProfitPct,
          maxPositionSize,
        });
        openCount++;
      } catch (err) {
        this.logger.error(
          `Error evaluating ${item.symbol}: ${err.message}`,
        );
      }
    }

    // Monitor open positions for exit conditions every 30 seconds
    // for the first hour after open
    this.monitorInterval = setInterval(async () => {
      await this.checkExits(stopLossPct, takeProfitPct);
    }, 30_000);

    // Stop monitoring after 1 hour
    setTimeout(() => {
      this.stopMonitoring();
    }, 60 * 60 * 1000);
  }

  stopMonitoring() {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
    this.monitoring = false;
    this.logger.log('Stopped gap scalping monitor');
  }

  private async evaluateEntry(
    item: WatchlistItem,
    params: {
      stopLossPct: number;
      takeProfitPct: number;
      maxPositionSize: number;
    },
  ) {
    const quote = await this.alpaca.getLatestQuote(item.symbol);
    const currentPrice = Number(quote.AskPrice) || 0;
    if (!currentPrice) return;

    // Determine if the gap condition is met
    const isGapUp = item.gapDirection === 'up';
    const targetEntry = item.targetEntry
      ? parseFloat(String(item.targetEntry))
      : currentPrice;

    // Check if price is near our target entry
    const entryThreshold = targetEntry * 0.002; // 0.2% tolerance
    const nearEntry = Math.abs(currentPrice - targetEntry) <= entryThreshold;

    if (!nearEntry && item.targetEntry) {
      this.logger.log(
        `${item.symbol}: price ${currentPrice} not near target ${targetEntry}, skipping`,
      );
      return;
    }

    // Calculate position size
    const qty = Math.floor(params.maxPositionSize / currentPrice);
    if (qty <= 0) return;

    const side = isGapUp ? 'buy' : 'sell';

    // Calculate stop and take profit levels
    const stopLoss =
      item.stopLoss ||
      currentPrice * (1 - (params.stopLossPct / 100) * (isGapUp ? 1 : -1));
    const takeProfit =
      item.takeProfit ||
      currentPrice *
        (1 + (params.takeProfitPct / 100) * (isGapUp ? 1 : -1));

    this.logger.log(
      `Entering ${side} ${qty} ${item.symbol} @ ~${currentPrice} | SL: ${stopLoss} | TP: ${takeProfit}`,
    );

    try {
      const order = await this.alpaca.submitOrder({
        symbol: item.symbol,
        qty,
        side,
        type: 'market',
        time_in_force: 'day',
      });

      const matchedStrategy = this.enabledStrategies.find(
        (s) => s.name === 'Gap Scalp - Trend Reversal',
      );

      await this.trades.createTradeRecord({
        symbol: item.symbol,
        side,
        quantity: qty,
        entryPrice: currentPrice,
        status: 'open',
        strategy: matchedStrategy?.name ?? 'gap-scalp',
        openedAt: new Date(),
      });

      this.logger.log(`Order submitted for ${item.symbol}: ${order.id}`);
    } catch (err) {
      this.logger.error(
        `Failed to enter ${item.symbol}: ${err.message}`,
      );
    }
  }

  private async checkExits(stopLossPct: number, takeProfitPct: number) {
    const openTrades = await this.trades.findAll('open');

    for (const trade of openTrades) {
      if (trade.strategy !== 'gap-scalp') continue;

      try {
        const quote = await this.alpaca.getLatestQuote(trade.symbol);
        const currentPrice = Number(quote.BidPrice) || 0;
        if (!currentPrice || !trade.entryPrice) continue;

        const entryPrice = parseFloat(String(trade.entryPrice));
        const pctChange =
          ((currentPrice - entryPrice) / entryPrice) * 100;
        const isLong = trade.side === 'buy';
        const effectivePctChange = isLong ? pctChange : -pctChange;

        // Check stop loss
        if (effectivePctChange <= -stopLossPct) {
          this.logger.warn(
            `STOP LOSS hit for ${trade.symbol} (${effectivePctChange.toFixed(2)}%)`,
          );
          await this.exitTrade(trade.id, trade.symbol, currentPrice);
          continue;
        }

        // Check take profit
        if (effectivePctChange >= takeProfitPct) {
          this.logger.log(
            `TAKE PROFIT hit for ${trade.symbol} (${effectivePctChange.toFixed(2)}%)`,
          );
          await this.exitTrade(trade.id, trade.symbol, currentPrice);
        }
      } catch (err) {
        this.logger.error(
          `Error checking exit for ${trade.symbol}: ${err.message}`,
        );
      }
    }
  }

  private async exitTrade(
    tradeId: number,
    symbol: string,
    exitPrice: number,
  ) {
    try {
      await this.alpaca.closePosition(symbol);
      await this.trades.closeTrade(tradeId, exitPrice);
      this.logger.log(`Closed position for ${symbol} @ ${exitPrice}`);
    } catch (err) {
      this.logger.error(
        `Failed to close ${symbol}: ${err.message}`,
      );
    }
  }
}
