import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity()
export class Transcript {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  author: string;

  @Column()
  name: string;

  @Column({ type: 'longtext' })
  content: string;

  @CreateDateColumn()
  createdAt: Date;
}
