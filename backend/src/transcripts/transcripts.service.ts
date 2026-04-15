import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { Transcript } from './entities/transcript.entity';
import { Strategy } from '../strategies/entities/strategy.entity';
import { CreateTranscriptDto } from './dto/create-transcript.dto';
import { UpdateTranscriptDto } from './dto/update-transcript.dto';
import { TranscriptAnalyzerService } from './transcript-analyzer.service';

@Injectable()
export class TranscriptsService implements OnModuleInit {
  private readonly logger = new Logger(TranscriptsService.name);

  constructor(
    @InjectRepository(Transcript)
    private readonly repo: Repository<Transcript>,
    @InjectRepository(Strategy)
    private readonly strategyRepo: Repository<Strategy>,
    private readonly analyzer: TranscriptAnalyzerService,
  ) {}

  async onModuleInit() {
    await this.seedFromFiles();
  }

  async findAll(): Promise<Omit<Transcript, 'content'>[]> {
    return this.repo.find({
      select: ['id', 'author', 'name', 'createdAt'],
      order: { author: 'ASC', createdAt: 'ASC' },
    });
  }

  async findOne(id: number): Promise<Transcript> {
    const transcript = await this.repo.findOneBy({ id });
    if (!transcript) throw new NotFoundException(`Transcript #${id} not found`);
    return transcript;
  }

  async findByAuthor(): Promise<Record<string, Omit<Transcript, 'content'>[]>> {
    const all = await this.findAll();
    const grouped: Record<string, Omit<Transcript, 'content'>[]> = {};
    for (const t of all) {
      const key = t.author || 'Unknown';
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(t);
    }
    return grouped;
  }

  async create(dto: CreateTranscriptDto): Promise<Transcript & { generatedStrategies?: number }> {
    const entity = this.repo.create(dto);
    const saved = await this.repo.save(entity);

    // Analyze transcript and auto-create strategies
    const extracted = await this.analyzer.analyzeTranscript(dto.author, dto.content);
    if (extracted.length > 0) {
      const existingStrategies = await this.strategyRepo.find({
        where: { author: dto.author },
      });
      const nextNum = existingStrategies.length + 1;

      for (let i = 0; i < extracted.length; i++) {
        const strat = extracted[i];
        const stratName = `Strat ${nextNum + i} - ${strat.name}`;

        // Check for duplicate name
        const exists = await this.strategyRepo.findOneBy({ name: stratName });
        if (!exists) {
          await this.strategyRepo.save(
            this.strategyRepo.create({
              name: stratName,
              author: dto.author,
              description: strat.description,
              source: saved.name,
              params: {
                stopLossPercent: strat.stopLossPercent,
                takeProfitPercent: strat.takeProfitPercent,
              },
              enabled: true,
            }),
          );
          this.logger.log(`Created strategy "${stratName}" for ${dto.author}`);
        }
      }

      (saved as any).generatedStrategies = extracted.length;
    }

    return saved;
  }

  async update(id: number, dto: UpdateTranscriptDto): Promise<Transcript> {
    const existing = await this.findOne(id);
    Object.assign(existing, dto);
    return this.repo.save(existing);
  }

  async remove(id: number): Promise<void> {
    const existing = await this.findOne(id);
    await this.repo.remove(existing);
  }

  private async seedFromFiles() {
    const count = await this.repo.count();
    if (count > 0) return; // already seeded

    // Try both container path and local dev path
    const dirs = ['/app/transcripts', path.resolve(__dirname, '../../../transcripts')];
    let dir: string | null = null;
    for (const d of dirs) {
      if (fs.existsSync(d)) { dir = d; break; }
    }
    if (!dir) {
      this.logger.warn('No transcripts directory found for seeding');
      return;
    }

    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.txt'));
    for (const filename of files) {
      const content = fs.readFileSync(path.join(dir, filename), 'utf-8');
      const lowerName = filename.toLowerCase();
      const author = lowerName.includes('emmanuel') || lowerName.includes('emanuel')
        ? 'Emanuel'
        : 'Fabio';
      const name = filename.replace('.txt', '');
      await this.repo.save(this.repo.create({ author, name, content }));
      this.logger.log(`Seeded transcript: ${name} (${author})`);
    }
  }
}
