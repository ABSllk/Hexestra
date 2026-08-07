import { describe, expect, it } from 'vitest';
import type { AssetRecord, GraphEdge, Target } from '@/types';
import {
  buildAgentTargetContext,
  buildDomainProjection,
  LOCAL_NODE_ID,
  projectNetMapNodes,
} from '@/lib/networkGraph';

const now = '2026-07-17T00:00:00.000Z';
const targets: Target[] = [
  {
    id: 'web',
    ip: '10.0.0.10',
    hostname: 'web.local',
    domains: ['web.local'],
    status: 'scanned',
    tags: ['nmap'],
    ports: [{ id: '10.0.0.10:443/tcp', port: 443, protocol: 'tcp', state: 'open', service: 'https', firstSeen: now, lastSeen: now }],
    services: [{ port: 443, protocol: 'tcp', name: 'https' }],
    vulnCount: 1,
    aiSummary: 'Public web entry point.',
    firstSeen: now,
    lastUpdated: now,
  },
  {
    id: 'db',
    ip: '10.0.0.20',
    domains: [],
    status: 'untested',
    tags: ['generic'],
    ports: [],
    services: [],
    vulnCount: 0,
    firstSeen: now,
    lastUpdated: now,
  },
];

const edges: GraphEdge[] = [
  { id: 'local-web', source: LOCAL_NODE_ID, target: 'web', type: 'connected_to' },
  { id: 'web-db', source: 'web', target: 'db', type: 'connected_to', metadata: { tool: 'nmap' } },
];

const domainAsset: AssetRecord = {
  id: 'domain-api',
  key: 'domain:api.example.com',
  type: 'domain',
  label: 'api.example.com',
  status: 'scanned',
  properties: { domain: 'api.example.com' },
  tags: ['subfinder'],
  vulnCount: 0,
  firstSeen: now,
  lastUpdated: now,
};

describe('networkGraph', () => {
  it('always projects a local root before target nodes', () => {
    const nodes = projectNetMapNodes(targets);
    expect(nodes[0]).toMatchObject({ id: LOCAL_NODE_ID, type: 'local' });
    expect(nodes[1]).toMatchObject({ id: 'web', portCount: 1, vulnCount: 1 });
  });

  it('builds selected target, neighborhood, and local attack-path context', () => {
    const nodes = projectNetMapNodes(targets);
    const context = buildAgentTargetContext('db', nodes, edges, targets);

    expect(context?.target).toMatchObject({ id: 'db', ip: '10.0.0.20' });
    expect(context?.neighbors).toEqual([
      expect.objectContaining({ id: 'web', relation: 'connected_to', direction: 'inbound' }),
    ]);
    expect(context?.pathFromLocal.map((node) => node.id)).toEqual([LOCAL_NODE_ID, 'web', 'db']);
  });

  it('shares full service evidence for the selected target', () => {
    const nodes = projectNetMapNodes(targets);
    const context = buildAgentTargetContext('web', nodes, edges, targets);
    expect(context?.target).toMatchObject({
      id: 'web',
      aiSummary: 'Public web entry point.',
      ports: [expect.objectContaining({ port: 443, service: 'https' })],
    });
  });

  it('projects and shares non-host asset context without requiring an IP target', () => {
    const mixedEdges: GraphEdge[] = [
      { id: 'domain-host', source: domainAsset.id, target: 'web', type: 'resolves_to' },
    ];
    const nodes = projectNetMapNodes(targets, [domainAsset]);
    const context = buildAgentTargetContext(domainAsset.id, nodes, mixedEdges, targets, [domainAsset]);

    expect(nodes.find((node) => node.id === domainAsset.id)).toMatchObject({
      type: 'domain', key: domainAsset.key, properties: { domain: 'api.example.com' },
    });
    expect(context?.target).toMatchObject({
      id: domainAsset.id,
      type: 'domain',
      key: domainAsset.key,
      properties: { domain: 'api.example.com' },
    });
    expect(context?.neighbors).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'web', type: 'host', relation: 'resolves_to' }),
    ]));
  });

  it('keeps associated Hosts in the Domain graph and aggregates unrelated Hosts', () => {
    const nodes = projectNetMapNodes(targets, [domainAsset]);
    const relations: GraphEdge[] = [
      { id: 'domain-host', source: domainAsset.id, target: 'web', type: 'resolves_to' },
    ];
    const domain = buildDomainProjection(nodes, relations);

    expect(domain.nodes.map((node) => node.id)).toEqual(expect.arrayContaining([domainAsset.id, 'web']));
    expect(domain.nodes.find((node) => node.virtual)?.label).toBe('UNASSOCIATED HOSTS × 1');
    expect(domain.edges).toContainEqual(relations[0]);
  });
});
