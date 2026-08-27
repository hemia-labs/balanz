import type { Capability, DemoMembership } from "./accounting-types";

export function permissionMatches(granted: string, required: string) {
  if (granted === "*.*" || granted === required) return true;
  const [grantedResource, grantedAction] = granted.split(".");
  const [requiredResource] = required.split(".");
  return grantedAction === "*" && grantedResource === requiredResource;
}

export function hasCapability(
  capabilities: readonly string[],
  required?: Capability,
) {
  return (
    !required ||
    capabilities.some((granted) => permissionMatches(granted, required))
  );
}

export function hasAllCapabilities(
  capabilities: readonly string[],
  required: readonly Capability[],
) {
  return required.every((capability) =>
    hasCapability(capabilities, capability),
  );
}

export function canAccessClient(membership: DemoMembership, clientId: string) {
  return membership.assignedClientIds.includes(clientId);
}

export const roleLabels: Record<DemoMembership["role"], string> = {
  titular: "Titular",
  responsable: "Contador responsable",
  colaborador: "Colaborador/Auxiliar",
};
