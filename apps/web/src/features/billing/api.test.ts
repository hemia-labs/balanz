import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../../lib/api-client";
import {
  createCheckoutAttempt, createPlanChangeAttempt, retryCheckoutAttempt,
  getCheckoutAttempt, syncBillingAccess,
} from "./api";
import { canStartNewCheckout, readCheckoutDraft, checkoutActionUrl } from "./checkout-recovery";
import { canReuseLegalAcceptance } from "./legal-consent";

const id = "11111111-1111-4111-8111-111111111111";
const input = { idempotencyKey: id, legalAcceptanceId: id, planCode: "business", planPriceCode: "monthly" };
const receipt = { attemptId: id, status: "rejected", planCode: input.planCode, planPriceCode: input.planPriceCode, errorCode: "QUOTE_CHANGED" };
const response = (body: unknown, status = 200) => Response.json(body, { status });

for (const operation of ["create", "change", "retry"] as const) {
  test(`${operation}: recovers the durable HTTP422 receipt so the quote review action is reachable`, async () => {
    const previous = globalThis.fetch;
    const calls: { path: string; method: string }[] = [];
    globalThis.fetch = async (url, init) => {
      const method = init?.method ?? "GET";
      const path = new URL(String(url)).pathname;
      calls.push({ path, method });
      assert.equal(init?.credentials, "include");
      return method === "POST" ? response(receipt, 422) : response(receipt);
    };
    try {
      const signal = new AbortController().signal;
      const result = operation === "retry"
        ? await retryCheckoutAttempt(id, signal, input)
        : await (operation === "change" ? createPlanChangeAttempt : createCheckoutAttempt)(input, signal);
      assert.deepEqual(result, receipt);
      assert.equal(canStartNewCheckout(result), true);
      assert.deepEqual(calls.map(c => c.method), ["POST", "GET"]);
      assert.ok(calls[1].path.endsWith(`/payments/checkout-attempts/${id}`));
      assert.ok(calls[0].path.endsWith(operation === "retry" ? `/${id}/retry` : operation === "change" ? "/subscription/change-plan" : "/checkout-attempts"));
    } finally { globalThis.fetch = previous; }
  });
}

for (const altered of [
  { ...receipt, attemptId: "22222222-2222-4222-8222-222222222222" },
  { ...receipt, status: "ready", checkoutUrl: "https://www.paypal.com/checkoutnow" },
  { ...receipt, planCode: "other" },
  { ...receipt, planPriceCode: "yearly" },
  { ...receipt, planCode: undefined },
  null,
]) {
  test(`rejects mismatched recovery receipt ${JSON.stringify(altered)}`, async () => {
    const previous = globalThis.fetch;
    globalThis.fetch = async (_url, init) => init?.method === "POST"
      ? response({ message: "original rejection", code: "QUOTE_CHANGED" }, 422)
      : response(altered);
    try {
      await assert.rejects(createCheckoutAttempt(input, new AbortController().signal), error =>
        error instanceof ApiError && error.status === 422 && error.message === "original rejection");
    } finally { globalThis.fetch = previous; }
  });
}

for (const recoveryStatus of [401, 403, 404, 503]) {
  test(`failed recovery GET ${recoveryStatus} preserves the original HTTP422`, async () => {
    const previous = globalThis.fetch;
    globalThis.fetch = async (_url, init) => init?.method === "POST"
      ? response({ message: "original rejection" }, 422)
      : response({ message: "recovery failed" }, recoveryStatus);
    try {
      await assert.rejects(createPlanChangeAttempt(input, new AbortController().signal), error =>
        error instanceof ApiError && error.status === 422 && error.message === "original rejection");
    } finally { globalThis.fetch = previous; }
  });
}

for (const failure of [409, 429, 503, "network"] as const) {
  test(`${failure} does not recover or create another purchase`, async () => {
    const previous = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      if (failure === "network") throw new TypeError("network failed");
      return response({ message: "ambiguous failure" }, failure);
    };
    try {
      await assert.rejects(retryCheckoutAttempt(id, new AbortController().signal, input));
      assert.equal(calls, 1);
    } finally { globalThis.fetch = previous; }
  });
}

test("successful submission needs no recovery GET; explicit synchronization POST is separate from status GET", async () => {
  const previous = globalThis.fetch;
  const calls: { path: string; method: string }[] = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ path: new URL(String(url)).pathname, method: init?.method ?? "GET" });
    return response({ ...receipt, status: "ready" });
  };
  try {
    const signal = new AbortController().signal;
    await createCheckoutAttempt(input, signal);
    assert.equal(calls.length, 1);
    await syncBillingAccess(signal);
    await getCheckoutAttempt(id, signal);
    assert.deepEqual(calls.slice(1).map(c => [c.path.split("/payments/")[1], c.method]), [["sync", "POST"], [`checkout-attempts/${id}`, "GET"]]);
  } finally { globalThis.fetch = previous; }
});

for (const failure of [404, 503, "network"] as const) {
  test(`accepted documents survive checkout ${failure}; explicit retries after reload preserve the same purchase key`, async () => {
    const previous = globalThis.fetch;
    const required = { productCode: "balanz_cfdi", identitySourceId: "identity", documents: [{ documentVersionId: id, contentHash: "hash" }] };
    const accepted = { accepted: true, productCode: required.productCode, identitySourceId: required.identitySourceId, legalAcceptanceId: id, acceptedDocuments: required.documents };
    const storedConsent = JSON.stringify(accepted);
    // This is the same serialized draft saved before the first POST, including when no receipt was returned.
    const storedDraft = JSON.stringify({ idempotencyKey: input.idempotencyKey, legalAcceptanceId: accepted.legalAcceptanceId });
    const calls: unknown[] = [];
    globalThis.fetch = async (url, init) => {
      assert.ok(String(url).endsWith("/payments/checkout-attempts"));
      assert.equal(init?.method, "POST");
      calls.push(JSON.parse(String(init?.body)));
      if (calls.length < 3) {
        if (failure === "network") throw new TypeError("connection lost");
        return response({ message: "upstream unavailable" }, failure);
      }
      return response({ ...receipt, status: "ready", checkoutUrl: "https://www.paypal.com/checkoutnow" });
    };
    try {
      for (let retry = 0; retry < 2; retry++) {
        const consent = JSON.parse(storedConsent) as unknown;
        assert.equal(canReuseLegalAcceptance(consent, required), true);
        const draft = readCheckoutDraft(storedDraft, accepted.legalAcceptanceId)!;
        assert.ok(draft);
        assert.equal(draft.attemptId, undefined);
        await assert.rejects(createCheckoutAttempt({ ...input, ...draft }, new AbortController().signal));
        assert.equal(canStartNewCheckout(undefined), false);
        assert.equal(calls.length, retry + 1); // Never retries or accepts Legal automatically.
      }
      const draft = readCheckoutDraft(storedDraft, accepted.legalAcceptanceId)!;
      const result = await createCheckoutAttempt({ ...input, ...draft }, new AbortController().signal);
      assert.equal(result.status, "ready");
      assert.deepEqual(calls, [input, input, input]);
      assert.deepEqual(JSON.parse(storedConsent), accepted);
    } finally { globalThis.fetch = previous; }
  });
}

