import {
  BadRequestException,
  type ValidationPipeOptions,
} from '@nestjs/common';
import type { ValidationError } from 'class-validator';

export type ValidationFieldErrors = Record<string, string[]>;

const CONSTRAINT_PRIORITY = [
  'whitelistValidation',
  'isDefined',
  'isNotEmpty',
  'isString',
  'isUUID',
  'isInt',
  'isBoolean',
  'isEnum',
  'isIn',
  'minLength',
  'maxLength',
  'min',
  'max',
  'matches',
];

const GENERIC_MESSAGES: Record<string, string> = {
  whitelistValidation: 'Este campo no está permitido.',
  isDefined: 'Este campo es obligatorio.',
  isNotEmpty: 'Este campo es obligatorio.',
  isString: 'Escribe un valor de texto válido.',
  isUUID: 'Selecciona una opción válida.',
  isInt: 'Escribe un número entero válido.',
  isBoolean: 'Selecciona un valor válido.',
  isEnum: 'Selecciona una opción válida.',
  isIn: 'Selecciona una opción válida.',
  minLength: 'El valor es demasiado corto.',
  maxLength: 'El valor es demasiado largo.',
  min: 'El valor es menor al permitido.',
  max: 'El valor es mayor al permitido.',
  matches: 'El formato no es válido.',
  nestedValidation: 'Completa correctamente este grupo de campos.',
};

function isDefaultValidatorMessage(path: string, message: string): boolean {
  const property = path.split('.').at(-1) ?? path;
  return (
    message.startsWith(`${property} `) ||
    message.startsWith(`${path} `) ||
    message.includes('regular expression') ||
    message.includes('should not exist')
  );
}

function friendlyMessage(
  path: string,
  constraint: string,
  message: string,
): string {
  if (!isDefaultValidatorMessage(path, message)) return message;
  return GENERIC_MESSAGES[constraint] ?? 'El valor no es válido.';
}

function collectErrors(
  errors: ValidationError[],
  result: ValidationFieldErrors,
  parent = '',
): void {
  for (const error of errors) {
    const path = parent ? `${parent}.${error.property}` : error.property;
    if (error.constraints) {
      const messages = Object.entries(error.constraints)
        .sort(
          ([left], [right]) =>
            constraintPriority(left) - constraintPriority(right),
        )
        .map(([constraint, message]) =>
          friendlyMessage(path, constraint, message),
        );
      result[path] = [...new Set(messages)];
    }
    if (error.children?.length) collectErrors(error.children, result, path);
  }
}

function constraintPriority(constraint: string): number {
  const index = CONSTRAINT_PRIORITY.indexOf(constraint);
  return index === -1 ? CONSTRAINT_PRIORITY.length : index;
}

export function validationExceptionFactory(errors: ValidationError[]) {
  const fieldErrors: ValidationFieldErrors = {};
  collectErrors(errors, fieldErrors);
  return new BadRequestException({
    code: 'VALIDATION_ERROR',
    error: 'ValidationError',
    message: 'Revisa los campos señalados e intenta de nuevo.',
    fieldErrors,
  });
}

export const API_VALIDATION_PIPE_OPTIONS = {
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  exceptionFactory: validationExceptionFactory,
} as const satisfies ValidationPipeOptions;
