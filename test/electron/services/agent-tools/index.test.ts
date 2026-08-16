// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createHexestraAgentTools } from '@electron/services/agent-tools';

vi.mock('@electron/services/browser.service', () => ({ browserService: {} }));
vi.mock('@electron/services/session.service', () => ({ sessionService: {} }));
vi.mock('@electron/services/shell.service', () => ({ shellService: {} }));
vi.mock('@electron/services/traffic.service', () => ({ trafficService: {} }));
vi.mock('@electron/services/egress-proxy.service', () => ({ egressProxyService: {} }));
vi.mock('@electron/services/sync-targets.service', () => ({ syncTargetsService: {} }));

const expectedToolNames = [
  'browser_tabs', 'browser_read', 'browser_cookies', 'browser_storage', 'browser_evaluate',
  'browser_navigate', 'browser_back', 'browser_forward',
  'browser_reload', 'browser_click', 'browser_type', 'browser_fill', 'browser_press',
  'browser_hover', 'browser_wait', 'browser_screenshot',
  'shell_profiles', 'shell_sessions', 'shell_read', 'shell_file_list', 'shell_file_read',
  'shell_file_write', 'shell_file_mkdir', 'shell_file_rename', 'shell_file_delete_preview',
  'shell_file_delete', 'shell_file_upload', 'shell_file_download', 'shell_audit_list', 'shell_profile_create',
  'shell_profile_trust_host', 'shell_connect', 'shell_listener_create', 'shell_listener_start',
  'shell_listener_stop', 'shell_reverse_bind', 'shell_execute', 'shell_send_input',
  'shell_interrupt', 'shell_disconnect', 'shell_save_evidence',
  'shell_profile_status', 'shell_profile_verify',
  'traffic_capture_status', 'traffic_capture_set', 'traffic_list', 'traffic_search',
  'traffic_read', 'traffic_forward', 'traffic_drop', 'traffic_replay', 'traffic_save_evidence',
  'burp_capabilities', 'burp_scanner_issues', 'burp_open_repeater', 'burp_send_intruder',
  'proxy_status', 'proxy_nodes_list', 'proxy_node_import', 'proxy_nodes_import', 'proxy_node_update',
  'proxy_node_delete', 'proxy_nodes_test', 'proxy_chains_list', 'proxy_chain_test',
  'proxy_chain_save', 'proxy_chain_delete', 'proxy_chain_activate', 'proxy_enforcement_set',
  'proxy_runtime_start', 'proxy_runtime_stop',
  'target_list', 'asset_get', 'scope_update', 'asset_register', 'asset_relation_upsert', 'target_update_summary',
  'asset_update_summary', 'evidence_list', 'evidence_upsert', 'finding_list', 'finding_upsert',
  'vulnerability_list', 'vulnerability_upsert', 'report_list', 'report_upsert', 'task_list',
  'task_upsert', 'task_update_status',
] as const;

describe('Hexestra Agent tool factories', () => {
  it('preserves the complete ordered tool manifest across domain modules', () => {
    const tools = createHexestraAgentTools({
      sender: {} as never,
      permissionMode: 'default',
    }) as unknown as Array<{ name: string }>;

    expect(tools.map(({ name }) => name)).toEqual(expectedToolNames);
    expect(new Set(tools.map(({ name }) => name)).size).toBe(tools.length);
  });

  it('publishes independent fine-grained asset schemas and the immediate read-back contract', () => {
    const tools = createHexestraAgentTools({ sender: {} as never, permissionMode: 'default' });
    const register = tools.find((tool) => tool.name === 'asset_register')!;
    const schema = z.object(register.inputSchema);
    const assets = [
      { type: 'host', ip: '2001:db8::1' },
      { type: 'domain', domain: 'api.example.com' },
      { type: 'subnet', cidr: '2001:db8::/32' },
      { type: 'port', hostAssetId: 'host-id', port: 443, protocol: 'tcp' },
      { type: 'service', portAssetId: 'port-id', name: 'https' },
      { type: 'webapp', url: 'https://example.com/' },
      { type: 'api', baseUrl: 'https://example.com/v1', webAppAssetId: 'webapp-id' },
      { type: 'endpoint', apiAssetId: 'api-id', method: 'GET', path: '/users/123' },
      { type: 'parameter', endpointAssetId: 'endpoint-id', location: 'path', name: 'id' },
      { type: 'certificate', fingerprintSha256: 'A'.repeat(64) },
      { type: 'identity', provider: 'oidc', realm: 'example', principal: 'alice' },
    ];
    for (const asset of assets) expect(() => schema.parse({ assets: [asset] })).not.toThrow();
    expect(() => schema.parse({ assets: [{ type: 'port', port: 443 }] })).toThrow();
    expect(() => schema.parse({ assets: [{ type: 'endpoint', method: 'GET', path: '/' }] })).toThrow();
    expect(register.description).toContain('exactly one confirmed asset');
    expect(register.description).toContain('immediately call asset_get');
    expect(tools.find((tool) => tool.name === 'asset_get')).toMatchObject({ riskLevel: 'read' });
    expect(tools.find((tool) => tool.name === 'asset_relation_upsert')?.description).toContain('child to parent');
  });

});
