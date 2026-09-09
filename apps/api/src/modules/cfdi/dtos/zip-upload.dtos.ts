import {
  IsInt,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  IsIn,
} from 'class-validator';

export const ZIP_MAX_BYTES = 50 * 1024 * 1024;
export const ZIP_MIME_TYPES = [
  'application/zip',
  'application/x-zip-compressed',
  'application/octet-stream',
];

export class ZipUploadInitDto {
  @IsString()
  @MaxLength(240)
  // Reject control bytes in client-supplied names.
  // eslint-disable-next-line no-control-regex
  @Matches(/^(?![. ])[^\\/:*?"<>|\x00-\x1f\x7f]+\.zip$/i)
  filename!: string;

  @IsIn(ZIP_MIME_TYPES)
  mimeType!: string;

  @IsInt()
  @Min(22)
  @Max(ZIP_MAX_BYTES)
  sizeBytes!: number;

  @Matches(/^[0-9a-f]{64}$/)
  sha256!: string;
}
