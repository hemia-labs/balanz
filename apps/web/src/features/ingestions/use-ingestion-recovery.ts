"use client";

import { useCallback, useEffect, useState } from "react";
import {
  INGESTION_RECOVERY_EVENT,
  readIngestionRecovery,
  type IngestionRecoveryScope,
} from "./recovery-store";

export function useIngestionRecovery(scope: IngestionRecoveryScope) {
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  const [state, setState] = useState<{
    identity: string;
    recovery: ReturnType<typeof readIngestionRecovery>;
  }>({ identity: "", recovery: null });
  const { organizationId, clientAccountId, legalEntityId } = scope;
  const identity = `${organizationId}:${clientAccountId}:${legalEntityId}`;
  useEffect(() => {
    const currentScope = { organizationId, clientAccountId, legalEntityId };
    const update = () =>
      setState({ identity, recovery: readIngestionRecovery(currentScope) });
    update();
    window.addEventListener(INGESTION_RECOVERY_EVENT, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(INGESTION_RECOVERY_EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, [clientAccountId, identity, legalEntityId, organizationId, revision]);
  return {
    recovery: state.identity === identity ? state.recovery : null,
    refresh,
  };
}
