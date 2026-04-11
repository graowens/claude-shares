import { Module } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { WatchlistModule } from '../watchlist/watchlist.module';
import { TradesModule } from '../trades/trades.module';

@Module({
  imports: [WatchlistModule, TradesModule],
  providers: [SchedulerService],
})
export class SchedulerModule {}