test("Billing selects the provider; the browser submits no provider choice and follows only the returned safe payment action", async () => {
  const previous = globalThis.fetch;
  const paymentUrl = "https://checkout.billing-selected-provider.example/pay/session";
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    assert.deepEqual(JSON.parse(String(init?.body)), input);
    return response({ ...receipt, status: "ready", provider: "billing-selected-provider", checkoutUrl: paymentUrl });
  };
  try {
    const result = await createCheckoutAttempt(input, new AbortController().signal);
    assert.equal(checkoutActionUrl(result), paymentUrl);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = previous; }
});


for (const cancelled of [false, true]) {
 test(cancelled ? "cancelled checkout offers one payment action and a way back to Balanz" : "the return page retries a saved pending plan change directly, without reopening checkout", async () => {
  const { readFileSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const { runInNewContext } = await import("node:vm");
  const { transpileModule, ModuleKind, JsxEmit } = await import("typescript");
  const jsxRuntime = await import("react/jsx-runtime");
  const recovery = await import("./checkout-recovery");
  const api = await import("./api");
  const money = await import("../cfdi/exact-decimal");
  const source = readFileSync(resolve(__dirname, "../../../src/features/billing/billing-checkout-return.tsx"), "utf8");
  const saved = cancelled
    ? { ...receipt, operation: "change_plan", status: "ready", statusFresh: true, planChange: { state: "awaiting_approval", action: "approve_payment", amountDueNow: "354.84", currency: "MXN" } }
    : { ...receipt, operation: "change_plan", status: "pending", statusFresh: false, errorCode: "BILLING_TEMPORARILY_UNAVAILABLE" };
  let stateIndex = 0;
  const effects: Array<() => unknown> = [];
  const storage = new Map([[recovery.pendingCheckoutKey(id, id), id]]);
  const calls: string[] = [];
  const redirects: string[] = [];
  const paymentUrl = "https://www.sandbox.paypal.com/checkoutnow?token=saved";
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push(new URL(String(url)).pathname);
    assert.equal(init?.method, "POST");
    assert.equal(init?.body, undefined);
    return response({ ...saved, status: "ready", checkoutUrl: paymentUrl, ...(cancelled ? { planChange: { ...("planChange" in saved ? saved.planChange : {}), checkoutUrl: paymentUrl } } : {}) });
  };
  try {
    const exports: { BillingCheckoutReturn?: (props: unknown) => unknown } = {};
    runInNewContext(transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, jsx: JsxEmit.ReactJSX } }).outputText, {
      exports,
      window: { location: { assign: (url: string) => redirects.push(url) } },
      AbortController,
      sessionStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
      URLSearchParams,
      require: (name: string) => {
        if (name === "react") return {
          useState: (initial: unknown) => [stateIndex++ === 0 ? saved : initial, () => undefined],
          useEffect: (effect: () => unknown) => effects.push(effect),
          useRef: () => ({ current: null }),
        };
        if (name === "./billing-discard-checkout") return { BillingDiscardCheckout: "BillingDiscardCheckout" };
        if (name === "./api") return api;
        if (name === "@/features/cfdi/exact-decimal") return money;
        if (name === "./checkout-recovery") return recovery;
        if (name === "@/lib/api-client") return { ApiError };
        if (name === "@/components/accounting-context") return { useAccountingContext: () => ({ organization: { id, slug: "punto-fiscal", name: "Punto Fiscal" }, locale: "es" }) };
        if (name === "@/features/session/session-provider") return { useSession: () => ({ session: { userId: id } }) };
        if (name === "@/components/ui/button") return { Button: "button" };
        if (name === "react/jsx-runtime") return jsxRuntime;
        return new Proxy({}, { get: (_, key) => String(key) });
      },
    });
    type Element = { type?: string; props?: { children?: unknown; disabled?: boolean; href?: string; onClick?: () => void } };
    function findRetry(node: unknown): Element | undefined {
      if (Array.isArray(node)) return node.map(findRetry).find(Boolean);
      if (!node || typeof node !== "object") return;
      const element = node as Element;
      if (element.type === "button" && element.props?.children === (cancelled ? "Continuar al pago" : "Reintentar pago")) return element;
      return findRetry(element.props?.children);
    }
    const tree = exports.BillingCheckoutReturn!({ attemptId: id, cancelled });
    assert.ok(JSON.stringify(tree).includes("Cerrar sin descartar el intento y volver a planes"));
    assert.deepEqual(calls, []);
    const button = findRetry(tree);
    effects[2]();
    assert.equal(storage.get(recovery.pendingCheckoutKey(id, id)), id);
    if (cancelled) {
      storage.set(recovery.pendingCheckoutKey(id, id), "another-attempt");
      effects[2]();
      assert.equal(storage.get(recovery.pendingCheckoutKey(id, id)), "another-attempt");
      function buttons(node: unknown): string[] {
        if (Array.isArray(node)) return node.flatMap(buttons);
        if (!node || typeof node !== "object") return [];
        const element = node as Element;
        return element.type === "button" ? [String(element.props?.children)] : buttons(element.props?.children);
      }
      assert.deepEqual(Array.from(buttons(tree)), ["Continuar al pago"]);
      assert.ok(JSON.stringify(tree).includes("BillingDiscardCheckout"));
      const content = JSON.stringify(tree);
      assert.ok(content.includes("El cambio de plan no se completó"));
      assert.ok(content.includes("Pago único por el cambio"));
      assert.ok(!content.toLowerCase().includes("prorrateo"));
      assert.deepEqual(calls, []);
      return;
    }
    assert.ok(button);
    assert.equal(button.props?.disabled, false);
    assert.equal(button.props?.href, undefined);
    assert.deepEqual(calls, []);
    button.props?.onClick?.();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual(calls, [`/api/v1/payments/checkout-attempts/${id}/${cancelled ? "confirm" : "retry"}`]);
    assert.deepEqual(redirects, [paymentUrl]);
  } finally { globalThis.fetch = previous; }
});

}


