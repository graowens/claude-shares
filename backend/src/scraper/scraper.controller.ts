import { Controller, Get, Post, Query } from '@nestjs/common';
import { ScraperService } from './scraper.service';

@Controller('scraper')
export class ScraperController {
  constructor(private readonly scraperService: ScraperService) {}

  @Post('run')
  run() {
    return this.scraperService.scrape();
  }

  @Get('results')
  getResults(@Query('limit') limit?: string, @Query('symbol') symbol?: string) {
    if (symbol) {
      return this.scraperService.getBySymbol(symbol);
    }
    return this.scraperService.getResults(limit ? parseInt(limit, 10) : 100);
  }
}
