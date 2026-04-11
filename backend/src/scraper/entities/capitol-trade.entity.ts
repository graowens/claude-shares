import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('capitol_trades')
export class CapitolTrade {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 200 })
  politician: string;

  @Column({ length: 10 })
  symbol: string;

  @Column({ type: 'enum', enum: ['buy', 'sell'] })
  tradeType: 'buy' | 'sell';

  @Column({ length: 100, nullable: true })
  amount: string;

  @Column({ type: 'date', nullable: true })
  filedDate: string;

  @Column({ type: 'datetime' })
  scrapedAt: Date;
}
