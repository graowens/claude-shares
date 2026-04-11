import { Module, Global } from '@nestjs/common';
import { AlpacaService } from './alpaca.service';
import { AlpacaController } from './alpaca.controller';

@Global()
@Module({
  providers: [AlpacaService],
  controllers: [AlpacaController],
  exports: [AlpacaService],
})
export class AlpacaModule {}
