import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { BacktestService } from './backtest.service';
import { RunBacktestDto } from './dto/run-backtest.dto';
import { RunFromGapsDto } from './dto/run-from-gaps.dto';

@Controller('backtest')
export class BacktestController {
  constructor(private readonly backtestService: BacktestService) {}

  @Post('run')
  run(@Body() dto: RunBacktestDto) {
    return this.backtestService.runBacktest(dto);
  }

  @Post('run-from-gaps')
  runFromGaps(@Body() dto: RunFromGapsDto) {
    return this.backtestService.backtestFromGaps(
      dto.scanDate,
      dto.stopLossPercent,
      dto.takeProfitPercent,
      dto.startingCapital,
    );
  }

  @Get('results')
  getResults(@Query('limit') limit?: string) {
    return this.backtestService.getResults(
      limit ? parseInt(limit, 10) : 50,
    );
  }

  @Get('results/:id')
  getResult(@Param('id') id: number) {
    return this.backtestService.getResult(id);
  }
}
