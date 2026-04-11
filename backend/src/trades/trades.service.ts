import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, MoreThanOrEqual } from 'typeorm';
import { Trade } from './entities/trade.entity';
import { CreateTradeDto } from './dto/create-trade.dto';
import { AlpacaService } from '../alpaca/alpaca.service';

@Injectable()
export class TradesService {
  private readonly logger = new Logger(TradesService.name);

  constructor(
    @InjectRepository(Trade)
    private readonly tradeRepo: Repository<Trade>,
    private readonly alpaca: AlpacaService,
  ) {}

  async findAll(status?: string): Promise<Trade[]> {
    const where: any = {};
    if (status) where.status = status;
    return this.tradeRepo.find({ where, order: { createdAt: 'DESC' } });
  }

  async findOne(id: number): Promise<Trade> {
    return this.tradeRepo.findOneBy({ id });
  }

  async createManualTrade(dto: CreateTradeDto): Promise<Trade> {
    try {
      const order = await this.alpaca.submitOrder({
        symbol: dto.symbol,
        qty: dto.quantity,
        side: dto.side,
        type: dto.limitPrice ? 'limit' : 'market',
        time_in_force: 'day',
        limit_price: dto.limitPrice,
        stop_price: dto.stopPrice,
      });

      const trade = this.tradeRepo.create({
        symbol: dto.symbol,
        side: dto.side,
        quantity: dto.quantity,
        entryPrice: parseFloat(order.filled_avg_price) || null,
        status: 'open',
        strategy: dto.strategy || 'manual',
        openedAt: new Date(),
      });

      return this.tradeRepo.save(trade);
    } catch (error) {
      this.logger.error(`Failed to submit order: ${error.message}`);
      throw error;
    }
  }

  async createTradeRecord(data: Partial<Trade>): Promise<Trade> {
    const trade = this.tradeRepo.create(data);
    return this.tradeRepo.save(trade);
  }

  async closeTrade(id: number, exitPrice: number): Promise<Trade> {
    const trade = await this.tradeRepo.findOneBy({ id });
    if (!trade) throw new Error('Trade not found');

    trade.exitPrice = exitPrice;
    trade.status = 'closed';
    trade.closedAt = new Date();

    if (trade.entryPrice) {
      const multiplier = trade.side === 'buy' ? 1 : -1;
      trade.pnl =
        (exitPrice - trade.entryPrice) * trade.quantity * multiplier;
    }

    return this.tradeRepo.save(trade);
  }

  async getPnlSummary() {
    const now = new Date();

    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    weekStart.setHours(0, 0, 0, 0);

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [todayPnl, weekPnl, monthPnl, allTimePnl, openTrades] =
      await Promise.all([
        this.sumPnl(todayStart, now),
        this.sumPnl(weekStart, now),
        this.sumPnl(monthStart, now),
        this.sumPnlAll(),
        this.tradeRepo.count({ where: { status: 'open' } }),
      ]);

    return {
      today: todayPnl,
      week: weekPnl,
      month: monthPnl,
      allTime: allTimePnl,
      openTrades,
    };
  }

  private async sumPnl(start: Date, end: Date): Promise<number> {
    const result = await this.tradeRepo
      .createQueryBuilder('trade')
      .select('SUM(trade.pnl)', 'total')
      .where('trade.status = :status', { status: 'closed' })
      .andWhere('trade.closedAt BETWEEN :start AND :end', { start, end })
      .getRawOne();
    return parseFloat(result?.total) || 0;
  }

  private async sumPnlAll(): Promise<number> {
    const result = await this.tradeRepo
      .createQueryBuilder('trade')
      .select('SUM(trade.pnl)', 'total')
      .where('trade.status = :status', { status: 'closed' })
      .getRawOne();
    return parseFloat(result?.total) || 0;
  }
}
