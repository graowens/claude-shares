import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('gap_scan_results')
export class GapScanResult {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 10 })
  symbol: string;

  @Column({ type: 'decimal', precision: 12, scale: 4 })
  prevClose: number;

  @Column({ type: 'decimal', precision: 12, scale: 4 })
  currentPrice: number;

  @Column({ type: 'decimal', precision: 8, scale: 2 })
  gapPercent: number;

  @Column({ type: 'bigint', default: 0 })
  preMarketVolume: number;

  @Column({ type: 'decimal', precision: 12, scale: 4, nullable: true })
  ma20: number;

  @Column({ type: 'decimal', precision: 12, scale: 4, nullable: true })
  ma200: number;

  @Column({ length: 20, nullable: true })
  trendDirection: string; // 'uptrend' | 'downtrend' | 'sideways'

  @Column({ length: 50, nullable: true })
  dailyContext: string; // 'gap_ends_downtrend' | 'gap_above_resistance' | 'gap_above_200ma' | 'other'

  @Column({ type: 'boolean', default: false })
  selected: boolean; // user has selected this for today's session

  @Column({ length: 10, nullable: true })
  exchange: string;

  @Column({ type: 'date' })
  scanDate: string;

  @CreateDateColumn()
  createdAt: Date;
}
