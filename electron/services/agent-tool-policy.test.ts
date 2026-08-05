import { describe, expect, it } from 'vitest';
import { isManagedRecordFileMutation, isReadOnlyAgentTool } from './agent-tool-policy';

describe('Agent tool policy', () => {
  it('classifies Hexestra list operations as read-only', () => {
    expect(isReadOnlyAgentTool('mcp__hexestra__browser_tabs')).toBe(true);
    expect(isReadOnlyAgentTool('mcp__hexestra__browser_read')).toBe(true);
    expect(isReadOnlyAgentTool('mcp__hexestra__browser_screenshot')).toBe(true);
    expect(isReadOnlyAgentTool('mcp__hexestra__target_list')).toBe(true);
    expect(isReadOnlyAgentTool('mcp__hexestra__finding_list')).toBe(true);
    expect(isReadOnlyAgentTool('mcp__hexestra__vulnerability_list')).toBe(true);
    expect(isReadOnlyAgentTool('mcp__hexestra__evidence_list')).toBe(true);
    expect(isReadOnlyAgentTool('mcp__hexestra__report_list')).toBe(true);
    expect(isReadOnlyAgentTool('mcp__hexestra__task_list')).toBe(true);
    expect(isReadOnlyAgentTool('mcp__hexestra__traffic_capture_status')).toBe(true);
  });

  it('keeps graph, task, and Finding mutations state-changing', () => {
    expect(isReadOnlyAgentTool('mcp__hexestra__browser_click')).toBe(false);
    expect(isReadOnlyAgentTool('mcp__hexestra__browser_type')).toBe(false);
    expect(isReadOnlyAgentTool('mcp__hexestra__browser_fill')).toBe(false);
    expect(isReadOnlyAgentTool('mcp__hexestra__browser_back')).toBe(false);
    expect(isReadOnlyAgentTool('mcp__hexestra__browser_forward')).toBe(false);
    expect(isReadOnlyAgentTool('mcp__hexestra__browser_reload')).toBe(false);
    expect(isReadOnlyAgentTool('mcp__hexestra__asset_register')).toBe(false);
    expect(isReadOnlyAgentTool('mcp__hexestra__finding_upsert')).toBe(false);
    expect(isReadOnlyAgentTool('mcp__hexestra__vulnerability_upsert')).toBe(false);
    expect(isReadOnlyAgentTool('mcp__hexestra__task_update_status')).toBe(false);
    expect(isReadOnlyAgentTool('mcp__hexestra__scope_update')).toBe(false);
    expect(isReadOnlyAgentTool('mcp__hexestra__traffic_capture_set')).toBe(false);
  });

  it('blocks direct file-tool writes to managed security records', () => {
    expect(isManagedRecordFileMutation('Write', { file_path: 'evidence/scan.txt' })).toBe(true);
    expect(isManagedRecordFileMutation('Edit', { file_path: '/mnt/d/project/reports/final.md' })).toBe(true);
    expect(isManagedRecordFileMutation('Write', { file_path: 'notes/scan.txt' })).toBe(false);
    expect(isManagedRecordFileMutation('Bash', { command: 'echo test' })).toBe(false);
  });
});
