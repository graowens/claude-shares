import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { TiingoModule } from './tiingo/tiingo.module';
import { AlpacaModule } from './alpaca/alpaca.module';
import { TradesModule } from './trades/trades.module';
import { WatchlistModule } from './watchlist/watchlist.module';
import { SettingsModule } from './settings/settings.module';
import { ScraperModule } from './scraper/scraper.module';
import { BacktestModule } from './backtest/backtest.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { TranscriptsModule } from './transcripts/transcripts.module';
import { StrategiesModule } from './strategies/strategies.module';
import { GapScannerModule } from './gap-scanner/gap-scanner.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'mysql',
        host: config.get('MYSQL_HOST', 'localhost'),
        port: parseInt(config.get('MYSQL_PORT', '3306'), 10),
        username: config.get('MYSQL_USER', 'root'),
        password: config.get('MYSQL_PASSWORD', ''),
        database: config.get('MYSQL_DATABASE', 'shares'),
        autoLoadEntities: true,
        synchronize: true,
      }),
    }),
    ScheduleModule.forRoot(),
    TiingoModule,
    AlpacaModule,
    TradesModule,
    WatchlistModule,
    SettingsModule,
    ScraperModule,
    BacktestModule,
    SchedulerModule,
    TranscriptsModule,
    StrategiesModule,
    GapScannerModule,
  ],
})
export class AppModule {}
