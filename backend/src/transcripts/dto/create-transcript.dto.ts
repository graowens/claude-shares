import { IsString } from 'class-validator';

export class CreateTranscriptDto {
  @IsString()
  author: string;

  @IsString()
  name: string;

  @IsString()
  content: string;
}
