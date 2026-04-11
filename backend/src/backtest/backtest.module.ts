import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BacktestResult } from './entities/backtest-result.entity';
import { BacktestService } from './backtest.service';
import { BacktestController } from './backtest.controller';

@Module({
  imports: [TypeOrmModule.forFeature([BacktestResult])],
  providers: [BacktestService],
  controllers: [BacktestController],
  exports: [BacktestService],
})
export class BacktestModule {}
