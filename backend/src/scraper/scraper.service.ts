import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { CapitolTrade } from './entities/capitol-trade.entity';

@Injectable()
export class ScraperService {
  private readonly logger = new Logger(ScraperService.name);
  private readonly baseUrl = 'https://www.capitoltrades.com/trades';

  constructor(
    @InjectRepository(CapitolTrade)
    private readonly repo: Repository<CapitolTrade>,
  ) {}

  async scrape(): Promise<{ scraped: number; trades: CapitolTrade[] }> {
    this.logger.log('Starting Capitol Trades scrape...');

    try {
      const response = await axios.get(this.baseUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        timeout: 15000,
      });

      const $ = cheerio.load(response.data);
      const trades: Partial<CapitolTrade>[] = [];
      const now = new Date();

      // Parse the trades table - Capitol Trades uses a table with
      // columns: Politician, Traded, Filed After, Owner, Type, Size, Price
      $('table tbody tr').each((_, row) => {
        try {
          const cells = $(row).find('td');
          if (cells.length < 5) return;

          const politician = $(cells[0]).text().trim();
          const issuerCell = $(cells[1]).text().trim();
          const filedDateText = $(cells[2]).text().trim();
          const typeText = $(cells[4]).text().trim().toLowerCase();
          const sizeText = $(cells[5]).text().trim();

          // Extract ticker symbol from the issuer cell
          // Capitol Trades often shows "AAPL Apple Inc." or similar
          const symbolMatch = issuerCell.match(
            /\b([A-Z]{1,5})\b/,
          );
          const symbol = symbolMatch ? symbolMatch[1] : '';

          if (!symbol || !politician) return;

          // Determine trade type
          let tradeType: 'buy' | 'sell' = 'buy';
          if (
            typeText.includes('sale') ||
            typeText.includes('sell') ||
            typeText.includes('sold')
          ) {
            tradeType = 'sell';
          }

          // Parse filed date
          let filedDate: string | null = null;
          if (filedDateText) {
            const parsed = new Date(filedDateText);
            if (!isNaN(parsed.getTime())) {
              filedDate = parsed.toISOString().split('T')[0];
            }
          }

          trades.push({
            politician,
            symbol,
            tradeType,
            amount: sizeText || null,
            filedDate,
            scrapedAt: now,
          });
        } catch (err) {
          // skip malformed rows
        }
      });

      // Also try parsing q-table or div-based layouts (Capitol Trades
      // sometimes uses custom elements)
      if (trades.length === 0) {
        $('.trade-row, [class*="trade"], .q-table--row').each(
          (_, el) => {
            try {
              const text = $(el).text();
              const politician =
                $(el).find('[class*="politician"], .name').first().text().trim() ||
                '';
              const symbolEl = $(el).find(
                '[class*="ticker"], [class*="symbol"], .q-field--issuer',
              );
              const symbol =
                symbolEl.text().trim().match(/\b([A-Z]{1,5})\b/)?.[1] || '';
              const typeText =
                $(el).find('[class*="type"], .q-field--txType').text().trim().toLowerCase();

              if (!symbol) return;

              let tradeType: 'buy' | 'sell' = 'buy';
              if (
                typeText.includes('sale') ||
                typeText.includes('sell')
              ) {
                tradeType = 'sell';
              }

              trades.push({
                politician: politician || 'Unknown',
                symbol,
                tradeType,
                amount:
                  $(el)
                    .find('[class*="size"], [class*="amount"]')
                    .text()
                    .trim() || null,
                filedDate: null,
                scrapedAt: now,
              });
            } catch (err) {
              // skip
            }
          },
        );
      }

      // Save to database
      const saved: CapitolTrade[] = [];
      for (const trade of trades) {
        const entity = this.repo.create(trade);
        saved.push(await this.repo.save(entity));
      }

      this.logger.log(`Scraped ${saved.length} trades from Capitol Trades`);
      return { scraped: saved.length, trades: saved };
    } catch (error) {
      this.logger.error(`Scrape failed: ${error.message}`);
      throw error;
    }
  }

  async getResults(limit = 100): Promise<CapitolTrade[]> {
    return this.repo.find({
      order: { scrapedAt: 'DESC' },
      take: limit,
    });
  }

  async getBySymbol(symbol: string): Promise<CapitolTrade[]> {
    return this.repo.find({
      where: { symbol: symbol.toUpperCase() },
      order: { scrapedAt: 'DESC' },
    });
  }
}
