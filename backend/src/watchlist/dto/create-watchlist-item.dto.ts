import {
  IsString,
  IsOptional,
  IsIn,
  IsNumber,
  IsBoolean,
  IsArray,
  ValidateNested,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateWatchlistItemDto {
  @IsString()
  symbol: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsIn(['up', 'down'])
  gapDirection?: 'up' | 'down';

  @IsOptional()
  @IsNumber()
  targetEntry?: number;

  @IsOptional()
  @IsNumber()
  stopLoss?: number;

  @IsOptional()
  @IsNumber()
  takeProfit?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsDateString()
  scheduledDate?: string;
}

export class UpdateWatchlistItemDto extends CreateWatchlistItemDto {}

export class BulkAddWatchlistDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateWatchlistItemDto)
  items: CreateWatchlistItemDto[];
}
