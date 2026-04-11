import { Controller, Get, Param } from '@nestjs/common';
import { TranscriptsService } from './transcripts.service';

@Controller('transcripts')
export class TranscriptsController {
  constructor(private readonly transcriptsService: TranscriptsService) {}

  @Get()
  list() {
    return this.transcriptsService.listFiles();
  }

  @Get(':filename')
  read(@Param('filename') filename: string) {
    return this.transcriptsService.readFile(filename);
  }
}