for (const mode of ["checkout", "scheduled", "pending-change", "renewal-pending", "renewal-scheduled"]) {
const scheduledChange = mode === "scheduled";
const planChange = mode === "scheduled" || mode === "pending-change";
const renewalResume = mode.startsWith("renewal-");
const renewalScheduled = mode === "renewal-scheduled";
for (const cancelled of [true, false, "conflict", "abandoned"] as const) {
  test(`discard requires confirmation and navigates only after confirmed cancellation (${cancelled}, mode=${mode})`, async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const { runInNewContext } = await import("node:vm");
    const { transpileModule, ModuleKind, JsxEmit } = await import("typescript");
    const jsxRuntime = await import("react/jsx-runtime");
    const recovery = await import("./checkout-recovery");
    const calls: string[] = [];
    const redirects: string[] = [];
    const exports: { BillingDiscardCheckout?: (props: unknown) => unknown } = {};
    const source = readFileSync(resolve(__dirname, "../../../src/features/billing/billing-discard-checkout.tsx"), "utf8");
    runInNewContext(transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, jsx: JsxEmit.ReactJSX } }).outputText, {
      exports, AbortController,
      window: { location: { assign: (url: string) => redirects.push(url) } },
      require: (name: string) => {
        if (name === "react") return { useId: () => "discard-help", useState: (initial: unknown) => [initial, () => undefined], useEffect: () => undefined, useRef: () => ({ current: null }) };
        if (name === "./api") return { cancelCheckoutAttempt: async (attemptId: string) => { calls.push(attemptId); if (cancelled === "conflict") throw new ApiError(409, "Already paid"); return cancelled ? { cancelled: true, ...(cancelled === "abandoned" ? { abandoned: true } : {}) } : { cancelled: false, approvalUrl: "https://www.sandbox.paypal.com/restore" }; } };
        if (name === "./checkout-recovery") return recovery;
        if (name === "@/lib/api-client") return { ApiError };
        if (name === "@/components/ui/button") return { Button: "button" };
        if (name === "react/jsx-runtime") return jsxRuntime;
        if (name === "@/components/overlay-dialog") return { ControlledDialog: "dialog" };
        throw new Error(name);
      },
    });
    type Element = { type?: string; props?: { children?: unknown; onClick?: () => void } };
    function findButton(node: unknown, label: string): Element | undefined {
      if (Array.isArray(node)) return node.map(value => findButton(value, label)).find(Boolean);
      if (!node || typeof node !== "object") return;
      const el = node as Element;
      return el.type === "button" && el.props?.children === label ? el : findButton(el.props?.children, label);
    }
    const tree = exports.BillingDiscardCheckout!({ attemptId: id, plansHref: "/es/plans", scheduledChange, planChange, renewalResume, renewalScheduled });
    const trigger = findButton(tree, renewalScheduled ? "Desactivar renovación automática" : renewalResume ? "Descartar reactivación" : scheduledChange ? "Cancelar cambio programado" : "Conservar mi plan actual");
    assert.ok(trigger);
    trigger.props?.onClick?.();
    assert.deepEqual(calls, []);
    const button = findButton(tree, renewalScheduled ? "Confirmar cancelación" : renewalResume ? "Confirmar descarte" : planChange ? "Confirmar cancelación del cambio" : "Descartar intento");
    assert.deepEqual(calls, []);
    assert.ok(button);
    button.props?.onClick?.();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual(calls, [id]);
    assert.deepEqual(redirects, cancelled === true || cancelled === "abandoned" ? ["/es/plans"] : []);
  });
}

}

