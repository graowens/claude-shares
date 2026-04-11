import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Trade } from './entities/trade.entity';
import { TradesService } from './trades.service';
import { TradesController } from './trades.controller';
import { ScalpingService } from './scalping.service';
import { SettingsModule } from '../settings/settings.module';
import { StrategiesModule } from '../strategies/strategies.module';

@Module({
  imports: [TypeOrmModule.forFeature([Trade]), SettingsModule, StrategiesModule],
  providers: [TradesService, ScalpingService],
  controllers: [TradesController],
  exports: [TradesService, ScalpingService],
})
export class TradesModule {}
