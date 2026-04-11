import { IsString, IsOptional, IsNumber, IsDateString } from 'class-validator';

export class RunBacktestDto {
  @IsString()
  symbol: string;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;

  @IsOptional()
  @IsNumber()
  stopLossPercent?: number;

  @IsOptional()
  @IsNumber()
  takeProfitPercent?: number;

  @IsOptional()
  @IsNumber()
  gapThresholdPercent?: number;

  @IsOptional()
  @IsString()
  strategy?: string;
}
