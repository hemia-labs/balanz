import { apiClientResponse, ApiError } from "../../lib/api-client";
/** Two authenticated calls; no persisted retry body or one-time grant. */
export async function submitSatAuthorization(
  jobId: string,
  body: FormData,
  signal: AbortSignal,
): Promise<void> {
  let grant = "";
  try {
    const issued = await apiClientResponse<{ grant: string }>(
      "/sat-download-jobs/" + jobId + "/reauth-grants",
      {
        method: "POST",
        body: JSON.stringify({ code: body.get("code") }),
        signal,
        cache: "no-store",
      },
    );
    grant = issued.data.grant;
    if (!/^[0-9a-f]{64}$/.test(grant))
      throw new ApiError(
        502,
        "La autorización no se pudo verificar.",
        "INVALID_API_RESPONSE",
      );
    body.delete("code");
    body.set("grant", grant);
    const result = await apiClientResponse<{ processId: string }>(
      "/sat-download-jobs/" + jobId + "/authorizations",
      {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body,
        signal,
        cache: "no-store",
      },
      30000,
    );
    if (result.status !== 202 || result.data.processId !== jobId)
      throw new ApiError(
        502,
        "No se confirmó la autorización del proceso.",
        "INVALID_API_RESPONSE",
      );
  } finally {
    grant = "";
    for (const name of ["code", "grant", "password", "key", "certificate"])
      body.delete(name);
  }
}
