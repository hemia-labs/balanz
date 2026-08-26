import type { Capability, DemoMembership } from "./accounting-types";

export function hasCapability(
  capabilities: readonly Capability[],
  required?: Capability,
) {
  return !required || capabilities.includes(required);
}

export function hasAllCapabilities(
  capabilities: readonly Capability[],
  required: readonly Capability[],
) {
  return required.every((capability) => capabilities.includes(capability));
}

export function canAccessClient(membership: DemoMembership, clientId: string) {
  return membership.assignedClientIds.includes(clientId);
}

export const roleLabels: Record<DemoMembership["role"], string> = {
  titular: "Titular",
  responsable: "Contador responsable",
  colaborador: "Colaborador/Auxiliar",
};
