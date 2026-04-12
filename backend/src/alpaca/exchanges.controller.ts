import { Controller, Get } from '@nestjs/common';
import { AssetCacheService } from './asset-cache.service';

@Controller('exchanges')
export class ExchangesController {
  constructor(private readonly assetCache: AssetCacheService) {}

  @Get()
  getExchanges() {
    return {
      exchanges: this.assetCache.getExchanges(),
      counts: this.assetCache.getExchangeCounts(),
    };
  }
}
