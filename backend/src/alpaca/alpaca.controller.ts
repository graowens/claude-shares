import { Controller, Get } from '@nestjs/common';
import { AlpacaService } from './alpaca.service';

@Controller('account')
export class AlpacaController {
  constructor(private readonly alpacaService: AlpacaService) {}

  @Get()
  async getAccount() {
    return this.alpacaService.getAccount();
  }

  @Get('positions')
  async getPositions() {
    return this.alpacaService.getPositions();
  }
}