for (const alreadyCancelled of [true, false, null]) {
  test(`subscription cancellation refreshes a conflict and closes only when recorded (${alreadyCancelled})`, async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const { runInNewContext } = await import("node:vm");
    const { transpileModule, ModuleKind, JsxEmit } = await import("typescript");
    const jsxRuntime = await import("react/jsx-runtime");
    const management = await import("./subscription-management");
    const changes: unknown[] = [];
    const openValues: unknown[] = [];
    const errors: unknown[] = [];
    let reads = 0;
    let stateIndex = 0;
    const current = alreadyCancelled === null ? null : { id, organizationId: id, status: "active", planCode: "pro", cancelAtPeriodEnd: alreadyCancelled, currentPeriodEnd: "2030-01-01T00:00:00Z", cancellation: alreadyCancelled ? { state: "scheduled", effectiveAt: "2030-01-01T00:00:00Z" } : null, pendingPlanChange: null };
    const exports: { BillingSubscriptionActions?: (props: unknown) => unknown } = {};
    const source = readFileSync(resolve(__dirname, "../../../src/features/billing/billing-subscription-actions.tsx"), "utf8");
    runInNewContext(transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, jsx: JsxEmit.ReactJSX } }).outputText, {
      exports, AbortController, crypto: { randomUUID: () => id },
      sessionStorage: { getItem: () => null, setItem: () => undefined },
      window: { dispatchEvent: () => undefined }, Event,
      require: (name: string) => {
        if (name === "react") return {
          useState: (initial: unknown) => { const index = stateIndex++; return [typeof initial === "function" ? initial() : initial, (value: unknown) => { if (index === 0) openValues.push(value); if (index === 2) errors.push(value); }]; },
          useEffect: () => undefined, useRef: () => ({ current: null }), useId: () => "heading",
        };
        if (name === "./api") return {
          cancelBillingSubscription: async () => { throw new ApiError(alreadyCancelled === null ? 404 : 409, "Conflict"); },
          getBillingSubscription: async () => { reads++; return current; },
        };
        if (name === "./subscription-management") return management;
        if (name === "@/lib/api-client") return { ApiError };
        if (name === "@/features/session/session-provider") return { useSession: () => ({ session: { userId: id } }) };
        if (name === "@/components/accounting-context") return { useAccountingContext: () => ({ organization: { id, slug: "punto-fiscal" }, locale: "es" }) };
        if (name === "@/components/ui/button") return { Button: "button" };
        if (name === "react/jsx-runtime") return jsxRuntime;
        return new Proxy({}, { get: (_, key) => String(key) });
      },
    });
    type Element = { type?: string; props?: { children?: unknown; onClick?: () => void } };
    function findConfirm(node: unknown): Element | undefined {
      if (Array.isArray(node)) return node.map(findConfirm).find(Boolean);
      if (!node || typeof node !== "object") return;
      const el = node as Element;
      return el.type === "button" && el.props?.children === "Confirmar cancelación" ? el : findConfirm(el.props?.children);
    }
    const button = findConfirm(exports.BillingSubscriptionActions!({ subscription: { id, organizationId: id, status: alreadyCancelled === null ? "pending" : "active", ...current, cancelAtPeriodEnd: false, cancellation: null }, onChange: (value: unknown) => changes.push(value) }));
    assert.ok(button);
    assert.equal(reads, 0);
    button.props?.onClick?.();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(reads, 1);
    assert.equal(changes[0], current);
    assert.equal(openValues.includes(false), alreadyCancelled !== false);
    assert.equal(errors.some(value => typeof value === "string" && value.includes("aún no se confirmó")), alreadyCancelled === false);
  });
}

for (const terminalView of [false, true]) {
for (const scenario of ["abandoned", "pending", "stale-abandonment", "wrong-purchase", "late-recovery"] as const) {
  if (terminalView && scenario === "late-recovery") continue;
  test(`returning to the same plan uses a new key only for confirmed abandonment (${scenario}, terminal=${terminalView})`, async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const { runInNewContext } = await import("node:vm");
    const { transpileModule, ModuleKind, JsxEmit } = await import("typescript");
    const jsxRuntime = await import("react/jsx-runtime");
    const recovery = await import("./checkout-recovery");
    const lateRecovery = scenario === "late-recovery";
    const replacing = scenario === "abandoned" || lateRecovery;
    let releaseOld: (() => void) | undefined;
    const effects: Array<() => unknown> = [];
    let createdKey = "";
    let quotesReviewed = 0;
    const draft = { idempotencyKey: id, attemptId: id, legalAcceptanceId: id };
    const abandoned = scenario !== "pending";
    const receipt = { attemptId: id, operation: "checkout", planCode: scenario === "wrong-purchase" ? "other" : "professional",
      planPriceCode: "monthly", abandoned, status: abandoned ? "rejected" : "ready", statusFresh: scenario !== "stale-abandonment",
      checkoutStatus: abandoned ? "cancelled" : "created", subscriptionStatus: abandoned ? "cancelled" : "pending" };
    const calls: string[] = [];
    const storage = new Map([[`balanz:billing-checkout:v1:${id}:${id}:professional:monthly:new`, JSON.stringify(draft)]]);
    const saved: Array<{ idempotencyKey: string; attemptId?: string }> = [];
    const redirects: string[] = [];
    let stateIndex = 0;
    const exports: { BillingCheckoutAction?: (props: unknown) => unknown } = {};
    const source = readFileSync(resolve(__dirname, "../../../src/features/billing/billing-checkout-action.tsx"), "utf8");
    const approvalUrl = "https://www.sandbox.paypal.com/approve?token=new";
    runInNewContext(transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, jsx: JsxEmit.ReactJSX } }).outputText, {
      exports, AbortController, queueMicrotask,
      window: { location: { assign: (url: string) => redirects.push(url) } },
      sessionStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, raw: string) => { storage.set(key, raw); if (key.startsWith("balanz:billing-checkout:")) saved.push(JSON.parse(raw)); },
      },
      require: (name: string) => {
        if (name === "react") return {
          useState: (initial: unknown) => { const index = stateIndex++; return [index === 0 ? draft : index === 1 ? true : index === 2 && terminalView ? receipt : initial, () => undefined]; },
          useCallback: (fn: unknown) => fn, useRef: () => ({ current: null }), useEffect: (fn: () => unknown) => effects.push(fn),
        };
        if (name === "./api") return {
          getCheckoutAttempt: async () => {
            calls.push("get-old");
            if (lateRecovery && calls.length === 1) return new Promise(resolve => { releaseOld = () => resolve(receipt); });
            return receipt;
          },
          createCheckoutAttempt: async (payload: typeof input) => {
            calls.push("create-new");
            createdKey = payload.idempotencyKey;
            assert.notEqual(createdKey, id);
            assert.equal(payload.legalAcceptanceId, id);
            assert.equal(payload.planCode, "professional");
            assert.equal(payload.planPriceCode, "monthly");
            return { ...receipt, attemptId: createdKey, abandoned: false, status: "ready", checkoutStatus: "created", subscriptionStatus: "pending", checkoutUrl: approvalUrl };
          },
          retryCheckoutAttempt: async (attemptId: string) => {
            calls.push("retry-old"); assert.equal(attemptId, id);
            return { ...receipt, checkoutUrl: approvalUrl };
          },
        };
        if (name === "./checkout-recovery") return recovery;
        if (name === "@/lib/api-client") return { ApiError };
        if (name === "@/components/ui/button") return { Button: "button" };
        if (name === "react/jsx-runtime") return jsxRuntime;
        throw new Error(name);
      },
    });
    type Element = { type?: string; props?: { children?: unknown; onClick?: () => void } };
    function button(node: unknown): Element | undefined {
      if (Array.isArray(node)) return node.map(button).find(Boolean);
      if (!node || typeof node !== "object") return;
      const el = node as Element;
      return el.type === "button" ? el : button(el.props?.children);
    }
    const tree = exports.BillingCheckoutAction!({ organizationId: id, userId: id, planCode: "professional", planPriceCode: "monthly",
      legalAcceptanceId: id, startImmediately: false, onReviewQuote: () => { quotesReviewed++; } });
    if (lateRecovery) {
      effects[1]();
      await new Promise<void>(resolve => setImmediate(resolve));
    }
    assert.deepEqual(calls, lateRecovery ? ["get-old"] : []);
    button(tree)?.props?.onClick?.();
    await new Promise<void>(resolve => setImmediate(resolve));
    if (lateRecovery) {
      assert.ok(releaseOld);
      releaseOld();
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(saved.length, 3);
    }
    assert.deepEqual(calls, lateRecovery ? ["get-old", "get-old", "create-new"] : replacing ? terminalView ? ["get-old"] : ["get-old", "create-new"] : scenario === "pending" ? ["get-old", "retry-old"] : ["get-old"]);
    if (replacing) {
      assert.notEqual(saved[saved.length - 1]?.idempotencyKey, id);
      assert.equal(saved[saved.length - 1]?.attemptId, terminalView ? undefined : createdKey);
    } else assert.ok(saved.every(value => value.idempotencyKey === id));
    assert.equal(quotesReviewed, 0);
    assert.deepEqual(redirects, (!terminalView && replacing) || scenario === "pending" ? [approvalUrl] : []);
  });
}

}

