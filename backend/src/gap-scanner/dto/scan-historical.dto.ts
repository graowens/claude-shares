import { IsString, IsOptional, IsArray } from 'class-validator';

export class ScanHistoricalDto {
  @IsString()
  date: string;

  @IsOptional()
  @IsArray()
  symbols?: string[];
}
