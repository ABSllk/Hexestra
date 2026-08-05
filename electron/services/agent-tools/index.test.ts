// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createHexestraAgentTools } from './index';
import type { AgentSdk } from './context';

vi.mock('../browser.service', () => ({ browserService: {} }));
vi.mock('../session.service', () => ({ sessionService: {} }));
vi.mock('../shell.service', () => ({ shellService: {} }));
vi.mock('../traffic.service', () => ({ trafficService: {} }));
vi.mock('../sync-targets.service', () => ({ syncTargetsService: {} }));

const expectedToolNames = [
  'browser_tabs', 'browser_read', 'browser_cookies', 'browser_storage', 'browser_evaluate',
  'browser_navigate', 'browser_back', 'browser_forward',
  'browser_reload', 'browser_click', 'browser_type', 'browser_fill', 'browser_press',
  'browser_hover', 'browser_wait', 'browser_screenshot',
  'shell_profiles', 'shell_sessions', 'shell_read', 'shell_audit_list', 'shell_profile_create',
  'shell_profile_trust_host', 'shell_connect', 'shell_listener_create', 'shell_listener_start',
  'shell_listener_stop', 'shell_reverse_bind', 'shell_execute', 'shell_send_input',
  'shell_interrupt', 'shell_disconnect', 'shell_save_evidence',
  'traffic_capture_status', 'traffic_capture_set', 'traffic_list', 'traffic_search',
  'traffic_read', 'traffic_forward', 'traffic_drop', 'traffic_replay', 'traffic_save_evidence',
  'burp_capabilities', 'burp_scanner_issues', 'burp_open_repeater', 'burp_send_intruder',
  'target_list', 'scope_update', 'asset_register', 'target_update_summary',
  'asset_update_summary', 'evidence_list', 'evidence_upsert', 'finding_list', 'finding_upsert',
  'vulnerability_list', 'vulnerability_upsert', 'report_list', 'report_upsert', 'task_list',
  'task_upsert', 'task_update_status',
] as const;

describe('Hexestra Agent tool factories', () => {
  it('preserves the complete ordered tool manifest across domain modules', () => {
    const sdk = {
      tool: (name: string) => ({ name }),
    } as unknown as AgentSdk;
    const tools = createHexestraAgentTools({
      sdk,
      sender: {} as never,
      permissionMode: 'default',
    }) as unknown as Array<{ name: string }>;

    expect(tools.map(({ name }) => name)).toEqual(expectedToolNames);
    expect(new Set(tools.map(({ name }) => name)).size).toBe(tools.length);
  });
});