for (const query of [
  { token: "order-token", PayerID: "buyer" },
  { token: "subscription-token", subscription_id: "I-SANDBOX" },
  {},
  { subscription_id: "I-SANDBOX" },
]) {
  test(`PayPal return recognizes subscription approval for status polling only ${JSON.stringify(query)}`, async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const { runInNewContext } = await import("node:vm");
    const { transpileModule, ModuleKind, JsxEmit } = await import("typescript");
    const jsxRuntime = await import("react/jsx-runtime");
    const exports: { default?: (props: unknown) => Promise<{ props: { attemptId: string; cancelled: boolean; returnedFromPayment: boolean } }> } = {};
    const source = readFileSync(resolve(__dirname, "../../../src/app/[lang]/(private)/organizations/[organizationSlug]/checkout/success/page.tsx"), "utf8");
    runInNewContext(transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, jsx: JsxEmit.ReactJSX } }).outputText, {
      exports,
      require: (name: string) => {
        if (name === "next/navigation") return { notFound: () => assert.fail("valid attempt") };
        if (name === "@/features/billing/billing-checkout-return") return { BillingCheckoutReturn: "return" };
        if (name === "react/jsx-runtime") return jsxRuntime;
        throw new Error(name);
      },
    });
    const page = await exports.default!({ searchParams: Promise.resolve({ attemptId: id, ...query }) });
    assert.equal(page.props.attemptId, id);
    assert.equal(page.props.cancelled, false);
    assert.equal(page.props.returnedFromPayment, "token" in query);
  });
}

for (const scenario of ["purchase", "upgrade", "downgrade", "restoring", "cancelled-change", "stale-cancellation", "failed-change"] as const) {
  test(`return page preserves each payment outcome without mixing cancelled quotes (${scenario})`, async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const { runInNewContext } = await import("node:vm");
    const { transpileModule, ModuleKind, JsxEmit } = await import("typescript");
    const jsxRuntime = await import("react/jsx-runtime");
    const recovery = await import("./checkout-recovery");
    const money = await import("../cfdi/exact-decimal");
    const completed = scenario === "purchase" || scenario === "upgrade";
    const cancellation = ["restoring", "cancelled-change", "stale-cancellation"].includes(scenario);
    const change = { state: scenario === "upgrade" ? "effective" : scenario === "downgrade" ? "scheduled" : scenario === "restoring" ? "awaiting_approval" : "failed",
      kind: scenario === "downgrade" ? "downgrade" : "upgrade", cancellationRequested: cancellation, effectiveAt: "2026-11-26T10:00:00Z", action: scenario === "restoring" ? "approve_subscription" : "none",
      amountDueNow: "0.00", recurringAmount: "499.00", currency: "MXN", nextBillingAt: "2026-11-26T10:00:00Z" };
    const saved = { attemptId: id, operation: scenario === "purchase" ? "checkout" : "change_plan", status: "ready",
      statusFresh: scenario !== "stale-cancellation", subscriptionId: id, subscriptionStatus: "active", planCode: "professional", planPriceCode: "monthly",
      ...(scenario === "purchase" ? {} : { planChange: change }) };
    const states: unknown[] = [saved,
      completed ? { active: true, source: "billing", subscriptionId: id, planCode: "professional", renewalAt: "2026-11-26T10:00:00Z" } : undefined,
      [{ code: "professional", name: "Profesional", prices: [{ code: "monthly", amount: "499.00", currency: "MXN" }], features: [] }]];
    let stateIndex = 0;
    const calls: string[] = [];
    const exports: { BillingCheckoutReturn?: (props: unknown) => unknown } = {};
    const source = readFileSync(resolve(__dirname, "../../../src/features/billing/billing-checkout-return.tsx"), "utf8");
    runInNewContext(transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, jsx: JsxEmit.ReactJSX } }).outputText, {
      exports, AbortController, URLSearchParams,
      require: (name: string) => {
        if (name === "react") return { useState: (initial: unknown) => [stateIndex < states.length ? states[stateIndex++] : (stateIndex++, initial), () => undefined], useEffect: () => undefined, useRef: () => ({ current: null }) };
        if (name === "./checkout-recovery") return recovery;
        if (name === "./api") return new Proxy({}, { get: (_, key) => () => { calls.push(String(key)); throw new Error("Render must not mutate billing"); } });
        if (name === "@/features/cfdi/exact-decimal") return money;
        if (name === "./billing-plan-format") return { period: () => "Cada mes" };
        if (name === "@/components/accounting-context") return { useAccountingContext: () => ({ organization: { id, slug: "punto-fiscal", name: "Punto Fiscal" }, locale: "es" }) };
        if (name === "@/features/session/session-provider") return { useSession: () => ({ session: { userId: id } }) };
        if (name === "react/jsx-runtime") return jsxRuntime;
        return new Proxy({}, { get: (_, key) => String(key) });
      },
    });
    const content = JSON.stringify(exports.BillingCheckoutReturn!({ attemptId: id, cancelled: false, returnedFromPayment: true }));
    assert.deepEqual(calls, []);
    if (scenario === "cancelled-change") {
      for (const text of ["Cambio de plan cancelado", "Resumen del cambio cancelado", "tu plan actual se conserva", "No necesitas volver a pagar", "Ver mi suscripción"]) assert.ok(content.includes(text), text);
      for (const text of ["Pago no completado", "Precio de catálogo", "Próximo cobro", "Pago único por el cambio", "Retomar pago", "Cerrar no cancela el intento", "499.00"]) assert.ok(!content.includes(text), text);
    } else if (completed) {
      assert.ok(content.includes("Tu suscripción está activa"));
      assert.ok(content.includes("Suscripción activa"));
    } else if (scenario === "downgrade") {
      assert.ok(content.includes("Tu cambio de plan está programado"));
      assert.ok(content.includes("Próximo cobro"));
      assert.ok(content.includes("No se genera un cobro hoy"));
      assert.ok(!content.includes("Es la diferencia de precio"));
    } else if (scenario === "restoring" || scenario === "stale-cancellation") {
      assert.ok(content.includes("Confirma que quieres conservar tu plan actual"));
      assert.ok(!content.includes("Cambio de plan cancelado"));
      assert.ok(!content.includes("Próximo cobro"));
      assert.ok(!content.includes("Precio de catálogo"));
      assert.ok(!content.includes("Pago no completado"));
      assert.ok(content.includes("Cancelación del cambio pendiente de confirmar"));
    } else {
      assert.ok(content.includes("Pago no completado"));
      assert.ok(!content.includes("Cambio de plan cancelado"));
    }
  });
}

