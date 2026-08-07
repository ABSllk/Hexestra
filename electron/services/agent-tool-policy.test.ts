import { describe, expect, it } from 'vitest';
import { isManagedRecordFileMutation, isReadOnlyHexestraTool } from './agent-tool-policy';

describe('Agent tool policy', () => {
  it('classifies Hexestra list operations as read-only', () => {
    expect(isReadOnlyHexestraTool('browser_tabs')).toBe(true);
    expect(isReadOnlyHexestraTool('browser_read')).toBe(true);
    expect(isReadOnlyHexestraTool('browser_screenshot')).toBe(true);
    expect(isReadOnlyHexestraTool('browser_cookies')).toBe(true);
    expect(isReadOnlyHexestraTool('browser_storage')).toBe(true);
    expect(isReadOnlyHexestraTool('target_list')).toBe(true);
    expect(isReadOnlyHexestraTool('finding_list')).toBe(true);
    expect(isReadOnlyHexestraTool('vulnerability_list')).toBe(true);
    expect(isReadOnlyHexestraTool('evidence_list')).toBe(true);
    expect(isReadOnlyHexestraTool('report_list')).toBe(true);
    expect(isReadOnlyHexestraTool('task_list')).toBe(true);
    expect(isReadOnlyHexestraTool('traffic_capture_status')).toBe(true);
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
    expect(isReadOnlyHexestraTool('finding_upsert')).toBe(false);
    expect(isReadOnlyHexestraTool('vulnerability_upsert')).toBe(false);
    expect(isReadOnlyHexestraTool('task_update_status')).toBe(false);
    expect(isReadOnlyHexestraTool('scope_update')).toBe(false);
    expect(isReadOnlyHexestraTool('traffic_capture_set')).toBe(false);
  });

  it('blocks direct file-tool writes to managed security records', () => {
    expect(isManagedRecordFileMutation('Write', { file_path: 'evidence/scan.txt' })).toBe(true);
    expect(isManagedRecordFileMutation('Edit', { file_path: '/mnt/d/project/reports/final.md' })).toBe(true);
    expect(isManagedRecordFileMutation('Write', { file_path: 'notes/scan.txt' })).toBe(false);
    expect(isManagedRecordFileMutation('Bash', { command: 'echo test' })).toBe(false);
  });
});
