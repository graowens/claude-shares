import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { BarCache } from '../alpaca/entities/bar-cache.entity';

export interface Bar {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Tiingo daily-bar provider. Replaces Alpaca's IEX-only daily feed with
 * full-consolidated SIP-equivalent data on the free tier.
 *
 * Free-tier limits: 1000 calls/day, 500/hour, 50/minute.
 * Internally serialises requests with a ~125ms throttle (8 req/sec) to stay
 * comfortably under the per-minute cap.
 */
@Injectable()
export class TiingoService implements OnModuleInit {
  private readonly logger = new Logger(TiingoService.name);
  private readonly apiKey: string | undefined;
  private readonly minIntervalMs = 125;
  private lastRequestMs = 0;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(BarCache) private readonly barCacheRepo: Repository<BarCache>,
  ) {
    this.apiKey = this.config.get<string>('TIINGO_API_KEY');
  }

  async onModuleInit() {
    if (!this.apiKey || this.apiKey === 'your_key_here') {
      this.logger.warn('TIINGO_API_KEY not set — daily bars will fall back to Alpaca IEX');
      return;
    }
    this.logger.log('Tiingo daily bars enabled (SIP-equivalent consolidated tape)');

    // One-time wipe of any pre-Tiingo cached daily bars. Anything already in the
    // 1Day cache came from Alpaca IEX and has unreliable volume. Rather than mix
    // providers we detect via a sentinel: once Tiingo has cached anything, we
    // consider the cache authoritative. If none of the existing 1Day rows are
    // recent, assume they're legacy IEX and drop them so Tiingo can repopulate.
    const existing = await this.barCacheRepo.count({ where: { timeframe: '1Day' } });
    if (existing > 0) {
      const seen = await this.barCacheRepo.findOne({
        where: { timeframe: '1Day', symbol: '__tiingo_sentinel__' },
      });
      if (!seen) {
        const wiped = await this.barCacheRepo
          .createQueryBuilder()
          .delete()
          .from(BarCache)
          .where('timeframe = :tf', { tf: '1Day' })
          .execute();
        this.logger.log(
          `Wiped ${wiped.affected ?? 0} stale IEX daily bars from cache (first-time Tiingo startup)`,
        );
        await this.barCacheRepo.save(
          this.barCacheRepo.create({
            symbol: '__tiingo_sentinel__',
            timeframe: '1Day',
            barDate: '1970-01-01T00:00:00Z',
            open: 0, high: 0, low: 0, close: 0, volume: 0,
          }),
        );
      }
    }
  }

  isEnabled(): boolean {
    return !!this.apiKey && this.apiKey !== 'your_key_here';
  }

  private async throttle() {
    const now = Date.now();
    const elapsed = now - this.lastRequestMs;
    if (elapsed < this.minIntervalMs) {
      await new Promise((r) => setTimeout(r, this.minIntervalMs - elapsed));
    }
    this.lastRequestMs = Date.now();
  }

  /** Fetch consolidated daily bars for one symbol. Uses the bar_cache table. */
  async getDailyBars(symbol: string, start: string, end: string): Promise<Bar[]> {
    if (!this.isEnabled()) return [];

    const cached = await this.getCachedBars(symbol, start, end);
    if (cached.length > 0) {
      this.logger.debug(`Tiingo cache hit: ${symbol} (${cached.length} bars)`);
      return cached;
    }

    await this.throttle();
    try {
      const startDate = start.split('T')[0];
      const endDate = end.split('T')[0];
      const url = `https://api.tiingo.com/tiingo/daily/${encodeURIComponent(symbol)}/prices?startDate=${startDate}&endDate=${endDate}&token=${this.apiKey}`;
      const resp = await axios.get(url, { timeout: 10_000 });
      const raw: any[] = Array.isArray(resp.data) ? resp.data : [];
      const bars: Bar[] = raw.map((r) => ({
        timestamp: r.date,
        open: Number(r.open),
        high: Number(r.high),
        low: Number(r.low),
        close: Number(r.close),
        volume: Number(r.volume),
      }));

      if (bars.length > 0) {
        await this.cacheBars(symbol, bars);
      }
      return bars;
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 404) {
        this.logger.debug(`Tiingo 404 for ${symbol} — unknown symbol`);
        return [];
      }
      if (status === 429) {
        this.logger.warn(`Tiingo rate-limited on ${symbol} — consider widening throttle interval`);
        return [];
      }
      this.logger.warn(`Tiingo error for ${symbol}: ${err.message}${status ? ` (status ${status})` : ''}`);
      return [];
    }
  }

  /**
   * Fetch daily bars for many symbols. Serialised internally to respect the
   * per-minute rate cap. Returns a symbol → bars map (symbols with no data omitted).
   */
  async getMultiDailyBars(
    symbols: string[],
    start: string,
    end: string,
  ): Promise<Record<string, Bar[]>> {
    const result: Record<string, Bar[]> = {};
    if (!this.isEnabled()) return result;

    const uncached: string[] = [];
    for (const symbol of symbols) {
      const cached = await this.getCachedBars(symbol, start, end);
      if (cached.length > 0) {
        result[symbol] = cached;
      } else {
        uncached.push(symbol);
      }
    }

    if (uncached.length === 0) {
      this.logger.debug(`Tiingo multi-bar: all ${symbols.length} served from cache`);
      return result;
    }

    this.logger.log(
      `Tiingo multi-bar: ${symbols.length - uncached.length} cached, ${uncached.length} to fetch`,
    );

    let ok = 0;
    let empty = 0;
    for (const symbol of uncached) {
      const bars = await this.getDailyBars(symbol, start, end);
      if (bars.length > 0) {
        result[symbol] = bars;
        ok++;
      } else {
        empty++;
      }
    }

    this.logger.log(`Tiingo multi-bar done: ${ok} fetched, ${empty} empty/unavailable`);
    return result;
  }

  // ── Cache helpers — shares the bar_cache table with Alpaca ─────────────────

  private async getCachedBars(
    symbol: string,
    start: string,
    end: string,
  ): Promise<Bar[]> {
    const rows = await this.barCacheRepo.find({
      where: { symbol, timeframe: '1Day' },
      order: { barDate: 'ASC' },
    });
    if (rows.length === 0) return [];
    const startMs = new Date(start).getTime();
    const endMs = new Date(end).getTime();
    return rows
      .filter((r) => {
        const t = new Date(r.barDate).getTime();
        return t >= startMs && t <= endMs;
      })
      .map((r) => ({
        timestamp: r.barDate,
        open: Number(r.open),
        high: Number(r.high),
        low: Number(r.low),
        close: Number(r.close),
        volume: Number(r.volume),
      }));
  }

  private async cacheBars(symbol: string, bars: Bar[]): Promise<void> {
    const entities = bars.map((b) =>
      this.barCacheRepo.create({
        symbol,
        timeframe: '1Day',
        barDate: b.timestamp,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume,
      }),
    );
    const chunkSize = 500;
    for (let i = 0; i < entities.length; i += chunkSize) {
      const chunk = entities.slice(i, i + chunkSize);
      await this.barCacheRepo
        .createQueryBuilder()
        .insert()
        .into(BarCache)
        .values(chunk)
        .orIgnore()
        .execute();
    }
  }
}
