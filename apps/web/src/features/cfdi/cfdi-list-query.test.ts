import assert from "node:assert/strict";
import test from "node:test";
import { cfdiListQueryString } from "./cfdi-list-query";

test("serializa únicamente la allowlist real de CfdiListQueryDto", () => {
  const serialized = cfdiListQueryString({
    page: 2,
    limit: 500,
    documentType: "P",
    uuid: " 123e4567-e89b-12d3-a456-426614174000 ",
    counterpartyRfc: " abc010101abc ",
    sort: "issuedAt",
    direction: "desc",
  });
  const params = new URLSearchParams(serialized);
  assert.deepEqual([...params.keys()], [
    "page",
    "limit",
    "documentType",
    "uuid",
    "counterpartyRfc",
    "sort",
    "direction",
  ]);
  assert.equal(params.get("limit"), "100");
  assert.equal(params.get("counterpartyRfc"), "ABC010101ABC");
});
