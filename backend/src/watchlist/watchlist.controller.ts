import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { WatchlistService } from './watchlist.service';
import {
  CreateWatchlistItemDto,
  UpdateWatchlistItemDto,
  BulkAddWatchlistDto,
} from './dto/create-watchlist-item.dto';

@Controller('watchlist')
export class WatchlistController {
  constructor(private readonly watchlistService: WatchlistService) {}

  @Get()
  findAll(@Query('active') active?: string) {
    const isActive =
      active === 'true' ? true : active === 'false' ? false : undefined;
    return this.watchlistService.findAll(isActive);
  }

  @Get(':id')
  findOne(@Param('id') id: number) {
    return this.watchlistService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateWatchlistItemDto) {
    return this.watchlistService.create(dto);
  }

  @Post('bulk')
  bulkAdd(@Body() dto: BulkAddWatchlistDto) {
    return this.watchlistService.bulkAdd(dto.items);
  }

  @Put(':id')
  update(@Param('id') id: number, @Body() dto: UpdateWatchlistItemDto) {
    return this.watchlistService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: number) {
    return this.watchlistService.remove(id);
  }
}
