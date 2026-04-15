import { Controller, Get, Post, Put, Delete, Param, Body, ParseIntPipe } from '@nestjs/common';
import { TranscriptsService } from './transcripts.service';
import { CreateTranscriptDto } from './dto/create-transcript.dto';
import { UpdateTranscriptDto } from './dto/update-transcript.dto';

@Controller('transcripts')
export class TranscriptsController {
  constructor(private readonly transcriptsService: TranscriptsService) {}

  @Get()
  findAll() {
    return this.transcriptsService.findAll();
  }

  @Get('by-author')
  findByAuthor() {
    return this.transcriptsService.findByAuthor();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.transcriptsService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateTranscriptDto) {
    return this.transcriptsService.create(dto);
  }

  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTranscriptDto) {
    return this.transcriptsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.transcriptsService.remove(id);
  }
}
