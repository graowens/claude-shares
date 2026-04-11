import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('backtest_results')
export class BacktestResult {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 10 })
  symbol: string;

  @Column({ length: 50 })
  strategy: string;

  @Column({ type: 'date' })
  startDate: string;

  @Column({ type: 'date' })
  endDate: string;

  @Column({ type: 'int', default: 0 })
  totalTrades: number;

  @Column({ type: 'decimal', precision: 8, scale: 4, default: 0 })
  winRate: number;

  @Column({ type: 'decimal', precision: 12, scale: 4, default: 0 })
  totalPnl: number;

  @Column({ type: 'decimal', precision: 12, scale: 4, default: 0 })
  maxDrawdown: number;

  @Column({ type: 'json', nullable: true })
  params: Record<string, any>;

  @CreateDateColumn()
  createdAt: Date;
}
