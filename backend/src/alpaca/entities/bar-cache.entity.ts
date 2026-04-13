import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

@Entity('bar_cache')
@Index(['symbol', 'timeframe', 'barDate'], { unique: true })
export class BarCache {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 10 })
  symbol: string;

  @Column({ length: 10 })
  timeframe: string; // '1Day', '5Min', etc.

  @Column({ type: 'varchar', length: 30 })
  barDate: string; // ISO timestamp of the bar

  @Column({ type: 'decimal', precision: 14, scale: 4 })
  open: number;

  @Column({ type: 'decimal', precision: 14, scale: 4 })
  high: number;

  @Column({ type: 'decimal', precision: 14, scale: 4 })
  low: number;

  @Column({ type: 'decimal', precision: 14, scale: 4 })
  close: number;

  @Column({ type: 'bigint', default: 0 })
  volume: number;
}
