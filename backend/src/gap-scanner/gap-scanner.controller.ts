import { Controller, Post, Get, Patch, Param, Query, Body } from '@nestjs/common';
import { GapScannerService } from './gap-scanner.service';
import { ScanHistoricalDto } from './dto/scan-historical.dto';

@Controller('gap-scanner')
export class GapScannerController {
  constructor(private readonly gapScannerService: GapScannerService) {}

  @Post('scan')
  scan() {
    return this.gapScannerService.scanGaps();
  }

  @Post('scan/historical')
  scanHistorical(@Body() dto: ScanHistoricalDto) {
    return this.gapScannerService.scanHistoricalGaps(dto.date, dto.symbols);
  }

  @Post('clear-selected')
  clearSelected(@Body() body?: { date?: string }) {
    return this.gapScannerService.clearSelected(body?.date);
  }

  @Get('results')
  getResults(@Query('date') date?: string) {
    return this.gapScannerService.getResults(date);
  }

  @Patch(':id/select')
  selectStock(@Param('id') id: number) {
    return this.gapScannerService.selectStock(id);
  }

  @Get('selected')
  getSelected(@Query('date') date?: string) {
    return this.gapScannerService.getSelected(date);
  }

  @Post('confirm')
  confirm() {
    return this.gapScannerService.addSelectedToWatchlist();
  }
}
