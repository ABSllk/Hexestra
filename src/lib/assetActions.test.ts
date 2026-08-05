import { describe, expect, it } from 'vitest';
import type { GraphNode, Target } from '@/types';
import { assetBrowserUrl, assetJsonPayload, assetPrimaryValue, buildAssetRescanPlan } from './assetActions';

const now = '2026-08-06T00:00:00.000Z';
const node: GraphNode = { id: 'host-1', label: 'scanner.example.com', type: 'host', status: 'scanned', ip: '192.0.2.10', portCount: 1, vulnCount: 0 };
const target: Target = {
  id: node.id,
  ip: node.ip!,
  hostname: node.label,
  domains: [node.label],
  status: 'scanned',
  tags: [],
  vulnCount: 0,
  firstSeen: now,
  lastUpdated: now,
  ports: [{ id: 'https', port: 8443, protocol: 'tcp', state: 'open', service: 'https', firstSeen: now, lastSeen: now }],
  services: [{ port: 8443, protocol: 'tcp', name: 'https' }],
};

describe('asset actions', () => {
  it('derives primary values and browser URLs from targets and assets', () => {
    expect(assetPrimaryValue(node, target)).toBe('192.0.2.10');
    expect(assetBrowserUrl(node, target)).toBe('https://scanner.example.com:8443/');
    expect(assetBrowserUrl({ ...node, ip: '192.0.2.11' })).toBeUndefined();
  });

  it('prefers exact asset URLs and preserves the JSON source record', () => {
    const asset = {
      id: 'web-1', key: 'web:https://app.example.com', type: 'webapp' as const, label: 'app.example.com', status: 'scanned' as const,
      properties: { url: 'https://app.example.com/login' }, tags: [], vulnCount: 0, firstSeen: now, lastUpdated: now,
    };
    expect(assetBrowserUrl({ ...node, id: asset.id, type: 'webapp' }, undefined, asset)).toBe('https://app.example.com/login');
    expect(assetJsonPayload(node, target)).toBe(target);
    expect(assetJsonPayload(node, undefined, asset)).toBe(asset);
  });

  it('builds the shared rescan task and prompt', () => {
    const plan = buildAssetRescanPlan(node, target, { inScope: ['example.com'], outOfScope: [], targets: [] });
    expect(plan.task).toEqual({ id: 'asm-rescan-host-1', stage: 'S2', title: 'Rescan scanner.example.com', status: 'in_progress' });
    expect(plan.message).toContain('project Scope');
  });
});
