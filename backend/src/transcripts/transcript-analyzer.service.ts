import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';

export interface ExtractedStrategy {
  name: string;
  description: string;
  stopLossPercent: number;
  takeProfitPercent: number;
}

@Injectable()
export class TranscriptAnalyzerService {
  private readonly logger = new Logger(TranscriptAnalyzerService.name);
  private client: Anthropic | null = null;

  constructor(private config: ConfigService) {
    const apiKey = this.config.get('ANTHROPIC_API_KEY');
    if (apiKey && apiKey !== 'your_key_here') {
      this.client = new Anthropic({ apiKey });
      this.logger.log('Anthropic client initialised');
    } else {
      this.logger.warn('ANTHROPIC_API_KEY not set — transcript analysis disabled');
    }
  }

  async analyzeTranscript(
    author: string,
    transcriptContent: string,
  ): Promise<ExtractedStrategy[]> {
    if (!this.client) {
      this.logger.warn('Skipping transcript analysis — no API key');
      return [];
    }

    const prompt = `You are a trading strategy analyst. Analyze the following trading transcript and extract distinct trading strategies from it.

For each strategy you identify, provide:
1. A short descriptive name
2. A detailed description of the rules (entry criteria, exit criteria, risk management, indicators used, timeframe, etc.)
3. A recommended stop loss percentage (tight number, typically 0.3-3%)
4. A recommended take profit percentage (typically 1-5%)

Respond ONLY with valid JSON — an array of objects with these exact fields:
- "name": string (short name for the strategy)
- "description": string (detailed rules as a paragraph)
- "stopLossPercent": number
- "takeProfitPercent": number

If you cannot identify any clear strategies, return an empty array [].

TRANSCRIPT:
${transcriptContent.slice(0, 50000)}`;

    try {
      this.logger.log(`Analyzing transcript for ${author}...`);

      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      });

      const text =
        response.content[0].type === 'text' ? response.content[0].text : '';

      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        this.logger.warn('No JSON array found in Claude response');
        return [];
      }

      const strategies: ExtractedStrategy[] = JSON.parse(jsonMatch[0]);
      this.logger.log(
        `Extracted ${strategies.length} strategies for ${author}`,
      );

      return strategies;
    } catch (err) {
      this.logger.error(`Transcript analysis failed: ${err.message}`);
      return [];
    }
  }
}
