import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import Alpaca from '@alpacahq/alpaca-trade-api';
import axios from 'axios';
import { BarCache } from './entities/bar-cache.entity';
import { TiingoService } from '../tiingo/tiingo.service';

interface Bar {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

@Injectable()
export class AlpacaService implements OnModuleInit {
  private readonly logger = new Logger(AlpacaService.name);
  private client: Alpaca;

  constructor(
    private config: ConfigService,
    @InjectRepository(BarCache)
    private readonly barCacheRepo: Repository<BarCache>,
    private readonly tiingo: TiingoService,
  ) {}

  onModuleInit() {
    const baseUrl = this.config.get(
      'ALPACA_API_ENDPOINT',
      'https://paper-api.alpaca.markets',
    );
    this.client = new Alpaca({
      keyId: this.config.get('ALPACA_API_KEY', ''),
      secretKey: this.config.get('ALPACA_API_SECRET', ''),
      paper: true,
      baseUrl,
    });
    this.logger.log(`Alpaca client initialised (endpoint: ${baseUrl})`);
  }

  async getAccount() {
    return this.client.getAccount();
  }

  async getPositions() {
    return this.client.getPositions();
  }

  async submitOrder(params: {
    symbol: string;
    qty: number;
    side: 'buy' | 'sell';
    type?: string;
    time_in_force?: string;
    limit_price?: number;
    stop_price?: number;
  }) {
    return this.client.createOrder({
      symbol: params.symbol,
      qty: params.qty,
      side: params.side,
      type: params.type || 'market',
      time_in_force: params.time_in_force || 'day',
      limit_price: params.limit_price,
      stop_price: params.stop_price,
    });
  }

  async getHistoricalBars(
    symbol: string,
    timeframe: string,
    start: string,
    end: string,
    limit = 1000,
  ): Promise<Bar[]> {
    // Daily bars come from Tiingo (full consolidated tape) when the key is set.
    // Intraday timeframes stay on Alpaca IEX.
    if (timeframe === '1Day' && this.tiingo.isEnabled()) {
      return this.tiingo.getDailyBars(symbol, start, end);
    }

    // Check cache first
    const cached = await this.getCachedBars(symbol, timeframe, start, end);
    if (cached.length > 0) {
      this.logger.debug(`Cache hit: ${symbol} ${timeframe} (${cached.length} bars)`);
      return cached;
    }

    // Fetch from Alpaca with retry on rate limit
    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const bars: Bar[] = [];
        const barsIterator = this.client.getBarsV2(symbol, {
          timeframe,
          start,
          end,
          limit,
          feed: 'iex',
        });

        for await (const bar of barsIterator) {
          bars.push({
            timestamp: bar.Timestamp,
            open: Number(bar.OpenPrice),
            high: Number(bar.HighPrice),
            low: Number(bar.LowPrice),
            close: Number(bar.ClosePrice),
            volume: Number(bar.Volume),
          });
        }

        // Store in cache
        if (bars.length > 0) {
          await this.cacheBars(symbol, timeframe, bars);
        }

        return bars;
      } catch (err) {
        const is429 = err?.message?.includes('429') || err?.statusCode === 429;
        if (is429 && attempt < MAX_RETRIES) {
          const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
          this.logger.debug(`Rate limited on ${symbol} ${timeframe}, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw err;
      }
    }

    return [];
  }

  async getLatestQuote(symbol: string) {
    return this.client.getLatestQuote(symbol);
  }

  async closePosition(symbol: string) {
    return this.client.closePosition(symbol);
  }

  async closeAllPositions() {
    return this.client.closeAllPositions();
  }

  async getOrders(params?: { status?: string; limit?: number }) {
    return this.client.getOrders({
      status: params?.status || 'all',
      limit: params?.limit || 100,
      until: undefined,
      after: undefined,
      direction: undefined,
      nested: undefined,
      symbols: undefined,
    });
  }

  async cancelOrder(orderId: string) {
    return this.client.cancelOrder(orderId);
  }

  /**
   * Fetch daily bars for multiple symbols in one call using Alpaca data API.
   * Returns a map of symbol -> bars array. Uses cache when available.
   */
  async getMultiSymbolBars(
    symbols: string[],
    start: string,
    end: string,
  ): Promise<Record<string, Bar[]>> {
    // Tiingo owns daily bars when enabled — it has its own throttled queue and
    // reads/writes the same bar_cache table.
    if (this.tiingo.isEnabled()) {
      return this.tiingo.getMultiDailyBars(symbols, start, end);
    }

    const result: Record<string, Bar[]> = {};
    const timeframe = '1Day';

    // Check cache for each symbol
    const uncachedSymbols: string[] = [];
    for (const symbol of symbols) {
      const cached = await this.getCachedBars(symbol, timeframe, start, end);
      if (cached.length > 0) {
        result[symbol] = cached;
      } else {
        uncachedSymbols.push(symbol);
      }
    }

    if (uncachedSymbols.length > 0) {
      this.logger.log(`Multi-bar cache: ${symbols.length - uncachedSymbols.length} hit, ${uncachedSymbols.length} miss — fetching from Alpaca`);

      const batchSize = 200;
      for (let i = 0; i < uncachedSymbols.length; i += batchSize) {
        const batch = uncachedSymbols.slice(i, i + batchSize);
        const symbolsParam = batch.join(',');
        try {
          const resp = await axios.get(
            `https://data.alpaca.markets/v2/stocks/bars?symbols=${symbolsParam}&timeframe=1Day&start=${start}&end=${end}&limit=10000&feed=iex`,
            {
              headers: {
                'APCA-API-KEY-ID': this.config.get('ALPACA_API_KEY'),
                'APCA-API-SECRET-KEY': this.config.get('ALPACA_API_SECRET'),
              },
            },
          );
          const data = resp.data.bars || {};
          for (const [sym, bars] of Object.entries(data)) {
            const mapped = (bars as any[]).map((b: any) => ({
              timestamp: b.t,
              open: b.o,
              high: b.h,
              low: b.l,
              close: b.c,
              volume: b.v,
            }));
            result[sym] = mapped;
            // Cache these bars
            await this.cacheBars(sym, timeframe, mapped);
          }
        } catch (err) {
          this.logger.error(`Multi-bar batch ${i}-${i + batchSize} failed: ${err.message}`);
        }
      }
    } else {
      this.logger.debug(`Multi-bar cache: all ${symbols.length} symbols served from cache`);
    }

