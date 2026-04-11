import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity()
export class Strategy {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  name: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ nullable: true })
  source: string; // e.g. "emmanuel-1.txt", "trading-live-best-scalper.txt"

  @Column({ type: 'simple-json', nullable: true })
  params: Record<string, any>; // strategy-specific parameters

  @Column({ default: false })
  enabled: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
