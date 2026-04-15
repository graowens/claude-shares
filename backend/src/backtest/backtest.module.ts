import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BacktestResult } from './entities/backtest-result.entity';
import { BacktestService } from './backtest.service';
import { BacktestController } from './backtest.controller';
import { GapScannerModule } from '../gap-scanner/gap-scanner.module';
import { StrategiesModule } from '../strategies/strategies.module';

@Module({
  imports: [TypeOrmModule.forFeature([BacktestResult]), GapScannerModule, StrategiesModule],
  providers: [BacktestService],
  controllers: [BacktestController],
  exports: [BacktestService],
})
export class BacktestModule {}
