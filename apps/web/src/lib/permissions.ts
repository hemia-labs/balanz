import type { Capability, DemoMembership } from "./accounting-types";

export function permissionMatches(granted: string, required: string) {
  return granted === required;
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
  administrador: "Administrador",
  titular: "Titular",
  responsable: "Contador responsable",
  colaborador: "Colaborador/Auxiliar",
};

const backendRoleLabels: Record<string, string> = {
  owner: "Titular",
  accountant: "Contador responsable",
  collaborator: "Colaborador",
  admin: "Administrador de plataforma",
};

export function labelBackendRole(role: string) {
  return backendRoleLabels[role] ?? role;
}
