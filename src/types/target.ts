export type TargetStatus =
  | 'untested'
  | 'in_progress'
  | 'scanned'
  | 'vulnerable'
  | 'compromised';

export type ScopeAnnotation = 'authorized' | 'excluded';

export type PortProtocol = 'tcp' | 'udp';
export type ServiceState = 'open' | 'filtered' | 'closed';

export interface Port {
  id: string;
  port: number;
  protocol: PortProtocol;
  state: ServiceState;
  service?: string;
  version?: string;
  banner?: string;
  firstSeen: string;
  lastSeen: string;
}

export interface Target {
  id: string;
  ip: string;
  hostname?: string;
  domains: string[];
  os?: string;
  status: TargetStatus;
  scopeAnnotation?: ScopeAnnotation;
  tags: string[];
  ports: Port[];
  services: ServiceInfo[];
  vulnCount: number;
  aiSummary?: string;
  firstSeen: string;
  lastUpdated: string;
}

export interface ServiceInfo {
  port: number;
  protocol: PortProtocol;
  name: string;
  version?: string;
  product?: string;
  extra?: string;
}
