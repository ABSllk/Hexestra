const leases = new Map<string, number>();

export function acquireProjectRuntimeLease(projectId: string) {
  leases.set(projectId, (leases.get(projectId) ?? 0) + 1);
}

export function releaseProjectRuntimeLease(projectId: string) {
  const next = (leases.get(projectId) ?? 0) - 1;
  if (next > 0) leases.set(projectId, next);
  else leases.delete(projectId);
}

export function isProjectRuntimePinned(projectId: string) {
  return (leases.get(projectId) ?? 0) > 0;
}

export function projectRuntimeLeaseCount(projectId: string) {
  return leases.get(projectId) ?? 0;
}
