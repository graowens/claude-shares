import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Alpaca from '@alpacahq/alpaca-trade-api';

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
}
