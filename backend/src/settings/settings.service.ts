import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Setting } from './entities/setting.entity';

interface DefaultSetting {
  key: string;
  value: string;
  type: 'number' | 'string' | 'boolean';
  description: string;
}

const DEFAULT_SETTINGS: DefaultSetting[] = [
  {
    key: 'maxPositionSize',
    value: '10000',
    type: 'number',
    description: 'Maximum position size in USD',
  },
  {
    key: 'stopLossPercent',
    value: '1',
    type: 'number',
    description: 'Default stop loss percentage',
  },
  {
    key: 'takeProfitPercent',
    value: '2',
    type: 'number',
    description: 'Default take profit percentage',
  },
  {
    key: 'maxDailyLoss',
    value: '500',
    type: 'number',
    description: 'Maximum daily loss in USD before halting trading',
  },
  {
    key: 'currency',
    value: 'USD',
    type: 'string',
    description: 'Display currency (GBP or USD)',
  },
  {
    key: 'maxConcurrentTrades',
    value: '3',
    type: 'number',
    description: 'Maximum number of concurrent open trades',
  },
  {
    key: 'gapThresholdPercent',
    value: '1.5',
    type: 'number',
    description: 'Minimum gap percentage to trigger entry',
  },
  {
    key: 'tradingEnabled',
    value: 'true',
    type: 'boolean',
    description: 'Enable or disable automated trading',
  },
  {
    key: 'dailyBudget',
    value: '100',
    type: 'number',
    description: 'Total amount to risk per day (in display currency)',
  },
  {
    key: 'dailyLossLimit',
    value: '20',
    type: 'number',
    description: 'Stop trading if daily loss exceeds this amount',
  },
  {
    key: 'dailyProfitTarget',
    value: '180',
    type: 'number',
    description: 'Stop trading if daily profit exceeds this amount',
  },
  {
    key: 'allowShortSelling',
    value: 'true',
    type: 'boolean',
    description: 'Allow short selling (requires margin account)',
  },
  {
    key: 'exchanges',
    value: 'NASDAQ,NYSE',
    type: 'string',
    description: 'Comma-separated list of exchanges to scan (NASDAQ,NYSE,ARCA,BATS,OTC,AMEX,CRYPTO)',
  },
];

@Injectable()
export class SettingsService implements OnModuleInit {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    @InjectRepository(Setting)
    private readonly repo: Repository<Setting>,
  ) {}

  async onModuleInit() {
    await this.seedDefaults();
  }

  private async seedDefaults() {
    for (const def of DEFAULT_SETTINGS) {
      const existing = await this.repo.findOneBy({ key: def.key });
      if (!existing) {
        await this.repo.save(this.repo.create(def));
        this.logger.log(`Seeded setting: ${def.key} = ${def.value}`);
      }
    }
  }

  async findAll(): Promise<Setting[]> {
    return this.repo.find({ order: { key: 'ASC' } });
  }

  async findByKey(key: string): Promise<Setting | null> {
    return this.repo.findOneBy({ key });
  }

  async getNumber(key: string, defaultValue: number): Promise<number> {
    const setting = await this.findByKey(key);
    return setting ? parseFloat(setting.value) : defaultValue;
  }

  async getString(key: string, defaultValue: string): Promise<string> {
    const setting = await this.findByKey(key);
    return setting ? setting.value : defaultValue;
  }

  async getBoolean(key: string, defaultValue: boolean): Promise<boolean> {
    const setting = await this.findByKey(key);
    return setting ? setting.value === 'true' : defaultValue;
  }

  async update(
    updates: Record<string, string>,
  ): Promise<Setting[]> {
    for (const [key, value] of Object.entries(updates)) {
      const setting = await this.repo.findOneBy({ key });
      if (setting) {
        setting.value = String(value);
        await this.repo.save(setting);
      }
    }
    return this.findAll();
  }
}
