import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('watchlist_items')
export class WatchlistItem {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 10 })
  symbol: string;

  @Column({ type: 'text', nullable: true })
  notes: string;

  @Column({ type: 'enum', enum: ['up', 'down'], nullable: true })
  gapDirection: 'up' | 'down';

  @Column({ type: 'decimal', precision: 12, scale: 4, nullable: true })
  targetEntry: number;

  @Column({ type: 'decimal', precision: 12, scale: 4, nullable: true })
  stopLoss: number;

  @Column({ type: 'decimal', precision: 12, scale: 4, nullable: true })
  takeProfit: number;

  @Column({ length: 10, nullable: true })
  exchange: string;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Column({ type: 'date', nullable: true })
  scheduledDate: string;

  @CreateDateColumn()
  createdAt: Date;
}
