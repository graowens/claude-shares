import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TiingoService } from './tiingo.service';
import { BarCache } from '../alpaca/entities/bar-cache.entity';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([BarCache])],
  providers: [TiingoService],
  exports: [TiingoService],
})
export class TiingoModule {}
