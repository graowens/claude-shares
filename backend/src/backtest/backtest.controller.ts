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

  @Post('optimise-claude')
  optimiseClaude(@Body() body?: { startingCapital?: number }) {
    return this.backtestService.optimiseClaude(body?.startingCapital || 10000);
  }

  @Post('emanuel-picks')
  emanuelPicks(@Body() body: { endDate: string; startingCapital?: number; lookbackDays?: number; longOnly?: boolean }) {
    return this.backtestService.emanuelTopPicks(
      body.endDate,
      body.startingCapital || 1000,
      body.lookbackDays || 10,
      body.longOnly ?? false,
    );
  }

  @Post('claude-picks')
  claudePicks(@Body() body: { endDate: string; startingCapital?: number; lookbackDays?: number; longOnly?: boolean }) {
    return this.backtestService.claudeTopPicks(
      body.endDate,
      body.startingCapital || 1000,
      body.lookbackDays || 10,
      body.longOnly ?? false,
    );
  }

  @Post('prorealalgos-picks')
  proRealAlgosPicks(@Body() body: { endDate: string; startingCapital?: number; lookbackDays?: number; symbols?: string[]; longOnly?: boolean }) {
    return this.backtestService.proRealAlgosTopPicks(
      body.endDate,
      body.startingCapital || 1000,
      body.lookbackDays || 10,
      body.symbols,
      body.longOnly ?? false,
    );
  }

  @Post('dumb-hunter-picks')
  dumbHunterPicks(@Body() body: { endDate: string; startingCapital?: number; lookbackDays?: number; longOnly?: boolean }) {
    return this.backtestService.dumbHunterTopPicks(
      body.endDate,
      body.startingCapital || 1000,
      body.lookbackDays || 10,
      body.longOnly ?? false,
    );
  }

  @Post('weekly-comparison')
  weeklyComparison(@Body() body: { endDate: string; dailyBudget?: number; weeks?: number }) {
    return this.backtestService.weeklyComparison(
      body.endDate,
      body.dailyBudget || 1000,
      body.weeks || 10,
    );
  }

  @Post('dumb-hunter-swing')
  dumbHunterSwing(@Body() body: {
    endDate: string;
    startingCapital?: number;
    lookbackWeeks?: number;
    symbols?: string[];
  }) {
    return this.backtestService.dumbHunterSwingBacktest(
      body.endDate,
      body.startingCapital || 10000,
      body.lookbackWeeks || 20,
      body.symbols,
    );
  }

  @Post('claude-hybrid')
  claudeHybrid(@Body() body: {
    endDate: string;
    startingCapital?: number;
    lookbackWeeks?: number;
    swingSymbols?: string[];
    maxConcurrentSwing?: number;
    maxIntradayPerDay?: number;
  }) {
    return this.backtestService.claudeHybridBacktest(
      body.endDate,
      body.startingCapital || 10000,
      body.lookbackWeeks || 20,
      body.swingSymbols,
      body.maxConcurrentSwing || 5,
      body.maxIntradayPerDay || 2,
    );
  }

  @Post('backfill')
  backfill(@Body() body: { startDate: string; endDate: string }) {
    // Fire and forget — returns immediately, runs in background
    this.backtestService.runBackfill(body.startDate, body.endDate);
    return { message: 'Backfill started', startDate: body.startDate, endDate: body.endDate };
  }

  @Get('backfill/progress')
  backfillProgress() {
    return this.backtestService.getBackfillProgress();
  }
}