test("resume renewal sends only subscription identity and a stable key, never browser price or date", async () => {
  const { resumeBillingRenewal } = await import("./api");
  const previous = globalThis.fetch;
  const calls: unknown[] = [];
  globalThis.fetch = async (url, init) => { calls.push({ path: new URL(String(url)).pathname, method: init?.method, body: JSON.parse(String(init?.body)) }); return response({ attemptId: id }); };
  try {
    await resumeBillingRenewal(id, id, new AbortController().signal);
    assert.deepEqual(calls, [{ path: "/api/v1/payments/subscription/resume-renewal", method: "POST", body: { idempotencyKey: id, expectedSubscriptionId: id } }]);
  } finally { globalThis.fetch = previous; }
});

for (const state of ["awaiting_approval", "scheduled", "effective", "failed"] as const) {
  test(`renewal result states today zero, future 999, and never offers duplicate payment (${state})`, async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const { runInNewContext } = await import("node:vm");
    const { transpileModule, ModuleKind, JsxEmit } = await import("typescript");
    const jsxRuntime = await import("react/jsx-runtime");
    const recovery = await import("./checkout-recovery");
    const management = await import("./subscription-management");
    const money = await import("../cfdi/exact-decimal");
    const exports: { BillingRenewalResumeResult?: (props: unknown) => unknown } = {};
    const source = readFileSync(resolve(__dirname, "../../../src/features/billing/billing-renewal-resume.tsx"), "utf8");
    runInNewContext(transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, jsx: JsxEmit.ReactJSX } }).outputText, {
      exports,
      require: (name: string) => {
        if (name === "./checkout-recovery") return recovery;
        if (name === "./subscription-management") return management;
        if (name === "@/features/cfdi/exact-decimal") return money;
        if (name === "react/jsx-runtime") return jsxRuntime;
        return new Proxy({}, { get: (_, key) => String(key) });
      },
    });
    const attempt = { attemptId: id, operation: "resume_renewal", statusFresh: true, subscriptionStatus: "pending", checkoutUrl: "https://www.sandbox.paypal.com/approve",
      renewalResume: { state, sourceSubscriptionId: id, effectiveAt: "2026-11-26T10:00:00Z", amountDueNow: "0.00", recurringAmount: "999.00", currency: "MXN" } };
    const content = JSON.stringify(exports.BillingRenewalResumeResult!({ attempt, planName: "Despacho", plansHref: "/es/plans", cancelled: false, checking: false, onRefresh: () => undefined, error: state === "awaiting_approval" ? "No se pudo consultar la renovación" : "" }));
    assert.ok(content.includes("Despacho"));
    assert.ok(!content.includes("Pago no completado"));
    assert.ok(!content.includes("Continuar al pago"));
    if (state === "scheduled") {
      assert.ok(content.includes("Renovación activada"));
      assert.ok(content.includes("26 de noviembre de 2026"));
      assert.ok(content.includes("999.00"));
      assert.ok(content.includes("0.00"));
      assert.ok(!content.includes("Autorizar renovación en PayPal"));
      assert.ok(!content.includes("BillingDiscardCheckout"));
      assert.ok(content.includes("Ver mi suscripción"));
    } else if (state === "effective") {
      assert.ok(content.includes("Renovación iniciada"));
      assert.ok(content.includes("Inicio de la renovación"));
      assert.ok(!content.includes("Próximo cobro"));
      assert.ok(!content.includes("Importe a pagar hoy"));
      assert.ok(!content.includes("Autorizar renovación en PayPal"));
    } else if (state === "awaiting_approval") {
      assert.ok(content.includes("Próximo cobro si autorizas"));
      assert.ok(content.includes("No se pudo consultar la renovación"));
      assert.ok(content.includes("Autorizar renovación en PayPal"));
      assert.ok(content.includes("0.00"));
    } else {
      assert.ok(content.includes("La renovación sigue cancelada"));
      assert.ok(!content.includes("Próximo cobro"));
      assert.ok(!content.includes("Autorizar renovación en PayPal"));
    }
  });
}

