import { describe, expect, it } from 'vitest';
import type { Target } from '@/types';
import { listOpenPorts } from './targetPresentation';

const now = '2026-07-17T00:00:00.000Z';

function createTarget(overrides: Partial<Target> = {}): Target {
  return {
    id: 'web',
    ip: '192.0.2.10',
    domains: [],
    status: 'scanned',
    tags: [],
    ports: [],
    services: [],
    vulnCount: 0,
    firstSeen: now,
    lastUpdated: now,
    ...overrides,
  };
}

describe('listOpenPorts', () => {
  it('lists only open ports in numeric order', () => {
    const target = createTarget({
      ports: [
        { id: '443', port: 443, protocol: 'tcp', state: 'open', service: 'https', firstSeen: now, lastSeen: now },
        { id: '22', port: 22, protocol: 'tcp', state: 'closed', service: 'ssh', firstSeen: now, lastSeen: now },
        { id: '80', port: 80, protocol: 'tcp', state: 'open', service: 'http', firstSeen: now, lastSeen: now },
      ],
    });

    expect(listOpenPorts(target).map((port) => port.endpoint)).toEqual(['80/tcp', '443/tcp']);
  });

  it('uses service inventory details when port evidence is sparse', () => {
    const target = createTarget({
      ports: [
        { id: '5432', port: 5432, protocol: 'tcp', state: 'open', firstSeen: now, lastSeen: now },
      ],
      services: [
        {
          port: 5432,
          protocol: 'tcp',
          name: 'postgresql',
          product: 'PostgreSQL',
          version: '16.3',
          extra: 'Ubuntu',
        },
      ],
    });

    expect(listOpenPorts(target)[0]).toMatchObject({
      endpoint: '5432/tcp',
      service: 'postgresql',
      serviceDetail: 'PostgreSQL 16.3 Ubuntu',
    });
  });

  it('prefers fresh service and version evidence stored on the port', () => {
    const target = createTarget({
      ports: [
        {
          id: '80',
          port: 80,
          protocol: 'tcp',
          state: 'open',
          service: 'http',
          version: 'nginx 1.24',
          firstSeen: now,
          lastSeen: now,
        },
      ],
      services: [{ port: 80, protocol: 'tcp', name: 'www', version: 'old' }],
    });

    expect(listOpenPorts(target)[0]).toMatchObject({ service: 'http', serviceDetail: 'nginx 1.24' });
  });
});
