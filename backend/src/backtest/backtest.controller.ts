import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { BacktestService } from './backtest.service';
import { RunBacktestDto } from './dto/run-backtest.dto';

@Controller('backtest')
export class BacktestController {
  constructor(private readonly backtestService: BacktestService) {}

  @Post('run')
  run(@Body() dto: RunBacktestDto) {
    return this.backtestService.runBacktest(dto);
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
