import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

interface AlpacaAsset {
  id: string;
  symbol: string;
  name: string;
  exchange: string;
  class: string;
  status: string;
  tradable: boolean;
  shortable: boolean;
  fractionable: boolean;
}

@Injectable()
export class AssetCacheService implements OnModuleInit {
  private readonly logger = new Logger(AssetCacheService.name);
  private assets: AlpacaAsset[] = [];
  private byExchange: Map<string, AlpacaAsset[]> = new Map();
  private bySymbol: Map<string, AlpacaAsset> = new Map();

  constructor(private config: ConfigService) {}

  async onModuleInit() {
    await this.refreshCache();
  }

  // Refresh daily at 13:00 UK (1 hour before pre-market scanning)
  @Cron('0 0 13 * * 1-5', { timeZone: 'Europe/London' })
  async refreshCache() {
    try {
      const resp = await axios.get(
        'https://paper-api.alpaca.markets/v2/assets?status=active',
        {
          headers: {
            'APCA-API-KEY-ID': this.config.get('ALPACA_API_KEY'),
            'APCA-API-SECRET-KEY': this.config.get('ALPACA_API_SECRET'),
          },
        },
      );
      this.assets = resp.data.filter((a: any) => a.tradable);
      this.byExchange.clear();
      this.bySymbol.clear();
      for (const asset of this.assets) {
        this.bySymbol.set(asset.symbol, asset);
        const list = this.byExchange.get(asset.exchange) || [];
        list.push(asset);
        this.byExchange.set(asset.exchange, list);
      }
      this.logger.log(`Cached ${this.assets.length} tradable assets across ${this.byExchange.size} exchanges`);
    } catch (err) {
      this.logger.error(`Failed to refresh asset cache: ${err.message}`);
    }
  }

  getExchanges(): string[] {
    return Array.from(this.byExchange.keys()).sort();
  }

  getExchangeCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const [ex, assets] of this.byExchange) {
      counts[ex] = assets.length;
    }
    return counts;
  }

  getSymbolsByExchanges(exchanges: string[]): string[] {
    const symbols: string[] = [];
    for (const ex of exchanges) {
      const assets = this.byExchange.get(ex) || [];
      for (const a of assets) {
        symbols.push(a.symbol);
      }
    }
    return symbols;
  }

  getAsset(symbol: string): AlpacaAsset | undefined {
    return this.bySymbol.get(symbol);
  }

  getExchangeForSymbol(symbol: string): string | null {
    return this.bySymbol.get(symbol)?.exchange || null;
  }

  isShortable(symbol: string): boolean {
    return this.bySymbol.get(symbol)?.shortable ?? false;
  }
}