for (const priorState of ["failed", "awaiting_approval", "unavailable"] as const) {
  test(`preparing renewal keeps a stable key except for a verified discarded attempt (${priorState})`, async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const { runInNewContext } = await import("node:vm");
    const { transpileModule, ModuleKind, JsxEmit } = await import("typescript");
    const jsxRuntime = await import("react/jsx-runtime");
    const recovery = await import("./checkout-recovery");
    const management = await import("./subscription-management");
    const freshKey = "22222222-2222-4222-8222-222222222222";
    const storageKey = `balanz:resume-renewal:${id}:${id}:${id}`;
    const storage = new Map([[storageKey, id]]);
    const calls: string[] = [];
    const redirects: string[] = [];
    const renewalResume = { state: priorState, sourceSubscriptionId: id, effectiveAt: "2026-11-26T10:00:00Z", amountDueNow: "0.00", recurringAmount: "999.00", currency: "MXN" };
    const prior = { attemptId: id, operation: "resume_renewal", statusFresh: true, checkoutStatus: "cancelled", subscriptionStatus: "cancelled", renewalResume };
    const exports: { BillingResumeRenewal?: (props: unknown) => unknown } = {};
    const source = readFileSync(resolve(__dirname, "../../../src/features/billing/billing-renewal-resume.tsx"), "utf8");
    runInNewContext(transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, jsx: JsxEmit.ReactJSX } }).outputText, {
      exports, AbortController, URLSearchParams, crypto: { randomUUID: () => freshKey },
      window: { location: { assign: (url: string) => redirects.push(url) } },
      sessionStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) },
      require: (name: string) => {
        if (name === "react") return { useState: (initial: unknown) => [initial, () => undefined], useRef: () => ({ current: null }), useEffect: () => undefined };
        if (name === "./checkout-recovery") return recovery;
        if (name === "./subscription-management") return management;
        if (name === "./api") return {
          getCheckoutAttempt: async () => { if (priorState === "unavailable") throw new Error("network"); return prior; },
          resumeBillingRenewal: async (key: string) => { calls.push(key); return { attemptId: key, operation: "resume_renewal", renewalResume: { ...renewalResume, state: "awaiting_approval" } }; },
        };
        if (name === "@/components/accounting-context") return { useAccountingContext: () => ({ organization: { id, slug: "punto-fiscal" }, locale: "es" }) };
        if (name === "@/features/session/session-provider") return { useSession: () => ({ session: { userId: id } }) };
        if (name === "react/jsx-runtime") return jsxRuntime;
        return new Proxy({}, { get: (_, key) => String(key) });
      },
    });
    type Element = { type?: string; props?: { children?: unknown; onClick?: () => void; onClose?: () => void } };
    function find(node: unknown, text: string): Element | undefined {
      if (Array.isArray(node)) return node.map(value => find(value, text)).find(Boolean);
      if (!node || typeof node !== "object") return;
      const el = node as Element;
      return el.type === "Button" && el.props?.children === text ? el : find(el.props?.children, text);
    }
    const tree = exports.BillingResumeRenewal!({ subscription: { id, currentPeriodEnd: renewalResume.effectiveAt } });
    find(tree, "Volver a activar renovación")?.props?.onClick?.();
    find(tree, "Volver")?.props?.onClick?.();
    assert.deepEqual(calls, []);
    const prepare = find(tree, "Preparar renovación");
    assert.ok(prepare);
    prepare.props?.onClick?.();
    prepare.props?.onClick?.();
    await new Promise<void>(resolve => setImmediate(resolve));
    const expectedKey = priorState === "failed" ? freshKey : id;
    assert.deepEqual(calls, [expectedKey]);
    assert.equal(storage.get(storageKey), expectedKey);
    assert.equal(redirects.length, 1);
    assert.ok(redirects[0].endsWith(`attemptId=${expectedKey}`));
    assert.ok(!redirects[0].includes("paypal.com"));
  });
}

test("next renewal change sends only frozen identities and target codes, not an amount or date", async () => {
  const { changeRenewalPlan } = await import("./api");
  const previous = globalThis.fetch;
  const payload = { idempotencyKey: id, expectedSubscriptionId: id, expectedRenewalSubscriptionId: "22222222-2222-4222-8222-222222222222", targetPlanCode: "professional", targetPlanPriceCode: "monthly" };
  const calls: unknown[] = [];
  globalThis.fetch = async (url, init) => { calls.push({ path: new URL(String(url)).pathname, method: init?.method, body: JSON.parse(String(init?.body)) }); return response({ attemptId: id }); };
  try {
    await changeRenewalPlan(payload, new AbortController().signal);
    assert.deepEqual(calls, [{ path: "/api/v1/payments/subscription/change-renewal-plan", method: "POST", body: payload }]);
  } finally { globalThis.fetch = previous; }
});

