export type CurrentAccess = {
  active: boolean;
  source: "trial" | "billing" | null;
  planCode: string | null;
  subscriptionId?: string | null;
  renewalAt?: string | null;
  licenseStatus: string | null;
  validUntil: string | null;
  reason: string;
};

export function hasCurrentBillingPlan(access: CurrentAccess | undefined) {
  return Boolean(
    access?.source === "billing" &&
      (access.active || !["revoked", "expired"].includes(access.licenseStatus ?? "")),
  );
}

export function currentPlanName(
  access: CurrentAccess,
  plans?: { code: string; name: string }[],
) {
  if (access.source === "trial")
    return access.active ? "Prueba gratuita" : "Prueba gratuita finalizada";
  if (hasCurrentBillingPlan(access) && access.planCode)
    return (
      plans?.find((plan) => plan.code === access.planCode)?.name ??
      access.planCode
    );
  return access.reason === "trial_expired"
    ? "Prueba gratuita finalizada"
    : "Sin plan contratado";
}

export function currentPlanStatus(access: CurrentAccess) {
  if (access.source === "trial")
    return access.active ? "Período de prueba" : "Prueba finalizada";
  if (access.active) return "Suscripción activa";
  return access.reason === "trial_expired"
    ? "Prueba finalizada"
    : "Sin suscripción vigente";
}

export function planActionLabel(
  access: CurrentAccess | undefined,
  planCode: string,
  selected: boolean,
) {
  if (hasCurrentBillingPlan(access) && access?.planCode === planCode)
    return "Plan actual";
  if (selected) return "Plan seleccionado";
  if (hasCurrentBillingPlan(access)) return "Cambiar plan";
  return access?.source === "trial" ? "Actualizar plan" : "Comenzar";
}
