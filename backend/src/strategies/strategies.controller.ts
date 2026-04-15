import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Body,
  ParseIntPipe,
} from '@nestjs/common';
import { StrategiesService } from './strategies.service';
import { CreateStrategyDto } from './dto/create-strategy.dto';
import { UpdateStrategyDto } from './dto/update-strategy.dto';

@Controller('strategies')
export class StrategiesController {
  constructor(private readonly strategiesService: StrategiesService) {}

  @Get()
  findAll() {
    return this.strategiesService.findAll();
  }

  @Get('enabled')
  findEnabled() {
    return this.strategiesService.findEnabled();
  }

  @Get('by-author')
  findByAuthor() {
    return this.strategiesService.findByAuthor();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.strategiesService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateStrategyDto) {
    return this.strategiesService.create(dto);
  }

  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateStrategyDto,
  ) {
    return this.strategiesService.update(id, dto);
  }

  @Patch('bulk-enabled')
  bulkSetEnabled(@Body('enabled') enabled: boolean) {
    return this.strategiesService.bulkSetEnabled(enabled);
  }

  @Patch('bulk-backtest')
  bulkSetBacktest(@Body('backtestEnabled') backtestEnabled: boolean) {
    return this.strategiesService.bulkSetBacktest(backtestEnabled);
  }

  @Patch(':id/toggle')
  toggle(@Param('id', ParseIntPipe) id: number) {
    return this.strategiesService.toggle(id);
  }

  @Patch(':id/toggle-backtest')
  toggleBacktest(@Param('id', ParseIntPipe) id: number) {
    return this.strategiesService.toggleBacktest(id);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.strategiesService.remove(id);
  }
}