for (const scenario of ["awaiting", "scheduled", "restoring", "cancelled", "effective"] as const) {
  test(`next renewal result keeps paid access separate from the future plan (${scenario})`, async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const { runInNewContext } = await import("node:vm");
    const { transpileModule, ModuleKind, JsxEmit } = await import("typescript");
    const jsxRuntime = await import("react/jsx-runtime");
    const recovery = await import("./checkout-recovery");
    const management = await import("./subscription-management");
    const money = await import("../cfdi/exact-decimal");
    const exports: { BillingRenewalPlanChangeResult?: (props: unknown) => unknown } = {};
    const source = readFileSync(resolve(__dirname, "../../../src/features/billing/billing-renewal-plan-change.tsx"), "utf8");
    runInNewContext(transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, jsx: JsxEmit.ReactJSX } }).outputText, {
      exports,
      require: (name: string) => {
        if (name === "./checkout-recovery") return recovery;
        if (name === "./subscription-management") return management;
        if (name === "@/features/cfdi/exact-decimal") return money;
        if (name === "react/jsx-runtime") return jsxRuntime;
        return new Proxy({}, { get: (_, key) => String(key) });
      },
    });
    const cancelling = scenario === "cancelled" || scenario === "restoring";
    const state = scenario === "awaiting" || scenario === "restoring" ? "awaiting_approval" : scenario === "cancelled" ? "failed" : scenario;
    const attempt = { attemptId: id, operation: "change_renewal_plan", status: "ready", statusFresh: true, subscriptionStatus: "pending",
      renewalPlanChange: { state, sourceSubscriptionId: id, renewalSubscriptionId: "future", targetPlanCode: "professional", targetPlanPriceCode: "monthly", effectiveAt: "2030-11-26T10:00:00Z", amountDueNow: "0.00", recurringAmount: "499.00", currency: "MXN", cancellationRequested: cancelling, action: ["scheduled", "effective", "failed"].includes(state) ? "none" : "approve_subscription", checkoutUrl: "https://www.sandbox.paypal.com/current-approval" } };
    const content = JSON.stringify(exports.BillingRenewalPlanChangeResult!({ attempt, planName: "Profesional", plansHref: "/es/plans", checking: false, retrying: false, error: "", onRefresh: () => undefined, onRetry: () => undefined }));
    assert.ok(!content.includes("Pago no completado"));
    if (scenario === "scheduled") {
      for (const text of ["Plan de próxima renovación actualizado", "Profesional", "499.00", "0.00", "26 de noviembre de 2030", "Conservas tu plan actual hasta entonces"]) assert.ok(content.includes(text), text);
      assert.ok(!content.includes("Autorizar cambio de renovación en PayPal"));
    } else if (scenario === "awaiting") {
      assert.ok(content.includes("Autorizar cambio de renovación en PayPal"));
      assert.ok(content.includes("Próxima renovación si autorizas"));
    } else if (scenario === "restoring") {
      assert.ok(content.includes("Conservar renovación anterior en PayPal"));
      assert.ok(!content.includes("499.00"));
    } else if (scenario === "cancelled") {
      assert.ok(content.includes("Cambio de renovación cancelado"));
      assert.ok(!content.includes("499.00"));
    } else {
      assert.ok(content.includes("Inicio del nuevo plan"));
      assert.ok(!content.includes("Importe a pagar hoy"));
    }
  });
}

for (const mode of ["normal", "ambiguous", "mismatch"] as const) {
  test(`preparing next renewal requires a click and binds source, future contract, and selected plan (${mode})`, async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const { runInNewContext } = await import("node:vm");
    const { transpileModule, ModuleKind, JsxEmit } = await import("typescript");
    const jsxRuntime = await import("react/jsx-runtime");
    const recovery = await import("./checkout-recovery");
    const management = await import("./subscription-management");
    const money = await import("../cfdi/exact-decimal");
    const newKey = "33333333-3333-4333-8333-333333333333";
    const futureId = "22222222-2222-4222-8222-222222222222";
    const effectiveAt = new Date(Date.now() + 30 * 86400000).toISOString();
    const source = { id, cancelAtPeriodEnd: true, cancellation: { state: "scheduled" }, pendingRenewal: { state: "scheduled", effectiveAt, subscriptionId: futureId } };
    const receipt = { attemptId: newKey, operation: "change_renewal_plan", renewalPlanChange: { sourceSubscriptionId: id,
      renewalSubscriptionId: mode === "mismatch" ? "different" : futureId, targetPlanCode: "professional", targetPlanPriceCode: "monthly" } };
    const calls: unknown[] = [];
    const redirects: string[] = [];
    let reads = 0;
    const exports: { BillingNextRenewalPlan?: (props: unknown) => unknown } = {};
    const script = readFileSync(resolve(__dirname, "../../../src/features/billing/billing-renewal-plan-change.tsx"), "utf8");
    runInNewContext(transpileModule(script, { compilerOptions: { module: ModuleKind.CommonJS, jsx: JsxEmit.ReactJSX } }).outputText, {
      exports, AbortController, URLSearchParams, crypto: { randomUUID: () => newKey }, sessionStorage: { getItem: () => null, setItem: () => undefined },
      require: (name: string) => {
        if (name === "react") return { useState: (initial: unknown) => [initial, () => undefined], useRef: () => ({ current: null }), useEffect: () => undefined };
        if (name === "next/navigation") return { useRouter: () => ({ push: (url: string) => redirects.push(url) }) };
        if (name === "@/lib/api-client") return { ApiError };
        if (name === "./checkout-recovery") return recovery;
        if (name === "./subscription-management") return management;
        if (name === "@/features/cfdi/exact-decimal") return money;
        if (name === "./api") return {
          getCheckoutAttempt: async () => { reads++; if (reads === 1) throw new Error("not-created"); return receipt; },
          changeRenewalPlan: async (input: unknown) => { calls.push(JSON.parse(JSON.stringify(input))); if (mode === "ambiguous") throw new Error("transport"); return receipt; },
        };
        if (name === "@/components/accounting-context") return { useAccountingContext: () => ({ organization: { id, slug: "punto-fiscal" }, locale: "es" }) };
        if (name === "@/features/session/session-provider") return { useSession: () => ({ session: { userId: id } }) };
        if (name === "react/jsx-runtime") return jsxRuntime;
        return new Proxy({}, { get: (_, key) => String(key) });
      },
    });
    type Element = { type?: string; props?: { children?: unknown; onClick?: () => void; onClose?: () => void } };
    function find(node: unknown, label: string): Element | undefined {
      if (Array.isArray(node)) return node.map(value => find(value, label)).find(Boolean);
      if (!node || typeof node !== "object") return;
      const el = node as Element;
      return el.type === "Button" && el.props?.children === label ? el : find(el.props?.children, label);
    }
    const tree = exports.BillingNextRenewalPlan!({ subscription: source, plan: { code: "professional", name: "Profesional" }, price: { code: "monthly", amount: "499.00", currency: "MXN" } });
    find(tree, "Cambiar plan de la próxima renovación")?.props?.onClick?.();
    find(tree, "Volver")?.props?.onClick?.();
    assert.deepEqual(calls, []);
    assert.equal(reads, 0);
    const button = find(tree, "Preparar cambio de renovación");
    assert.ok(button);
    button.props?.onClick?.();
    button.props?.onClick?.();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual(calls, [{ idempotencyKey: newKey, expectedSubscriptionId: id, expectedRenewalSubscriptionId: futureId, targetPlanCode: "professional", targetPlanPriceCode: "monthly" }]);
    assert.equal(redirects.length, mode === "mismatch" ? 0 : 1);
    if (redirects.length) assert.ok(redirects[0].endsWith(`attemptId=${newKey}`));
    assert.equal(source.pendingRenewal.state, "scheduled");
  });
}
