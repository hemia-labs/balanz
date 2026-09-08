import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeIngestionItems,
  normalizeIngestionJob,
  normalizeXmlUploadAccepted,
} from "./types";

test("normaliza respuestas camelCase y snake_case sin datos fiscales", () => {
  assert.deepEqual(
    normalizeXmlUploadAccepted({
      upload_id: "upload",
      object_id: "object",
      job_id: "job",
      status: "queued",
      correlation_id: "correlation",
    }),
    {
      uploadId: "upload",
      objectId: "object",
      jobId: "job",
      status: "queued",
      links: { ingestion: undefined, items: undefined },
      correlationId: "correlation",
    },
  );
  assert.equal(
    normalizeIngestionJob({ data: { jobId: "job", status: "processing" } })
      .status,
    "processing",
  );
});

test("conserva resultados estables y referencias a CFDI", () => {
  const items = normalizeIngestionItems({
    items: [
      {
        id: "item",
        cfdi_id: "cfdi",
        status: "terminal",
        result: "duplicate",
        parser_version: "1.0.0",
      },
    ],
  });
  assert.equal(items[0].result, "duplicate");
  assert.equal(items[0].cfdiId, "cfdi");
  assert.equal(items[0].parserVersion, "1.0.0");
});
