import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WatchlistItem } from './entities/watchlist-item.entity';
import {
  CreateWatchlistItemDto,
  UpdateWatchlistItemDto,
} from './dto/create-watchlist-item.dto';

@Injectable()
export class WatchlistService {
  constructor(
    @InjectRepository(WatchlistItem)
    private readonly repo: Repository<WatchlistItem>,
  ) {}

  findAll(active?: boolean): Promise<WatchlistItem[]> {
    const where: any = {};
    if (active !== undefined) where.active = active;
    return this.repo.find({ where, order: { createdAt: 'DESC' } });
  }

  findOne(id: number): Promise<WatchlistItem> {
    return this.repo.findOneBy({ id });
  }

  findActiveForDate(date: string): Promise<WatchlistItem[]> {
    return this.repo.find({
      where: { active: true, scheduledDate: date },
    });
  }

  findAllActive(): Promise<WatchlistItem[]> {
    return this.repo.find({ where: { active: true } });
  }

  create(dto: CreateWatchlistItemDto): Promise<WatchlistItem> {
    const item = this.repo.create({
      ...dto,
      symbol: dto.symbol.toUpperCase(),
    });
    return this.repo.save(item);
  }

  async bulkAdd(items: CreateWatchlistItemDto[]): Promise<WatchlistItem[]> {
    const entities = items.map((dto) =>
      this.repo.create({ ...dto, symbol: dto.symbol.toUpperCase() }),
    );
    return this.repo.save(entities);
  }

  async update(
    id: number,
    dto: UpdateWatchlistItemDto,
  ): Promise<WatchlistItem> {
    await this.repo.update(id, {
      ...dto,
      symbol: dto.symbol?.toUpperCase(),
    });
    return this.repo.findOneBy({ id });
  }

  async remove(id: number): Promise<void> {
    await this.repo.delete(id);
  }
}
