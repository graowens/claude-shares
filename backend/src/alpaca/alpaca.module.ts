import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AlpacaService } from './alpaca.service';
import { AlpacaController } from './alpaca.controller';
import { AssetCacheService } from './asset-cache.service';
import { ExchangesController } from './exchanges.controller';
import { BarCache } from './entities/bar-cache.entity';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([BarCache])],
  providers: [AlpacaService, AssetCacheService],
  controllers: [AlpacaController, ExchangesController],
  exports: [AlpacaService, AssetCacheService],
})
export class AlpacaModule {}
