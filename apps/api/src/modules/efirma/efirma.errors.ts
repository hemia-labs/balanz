import { HttpException } from '@nestjs/common';

export function efirmaError(code: string, status = 409): HttpException {
  return new HttpException(
    {
      code,
      message:
        'No fue posible completar la operación de credenciales temporales.',
    },
    status,
  );
}
