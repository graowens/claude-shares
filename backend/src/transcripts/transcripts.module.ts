import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Transcript } from './entities/transcript.entity';
import { Strategy } from '../strategies/entities/strategy.entity';
import { TranscriptsService } from './transcripts.service';
import { TranscriptsController } from './transcripts.controller';
import { TranscriptAnalyzerService } from './transcript-analyzer.service';

@Module({
  imports: [TypeOrmModule.forFeature([Transcript, Strategy])],
  providers: [TranscriptsService, TranscriptAnalyzerService],
  controllers: [TranscriptsController],
  exports: [TranscriptsService],
})
export class TranscriptsModule {}
