import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../../lib/api-client";
import type { XmlUploadAccepted } from "./types";
import { createXmlUploadSession } from "./upload-session";

const accepted: XmlUploadAccepted = {
  uploadId: "upload",
  objectId: "object",
  jobId: "job",
  status: "queued",
  correlationId: "correlation",
  links: {},
};

test("cancelar una recepción y volver a cargar el mismo archivo recupera la carga", async () => {
  const session = createXmlUploadSession();
  const keys: string[] = [];
  let rejectTransfer!: (error: unknown) => void;
  const cancelled = session.start((key) => {
    keys.push(key);
    return {
      promise: new Promise<XmlUploadAccepted>((_resolve, reject) => {
        rejectTransfer = reject;
      }),
      abort: () => rejectTransfer(new ApiError(0, "Cancelado", "ABORTED")),
    };
  });
  cancelled.abort();
  await assert.rejects(cancelled.promise, { code: "ABORTED" });

  // Same selection/session: the server confirms failUpload before rotating.
  const resumed = session.start((key) => {
    keys.push(key);
    return {
      promise:
        key === keys[0]
          ? Promise.reject(
              new ApiError(409, "Recepción fallida", "INGESTION_UPLOAD_FAILED"),
            )
          : Promise.resolve(accepted),
      abort() {},
    };
  });
  assert.deepEqual(await resumed.promise, accepted);
  assert.equal(keys.length, 3);
  assert.equal(keys[1], keys[0]);
  assert.notEqual(keys[2], keys[0]);
});

for (const code of ["NETWORK_ERROR", "TIMEOUT", "ABORTED"]) {
  test(`conserva la clave tras ${code} para recuperar un 202 perdido`, async () => {
    const session = createXmlUploadSession();
    const keys: string[] = [];
    const first = session.start((key) => {
      keys.push(key);
      return {
        promise: Promise.reject(new ApiError(0, "Incierto", code)),
        abort() {},
      };
    });
    await assert.rejects(first.promise, { code });
    assert.equal(keys.length, 1);
    const replay = session.start((key) => {
      keys.push(key);
      return { promise: Promise.resolve(accepted), abort() {} };
    });
    assert.deepEqual(await replay.promise, accepted);
    assert.equal(keys[1], keys[0]);
  });
}

test("un conflicto sin fallo confirmado no renueva la clave", async () => {
  const session = createXmlUploadSession();
  let requests = 0;
  const upload = session.start(() => {
    requests += 1;
    return {
      promise: Promise.reject(
        new ApiError(409, "Incierto", "UPLOAD_NOT_CONFIRMABLE"),
      ),
      abort() {},
    };
  });
  await assert.rejects(upload.promise, { code: "UPLOAD_NOT_CONFIRMABLE" });
  assert.equal(requests, 1);
});

test("limita la recuperación automática a una recepción nueva por submit", async () => {
  const session = createXmlUploadSession();
  let requests = 0;
  const upload = session.start(() => {
    requests += 1;
    return {
      promise: Promise.reject(
        new ApiError(409, "Falló", "INGESTION_UPLOAD_FAILED"),
      ),
      abort() {},
    };
  });
  await assert.rejects(upload.promise, { code: "INGESTION_UPLOAD_FAILED" });
  assert.equal(requests, 2);
});

test("cancelar antes de recibir el fallo confirmado impide una nueva transferencia", async () => {
  const session = createXmlUploadSession();
  let fail!: (error: unknown) => void;
  let requests = 0;
  const upload = session.start(() => {
    requests += 1;
    return {
      promise: new Promise<XmlUploadAccepted>((_resolve, reject) => {
        fail = reject;
      }),
      abort() {},
    };
  });
  upload.abort();
  fail(new ApiError(409, "Falló", "INGESTION_UPLOAD_FAILED"));
  await assert.rejects(upload.promise);
  assert.equal(requests, 1);
});

test("cancelar también aborta la transferencia creada por la recuperación", async () => {
  const session = createXmlUploadSession();
  let requests = 0;
  let rejectRetry!: (error: unknown) => void;
  const upload = session.start(() => {
    requests += 1;
    return requests === 1
      ? {
          promise: Promise.reject(
            new ApiError(409, "Falló", "INGESTION_UPLOAD_FAILED"),
          ),
          abort() {},
        }
      : {
          promise: new Promise<XmlUploadAccepted>((_resolve, reject) => {
            rejectRetry = reject;
          }),
          abort: () => rejectRetry(new ApiError(0, "Cancelado", "ABORTED")),
        };
  });
  await Promise.resolve();
  upload.abort();
  await assert.rejects(upload.promise, { code: "ABORTED" });
  assert.equal(requests, 2);
});
