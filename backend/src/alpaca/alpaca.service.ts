import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Alpaca from '@alpacahq/alpaca-trade-api';
import axios from 'axios';

@Injectable()
export class AlpacaService implements OnModuleInit {
  private readonly logger = new Logger(AlpacaService.name);
  private client: Alpaca;

  constructor(private config: ConfigService) {}

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
  ) {
    const bars = [];
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
    return bars;
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
   * Returns a map of symbol -> bars array.
   */
  async getMultiSymbolBars(
    symbols: string[],
    start: string,
    end: string,
  ): Promise<Record<string, Array<{ timestamp: string; open: number; high: number; low: number; close: number; volume: number }>>> {
    const result: Record<string, any[]> = {};
    // Alpaca multi-bar endpoint accepts up to ~200 symbols per request
    const batchSize = 200;

    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
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
          result[sym] = (bars as any[]).map((b: any) => ({
            timestamp: b.t,
            open: b.o,
            high: b.h,
            low: b.l,
            close: b.c,
            volume: b.v,
          }));
        }
      } catch (err) {
        this.logger.error(`Multi-bar batch ${i}-${i + batchSize} failed: ${err.message}`);
      }
    }
    return result;
  }
}
