import { IsString, IsNumber, IsIn, IsOptional } from 'class-validator';

export class CreateTradeDto {
  @IsString()
  symbol: string;

  @IsIn(['buy', 'sell'])
  side: 'buy' | 'sell';

  @IsNumber()
  quantity: number;

  @IsOptional()
  @IsString()
  strategy?: string;

  @IsOptional()
  @IsNumber()
  limitPrice?: number;

  @IsOptional()
  @IsNumber()
  stopPrice?: number;
}
