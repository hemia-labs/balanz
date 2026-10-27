import { HttpException, HttpStatus } from '@nestjs/common';

export function cfdiHttpError(
  status: HttpStatus,
  code: string,
  message: string,
): HttpException {
  return new HttpException({ code, error: code, message }, status);
}
