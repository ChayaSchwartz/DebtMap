import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import type {
  AnalysisRunResponse,
  AnalysisRunStatusResponse,
  FileDetailResponse,
  RunHistoryPoint,
} from '@debtmap/shared';
import { AnalysesService } from './analyses.service';
import { CreateAnalysisDto } from './dto/create-analysis.dto';

@Controller('api/analyses')
export class AnalysesController {
  constructor(private readonly analyses: AnalysesService) {}

  @Post()
  create(@Body() dto: CreateAnalysisDto): Promise<AnalysisRunStatusResponse> {
    return this.analyses.create(dto.repoUrl);
  }

  /**
   * Polled while a run is in flight. Kept separate from the full result so the
   * client is not re-downloading thousands of file rows every two seconds.
   */
  @Get(':id/status')
  getStatus(@Param('id') id: string): Promise<AnalysisRunStatusResponse> {
    return this.analyses.getStatus(id);
  }

  @Get('history')
  getHistory(
    @Query('repoUrl') repoUrl: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ): Promise<RunHistoryPoint[]> {
    return this.analyses.getHistory(repoUrl, limit ?? 20);
  }

  /** Public share link. No authentication, by design. */
  @Get('shared/:slug')
  getShared(@Param('slug') slug: string): Promise<AnalysisRunResponse> {
    return this.analyses.getBySlug(slug);
  }

  @Get(':id')
  getById(@Param('id') id: string): Promise<AnalysisRunResponse> {
    return this.analyses.getById(id);
  }

  @Get(':id/files/:fileId')
  getFile(
    @Param('id') id: string,
    @Param('fileId') fileId: string,
  ): Promise<FileDetailResponse> {
    return this.analyses.getFile(id, fileId);
  }
}
