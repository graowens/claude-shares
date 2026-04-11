import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class TranscriptsService {
  private readonly logger = new Logger(TranscriptsService.name);
  private readonly transcriptsDir = '/app/transcripts';

  async listFiles(): Promise<{ filename: string; size: number; modified: string }[]> {
    try {
      if (!fs.existsSync(this.transcriptsDir)) {
        this.logger.warn(
          `Transcripts directory not found: ${this.transcriptsDir}`,
        );
        return [];
      }

      const files = fs.readdirSync(this.transcriptsDir);
      return files
        .filter((f) => f.endsWith('.txt'))
        .map((filename) => {
          const filePath = path.join(this.transcriptsDir, filename);
          const stats = fs.statSync(filePath);
          return {
            filename,
            size: stats.size,
            modified: stats.mtime.toISOString(),
          };
        })
        .sort((a, b) => b.modified.localeCompare(a.modified));
    } catch (error) {
      this.logger.error(`Failed to list transcripts: ${error.message}`);
      return [];
    }
  }

  async readFile(filename: string): Promise<{ filename: string; content: string }> {
    const safeName = path.basename(filename);
    const filePath = path.join(this.transcriptsDir, safeName);

    if (!fs.existsSync(filePath)) {
      throw new NotFoundException(`Transcript not found: ${safeName}`);
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    return { filename: safeName, content };
  }
}
