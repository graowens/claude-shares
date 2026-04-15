import { IsString, IsOptional } from 'class-validator';

export class UpdateTranscriptDto {
  @IsOptional()
  @IsString()
  author?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  content?: string;
}
