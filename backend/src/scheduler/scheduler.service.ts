import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { WatchlistService } from '../watchlist/watchlist.service';
import { ScalpingService } from '../trades/scalping.service';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly watchlist: WatchlistService,
    private readonly scalping: ScalpingService,
  ) {}

  /**
   * Runs at 14:25 UK time (5 min before NYSE open).
   * Prepares active watchlist items for the trading session.
   * Cron: minute 25, hour 14, any day of month, any month, Mon-Fri
   */
  @Cron('0 25 14 * * 1-5', { timeZone: 'Europe/London' })
  async prepareSession() {
    this.logger.log('=== Preparing trading session (14:25 UK) ===');

    const today = new Date().toISOString().split('T')[0];
    let items = await this.watchlist.findActiveForDate(today);

    // If no items scheduled for today, use all active items
    if (items.length === 0) {
      items = await this.watchlist.findAllActive();
    }

    this.logger.log(
      `Found ${items.length} active watchlist items for today`,
    );
    items.forEach((item) => {
      this.logger.log(
        `  - ${item.symbol} | gap: ${item.gapDirection} | entry: ${item.targetEntry} | SL: ${item.stopLoss} | TP: ${item.takeProfit}`,
      );
    });
  }

  /**
   * Runs at 14:30 UK time (NYSE market open).
   * Starts monitoring active watchlist items for gap entries.
   */
  @Cron('0 30 14 * * 1-5', { timeZone: 'Europe/London' })
  async startTrading() {
    this.logger.log('=== NYSE Market Open (14:30 UK) - Starting scalping monitor ===');

    const today = new Date().toISOString().split('T')[0];
    let items = await this.watchlist.findActiveForDate(today);

    if (items.length === 0) {
      items = await this.watchlist.findAllActive();
    }

    if (items.length === 0) {
      this.logger.warn('No active watchlist items, skipping trading session');
      return;
    }

    await this.scalping.startMonitoring(items);
  }

  /**
   * Runs at 15:30 UK time (end of first hour).
   * Stops monitoring and closes remaining positions.
   */
  @Cron('0 30 15 * * 1-5', { timeZone: 'Europe/London' })
  async endSession() {
    this.logger.log('=== End of first hour (15:30 UK) - Stopping monitor ===');
    this.scalping.stopMonitoring();
  }
}
