import {
  IsString,
  IsBoolean,
  IsOptional,
  IsObject,
} from 'class-validator';

export class CreateStrategyDto {
  @IsString()
  name: string;

  @IsString()
  description: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsObject()
  params?: Record<string, any>;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean = false;
}
