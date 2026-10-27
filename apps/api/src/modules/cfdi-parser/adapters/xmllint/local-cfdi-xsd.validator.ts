import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { CFDI_SCHEMA_SET_VERSION } from '../../ports/cfdi-parser.port';

const MESSAGE_KEY = 'xmllint-wasm';
const DOCUMENT_FILE_NAME = 'document.xml';
const ROOT_SCHEMA_FILE_NAME = 'cfdv40.xsd';
const INITIAL_WASM_MEMORY_PAGES = 1024; // 64 MiB
const MAX_WASM_MEMORY_PAGES = 2048; // 128 MiB

const SUPPORTED_COMPLEMENT_IMPORTS = [
  {
    namespace: 'http://www.sat.gob.mx/TimbreFiscalDigital',
    fileName: 'TimbreFiscalDigitalv11.xsd',
  },
  {
    namespace: 'http://www.sat.gob.mx/Pagos20',
    fileName: 'Pagos20.xsd',
  },
  {
    namespace: 'http://www.sat.gob.mx/nomina12',
    fileName: 'nomina12.xsd',
  },
] as const;

interface SchemaManifestEntry {
  file: string;
  sha256: string;
  sizeBytes: number;
}

interface SchemaManifest {
  schemaSetVersion: string;
  runtimeNetworkAccess: boolean;
  schemas: SchemaManifestEntry[];
}

interface InMemoryFile {
  fileName: string;
  contents: string | Uint8Array;
}

interface SchemaBundle {
  root: InMemoryFile;
  dependencies: InMemoryFile[];
}

interface XmllintWorkerResult {
  [MESSAGE_KEY]?: boolean;
  exitCode?: number;
}

let cachedSchemaBundle: SchemaBundle | undefined;

/**
 * Validates an already security-checked, bounded CFDI byte sequence with the
 * locally pinned SAT schemas. The WASM process has only an in-memory filesystem
 * and is always invoked with --nonet.
 */
export async function validateCfdi40Xsd(
  xml: Uint8Array,
  signal: AbortSignal,
): Promise<boolean> {
  if (signal.aborted) throw new Error('CFDI XSD validation was aborted');

  const bundle = getSchemaBundle();
  const worker = new Worker(require.resolve('xmllint-wasm/xmllint-node.js'), {
    resourceLimits: {
      maxOldGenerationSizeMb: 64,
      maxYoungGenerationSizeMb: 16,
      stackSizeMb: 4,
    },
  });

  return await new Promise<boolean>((resolve, reject) => {
    let settled = false;

    const dispose = (): void => {
      signal.removeEventListener('abort', handleAbort);
      // Keep the guarded error/exit listeners installed until termination so
      // a late worker event cannot become an unhandled EventEmitter error.
      void worker.terminate().catch(() => undefined);
    };
    const succeed = (valid: boolean): void => {
      if (settled) return;
      settled = true;
      dispose();
      resolve(valid);
    };
    const fail = (): void => {
      if (settled) return;
      settled = true;
      dispose();
      reject(new Error('Local CFDI XSD validation failed'));
    };
    const handleAbort = (): void => fail();

    worker.on('message', (candidate: unknown) => {
      const result = candidate as XmllintWorkerResult;
      if (!result || result[MESSAGE_KEY] !== true) return;
      if (result.exitCode === 0) {
        succeed(true);
      } else if (result.exitCode === 3 || result.exitCode === 4) {
        succeed(false);
      } else {
        fail();
      }
    });
    worker.once('error', fail);
    worker.once('exit', () => {
      if (!settled) fail();
    });
    signal.addEventListener('abort', handleAbort, { once: true });

    try {
      worker.postMessage({
        [MESSAGE_KEY]: true,
        inputFiles: [
          { fileName: DOCUMENT_FILE_NAME, contents: xml },
          bundle.root,
          ...bundle.dependencies,
        ],
        args: [
          '--nonet',
          '--noout',
          '--schema',
          ROOT_SCHEMA_FILE_NAME,
          DOCUMENT_FILE_NAME,
        ],
        initialMemory: INITIAL_WASM_MEMORY_PAGES,
        maxMemory: MAX_WASM_MEMORY_PAGES,
      });
    } catch {
      fail();
    }
  });
}

function getSchemaBundle(): SchemaBundle {
  if (cachedSchemaBundle) return cachedSchemaBundle;

  const schemaRoot = join(__dirname, '..', '..', 'schemas');
  const manifest = JSON.parse(
    readFileSync(join(schemaRoot, 'manifest.json'), 'utf8'),
  ) as SchemaManifest;

  if (
    manifest.schemaSetVersion !== CFDI_SCHEMA_SET_VERSION ||
    manifest.runtimeNetworkAccess !== false
  ) {
    throw new Error('Invalid local CFDI schema manifest');
  }

  const schemaNames = new Set(manifest.schemas.map((entry) => entry.file));
  const schemas = new Map<string, string>();
  for (const entry of manifest.schemas) {
    if (entry.file !== basename(entry.file) || schemas.has(entry.file)) {
      throw new Error('Invalid local CFDI schema manifest entry');
    }
    const bytes = readFileSync(join(schemaRoot, entry.file));
    if (
      bytes.length !== entry.sizeBytes ||
      createHash('sha256').update(bytes).digest('hex') !== entry.sha256
    ) {
      throw new Error('Local CFDI schema integrity check failed');
    }
    schemas.set(
      entry.file,
      localizeSchemaLocations(bytes.toString('utf8'), schemaNames),
    );
  }

  const root = schemas.get(ROOT_SCHEMA_FILE_NAME);
  if (!root) throw new Error('Local CFDI root schema is missing');

  cachedSchemaBundle = {
    root: {
      fileName: ROOT_SCHEMA_FILE_NAME,
      contents: buildRuntimeRootSchema(root),
    },
    dependencies: [...schemas.entries()]
      .filter(([fileName]) => fileName !== ROOT_SCHEMA_FILE_NAME)
      .map(([fileName, contents]) => ({ fileName, contents })),
  };
  return cachedSchemaBundle;
}

function localizeSchemaLocations(
  schema: string,
  allowedFiles: ReadonlySet<string>,
): string {
  return schema.replace(
    /schemaLocation="([^"]+)"/g,
    (_match, location: string) => {
      const localFile = basename(location.replaceAll('\\', '/'));
      if (!allowedFiles.has(localFile)) {
        throw new Error('Local CFDI schema dependency is not allowlisted');
      }
      return `schemaLocation="${localFile}"`;
    },
  );
}

function buildRuntimeRootSchema(officialRoot: string): string {
  const imports = SUPPORTED_COMPLEMENT_IMPORTS.map(
    ({ namespace, fileName }) =>
      `<xs:import namespace="${namespace}" schemaLocation="${fileName}"/>`,
  ).join('\n');
  const withImports = officialRoot.replace(
    /(<xs:schema\b[^>]*>)/,
    `$1\n${imports}`,
  );
  if (withImports === officialRoot) {
    throw new Error('Local CFDI root schema could not be composed');
  }

  const strictComplementWildcard =
    '<xs:any minOccurs="0" maxOccurs="unbounded"/>';
  const laxComplementWildcard =
    '<xs:any minOccurs="0" maxOccurs="unbounded" processContents="lax"/>';
  const runtimeRoot = withImports.replace(
    strictComplementWildcard,
    laxComplementWildcard,
  );
  if (runtimeRoot === withImports) {
    throw new Error('Local CFDI complement wildcard is missing');
  }
  return runtimeRoot;
}
