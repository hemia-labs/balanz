import {
  type DynamicModule,
  type FactoryProvider,
  Module,
  type ModuleMetadata,
} from '@nestjs/common';
import {
  SaxesCfdiParserAdapter,
  type SaxesCfdiParserOptions,
} from './adapters/saxes/saxes-cfdi-parser.adapter';
import { CFDI_PARSER_OPTIONS, CFDI_PARSER_PORT } from './cfdi-parser.tokens';
import type { CfdiParserPort } from './ports/cfdi-parser.port';

export interface CfdiParserModuleAsyncOptions extends Pick<
  ModuleMetadata,
  'imports'
> {
  inject?: FactoryProvider['inject'];
  useFactory: FactoryProvider<SaxesCfdiParserOptions>['useFactory'];
}

@Module({})
export class CfdiParserModule {
  static register(options: SaxesCfdiParserOptions): DynamicModule {
    return this.registerAsync({ useFactory: () => options });
  }

  static registerAsync(options: CfdiParserModuleAsyncOptions): DynamicModule {
    return {
      module: CfdiParserModule,
      imports: options.imports ?? [],
      providers: [
        {
          provide: CFDI_PARSER_OPTIONS,
          inject: options.inject ?? [],
          useFactory: options.useFactory,
        },
        {
          provide: CFDI_PARSER_PORT,
          inject: [CFDI_PARSER_OPTIONS],
          useFactory: (parserOptions: SaxesCfdiParserOptions): CfdiParserPort =>
            new SaxesCfdiParserAdapter(parserOptions),
        },
      ],
      exports: [CFDI_PARSER_PORT],
    };
  }
}