    return result;
  }

  // ── Bar cache helpers ──────────────────────────────────────

  private async getCachedBars(
    symbol: string,
    timeframe: string,
    start: string,
    end: string,
  ): Promise<Bar[]> {
    const rows = await this.barCacheRepo.find({
      where: { symbol, timeframe },
      order: { barDate: 'ASC' },
    });

    if (rows.length === 0) return [];

    // Normalise to UTC ms for reliable comparison (handles mixed timezone strings)
    const startMs = new Date(start).getTime();
    const endMs = new Date(end).getTime();

    const filtered = rows.filter((r) => {
      const t = new Date(r.barDate).getTime();
      return t >= startMs && t <= endMs;
    });
    if (filtered.length === 0) return [];

    // For intraday bars, check if cache covers the requested window.
    // If we asked for 9:30-16:00 but only have 9:30-10:30 cached, treat as miss
    // so we fetch the full day from Alpaca (which will then cache everything).
    if (timeframe !== '1Day' && filtered.length > 0) {
      const lastCachedMs = new Date(filtered[filtered.length - 1].barDate).getTime();
      const requestedSpanMs = endMs - startMs;
      const cachedSpanMs = lastCachedMs - new Date(filtered[0].barDate).getTime();
      // If cached span covers less than 50% of requested span, it's a partial cache — refetch
      if (requestedSpanMs > 0 && cachedSpanMs < requestedSpanMs * 0.5) {
        return [];
      }
    }

    return filtered.map((r) => ({
      timestamp: r.barDate,
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: Number(r.volume),
    }));
  }

  private async cacheBars(
    symbol: string,
    timeframe: string,
    bars: Bar[],
  ): Promise<void> {
    // Upsert bars in batches
    const entities = bars.map((b) =>
      this.barCacheRepo.create({
        symbol,
        timeframe,
        barDate: b.timestamp,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume,
      }),
    );

    // Use chunks to avoid huge inserts
    const chunkSize = 500;
    for (let i = 0; i < entities.length; i += chunkSize) {
      const chunk = entities.slice(i, i + chunkSize);
      await this.barCacheRepo
        .createQueryBuilder()
        .insert()
        .into(BarCache)
        .values(chunk)
        .orIgnore() // skip duplicates
        .execute();
    }
  }
}
