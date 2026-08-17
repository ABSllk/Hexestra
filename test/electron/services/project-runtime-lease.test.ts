import { afterEach, describe, expect, it } from 'vitest';
import {
  acquireProjectRuntimeLease,
  projectRuntimeLeaseCount,
  releaseProjectRuntimeLease,
  isProjectRuntimePinned,
} from '@electron/services/project-runtime-lease';

const projectId = `lease-${Date.now()}`;

afterEach(() => {
  while (projectRuntimeLeaseCount(projectId) > 0) releaseProjectRuntimeLease(projectId);
});

describe('project runtime leases', () => {
  it('keeps a project pinned until its last runtime lease is released', () => {
    expect(isProjectRuntimePinned(projectId)).toBe(false);
    acquireProjectRuntimeLease(projectId);
    acquireProjectRuntimeLease(projectId);
    expect(projectRuntimeLeaseCount(projectId)).toBe(2);
    expect(isProjectRuntimePinned(projectId)).toBe(true);
    releaseProjectRuntimeLease(projectId);
    expect(isProjectRuntimePinned(projectId)).toBe(true);
    releaseProjectRuntimeLease(projectId);
    expect(isProjectRuntimePinned(projectId)).toBe(false);
  });
});
