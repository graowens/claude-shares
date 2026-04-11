import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('trades')
export class Trade {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 10 })
  symbol: string;

  @Column({ type: 'enum', enum: ['buy', 'sell'] })
  side: 'buy' | 'sell';

  @Column({ type: 'int' })
  quantity: number;

  @Column({ type: 'decimal', precision: 12, scale: 4, nullable: true })
  entryPrice: number;

  @Column({ type: 'decimal', precision: 12, scale: 4, nullable: true })
  exitPrice: number;

  @Column({ type: 'decimal', precision: 12, scale: 4, nullable: true })
  pnl: number;

  @Column({
    type: 'enum',
    enum: ['open', 'closed', 'cancelled'],
    default: 'open',
  })
  status: 'open' | 'closed' | 'cancelled';

  @Column({ length: 50, nullable: true })
  strategy: string;

  @Column({ type: 'datetime', nullable: true })
  openedAt: Date;

  @Column({ type: 'datetime', nullable: true })
  closedAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
