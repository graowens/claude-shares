import { IsString, IsOptional, IsNumber } from 'class-validator';

export class RunFromGapsDto {
  @IsString()
  scanDate: string;

  @IsOptional()
  @IsNumber()
  stopLossPercent?: number;

  @IsOptional()
  @IsNumber()
  takeProfitPercent?: number;

  @IsOptional()
  @IsNumber()
  startingCapital?: number;
}
