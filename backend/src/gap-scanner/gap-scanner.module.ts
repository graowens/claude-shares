import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GapScanResult } from './entities/gap-scan-result.entity';
import { GapScannerService } from './gap-scanner.service';
import { GapScannerController } from './gap-scanner.controller';
import { AlpacaModule } from '../alpaca/alpaca.module';
import { WatchlistModule } from '../watchlist/watchlist.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([GapScanResult]),
    AlpacaModule,
    WatchlistModule,
    SettingsModule,
  ],
  providers: [GapScannerService],
  controllers: [GapScannerController],
  exports: [GapScannerService],
})
export class GapScannerModule {}
