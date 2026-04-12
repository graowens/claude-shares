import { Module, Global } from '@nestjs/common';
import { AlpacaService } from './alpaca.service';
import { AlpacaController } from './alpaca.controller';
import { AssetCacheService } from './asset-cache.service';
import { ExchangesController } from './exchanges.controller';

@Global()
@Module({
  providers: [AlpacaService, AssetCacheService],
  controllers: [AlpacaController, ExchangesController],
  exports: [AlpacaService, AssetCacheService],
})
export class AlpacaModule {}
