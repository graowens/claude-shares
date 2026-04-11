import { Controller, Get, Post, Body, Query, Param, Put } from '@nestjs/common';
import { TradesService } from './trades.service';
import { CreateTradeDto } from './dto/create-trade.dto';

@Controller('trades')
export class TradesController {
  constructor(private readonly tradesService: TradesService) {}

  @Get()
  findAll(@Query('status') status?: string) {
    return this.tradesService.findAll(status);
  }

  @Post()
  create(@Body() dto: CreateTradeDto) {
    return this.tradesService.createManualTrade(dto);
  }

  @Get('pnl')
  getPnl() {
    return this.tradesService.getPnlSummary();
  }

  @Put(':id/close')
  closeTrade(
    @Param('id') id: number,
    @Body('exitPrice') exitPrice: number,
  ) {
    return this.tradesService.closeTrade(id, exitPrice);
  }
}
