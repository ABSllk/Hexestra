import { describe, expect, it } from 'vitest';
import {
  isManagedRecordFileMutation,
  isReadOnlyHexestraTool,
  sanitizeAgentToolInputForDisplay,
  sanitizeAgentToolOutputForDisplay,
} from '@electron/services/agent-tool-policy';

describe('Agent tool policy', () => {
  it('classifies Hexestra list operations as read-only', () => {
    expect(isReadOnlyHexestraTool('browser_tabs')).toBe(true);
    expect(isReadOnlyHexestraTool('browser_read')).toBe(true);
    expect(isReadOnlyHexestraTool('browser_screenshot')).toBe(true);
    expect(isReadOnlyHexestraTool('browser_cookies')).toBe(true);
    expect(isReadOnlyHexestraTool('browser_storage')).toBe(true);
    expect(isReadOnlyHexestraTool('target_list')).toBe(true);
    expect(isReadOnlyHexestraTool('asset_get')).toBe(true);
    expect(isReadOnlyHexestraTool('finding_list')).toBe(true);
    expect(isReadOnlyHexestraTool('vulnerability_list')).toBe(true);
    expect(isReadOnlyHexestraTool('evidence_list')).toBe(true);
    expect(isReadOnlyHexestraTool('report_list')).toBe(true);
    expect(isReadOnlyHexestraTool('attack_catalog_list')).toBe(true);
    expect(isReadOnlyHexestraTool('attack_catalog_search')).toBe(true);
    expect(isReadOnlyHexestraTool('task_list')).toBe(true);
    expect(isReadOnlyHexestraTool('traffic_capture_status')).toBe(true);
    expect(isReadOnlyHexestraTool('shell_profile_status')).toBe(true);
    expect(isReadOnlyHexestraTool('shell_file_list')).toBe(true);
    expect(isReadOnlyHexestraTool('shell_file_read')).toBe(true);
    expect(isReadOnlyHexestraTool('shell_file_delete_preview')).toBe(true);
    expect(isReadOnlyHexestraTool('proxy_status')).toBe(true);
    expect(isReadOnlyHexestraTool('proxy_nodes_list')).toBe(true);
    expect(isReadOnlyHexestraTool('proxy_chains_list')).toBe(true);
  });

  it('keeps graph, task, and Finding mutations state-changing', () => {
    expect(isReadOnlyHexestraTool('browser_click')).toBe(false);
    expect(isReadOnlyHexestraTool('browser_type')).toBe(false);
    expect(isReadOnlyHexestraTool('browser_fill')).toBe(false);
    expect(isReadOnlyHexestraTool('browser_back')).toBe(false);
    expect(isReadOnlyHexestraTool('browser_forward')).toBe(false);
    expect(isReadOnlyHexestraTool('browser_reload')).toBe(false);
    expect(isReadOnlyHexestraTool('browser_evaluate')).toBe(false);
    expect(isReadOnlyHexestraTool('asset_register')).toBe(false);
    expect(isReadOnlyHexestraTool('asset_relation_upsert')).toBe(false);
    expect(isReadOnlyHexestraTool('finding_upsert')).toBe(false);
    expect(isReadOnlyHexestraTool('vulnerability_upsert')).toBe(false);
    expect(isReadOnlyHexestraTool('task_update_status')).toBe(false);
    expect(isReadOnlyHexestraTool('scope_update')).toBe(false);
    expect(isReadOnlyHexestraTool('traffic_capture_set')).toBe(false);
    expect(isReadOnlyHexestraTool('proxy_chain_test')).toBe(false);
    expect(isReadOnlyHexestraTool('proxy_chain_activate')).toBe(false);
    expect(isReadOnlyHexestraTool('proxy_node_import')).toBe(false);
    expect(isReadOnlyHexestraTool('proxy_nodes_import')).toBe(false);
    expect(isReadOnlyHexestraTool('proxy_node_update')).toBe(false);
    expect(isReadOnlyHexestraTool('proxy_node_delete')).toBe(false);
    expect(isReadOnlyHexestraTool('proxy_nodes_test')).toBe(false);
    expect(isReadOnlyHexestraTool('proxy_chain_delete')).toBe(false);
    expect(isReadOnlyHexestraTool('proxy_enforcement_set')).toBe(false);
    expect(isReadOnlyHexestraTool('proxy_runtime_stop')).toBe(false);
    expect(isReadOnlyHexestraTool('shell_file_write')).toBe(false);
    expect(isReadOnlyHexestraTool('shell_file_mkdir')).toBe(false);
    expect(isReadOnlyHexestraTool('shell_file_rename')).toBe(false);
    expect(isReadOnlyHexestraTool('shell_file_delete')).toBe(false);
    expect(isReadOnlyHexestraTool('shell_file_upload')).toBe(false);
    expect(isReadOnlyHexestraTool('shell_file_download')).toBe(false);
  });

  it('redacts write-only proxy node values before approval display', () => {
    const input = {
      nodeId: 'node-1', source: 'form', name: 'Exit',
      value: { type: 'trojan', password: 'renderer-must-not-see-this' },
      unexpected: 'also-hide-unrecognized-fields',
    };
    const displayed = sanitizeAgentToolInputForDisplay('mcp__hexestra__proxy_node_update', input);

    expect(displayed).toEqual({
      nodeId: 'node-1', source: 'form', name: 'Exit', value: '[REDACTED]',
    });
    expect(input.value.password).toBe('renderer-must-not-see-this');

    expect(sanitizeAgentToolInputForDisplay('mcp__hexestra__proxy_nodes_import', {
      value: 'trojan://batch-secret@192.0.2.1:443',
    })).toEqual({ value: '[REDACTED]' });
  });

  it('blocks direct file-tool writes to managed security records', () => {
    expect(isManagedRecordFileMutation('Write', { file_path: 'evidence/scan.txt' })).toBe(true);
    expect(isManagedRecordFileMutation('Edit', { file_path: '/mnt/d/project/reports/final.md' })).toBe(true);
    expect(isManagedRecordFileMutation('Write', { file_path: 'notes/scan.txt' })).toBe(false);
    expect(isManagedRecordFileMutation('Bash', { command: 'echo test' })).toBe(false);
  });

  it('replaces remote file contents with length and hash in approval display', () => {
    const displayed = sanitizeAgentToolInputForDisplay('shell_file_write', {
      projectId: 'project-1', sessionId: 'ssh-1', remotePath: '/tmp/secret.txt',
      content: 'do not persist this body', encoding: 'utf8',
    });
    expect(displayed).toMatchObject({ projectId: 'project-1', remotePath: '/tmp/secret.txt' });
    expect(displayed.content).toMatch(/^\[\d+ bytes; sha256:[a-f0-9]{64}\]$/);
  });

  it('redacts remote file bodies from persisted tool output while retaining metadata', () => {
    const displayed = sanitizeAgentToolOutputForDisplay('shell_file_read', JSON.stringify({
      path: '/tmp/secret.txt', content: 'do not persist this body', encoding: 'utf8', size: 23,
    }));
    expect(displayed).not.toContain('do not persist this body');
    expect(displayed).toContain('sha256:');
    expect(JSON.parse(displayed)).toMatchObject({ path: '/tmp/secret.txt', size: 23 });
  });
});
