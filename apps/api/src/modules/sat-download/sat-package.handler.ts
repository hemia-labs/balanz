import { Injectable } from '@nestjs/common';
import { ArchiveJobProcessor } from '../cfdi/workers/archive-job.processor';
@Injectable()
export class SatPackageJobHandler extends ArchiveJobProcessor {
  readonly source = 'sat_package' as const;
}
