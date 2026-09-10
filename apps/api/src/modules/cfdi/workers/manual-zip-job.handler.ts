import { Injectable } from '@nestjs/common';
import { ArchiveJobProcessor } from './archive-job.processor';
@Injectable()
export class ManualZipJobHandler extends ArchiveJobProcessor {
  readonly source = 'manual_zip' as const;
}
