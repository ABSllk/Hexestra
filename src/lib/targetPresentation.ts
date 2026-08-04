import type { Target } from '@/types';

export interface OpenPortPresentation {
  id: string;
  port: number;
  protocol: string;
  endpoint: string;
  state: string;
  service: string;
  serviceDetail?: string;
}

export function listOpenPorts(target: Target): OpenPortPresentation[] {
  return target.ports
    .filter((port) => port.state === 'open')
    .map((port) => {
      const service = target.services.find(
        (candidate) => candidate.port === port.port && candidate.protocol === port.protocol,
      );
      const serviceName = port.service?.trim() || service?.name?.trim() || 'unknown service';
      const serviceDetail = uniqueParts([
        service?.product,
        port.version || service?.version,
        service?.extra,
      ]).join(' ');

      return {
        id: port.id,
        port: port.port,
        protocol: port.protocol,
        endpoint: `${port.port}/${port.protocol}`,
        state: port.state,
        service: serviceName,
        serviceDetail: serviceDetail || undefined,
      };
    })
    .sort((left, right) => left.port - right.port || left.protocol.localeCompare(right.protocol));
}

function uniqueParts(parts: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  return parts.flatMap((part) => {
    const value = part?.trim();
    if (!value || seen.has(value.toLowerCase())) return [];
    seen.add(value.toLowerCase());
    return [value];
  });
}
