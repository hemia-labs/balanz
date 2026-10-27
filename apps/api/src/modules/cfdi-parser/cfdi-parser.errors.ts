export type CfdiParserErrorCode =
  | 'INGESTION_FILE_TOO_LARGE'
  | 'XML_MALFORMED'
  | 'XML_SECURITY_VIOLATION'
  | 'CFDI_VERSION_UNSUPPORTED'
  | 'COMPLEMENT_UNSUPPORTED'
  | 'CFDI_UUID_INVALID'
  | 'PARSER_ABORTED'
  | 'PARSER_INTERNAL_ERROR';

export type CfdiParserLimit =
  | 'bytes'
  | 'depth'
  | 'nodes'
  | 'attributes'
  | 'attributes_per_element'
  | 'text_node_bytes'
  | 'time';

export class CfdiParserError extends Error {
  constructor(
    readonly code: CfdiParserErrorCode,
    message: string,
    readonly limit?: CfdiParserLimit,
  ) {
    super(message);
    this.name = 'CfdiParserError';
  }
}

export function isCfdiParserError(error: unknown): error is CfdiParserError {
  return error instanceof CfdiParserError;
}
