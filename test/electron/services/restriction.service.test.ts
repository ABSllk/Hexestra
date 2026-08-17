// @vitest-environment node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  applyRestrictionImport,
  globalRestrictionsPath,
  previewRestrictionImport,
  readRestrictionDocument,
  resolveRestrictions,
  seedGlobalRestrictions,
  validateRestrictionDocument,
  writeRestrictionDocument,
} from '@electron/services/restriction.service';

describe('structured YAML restrictions', () => {
  it('validates and resolves project user rules', () => {
    const filePath = path.join(os.tmpdir(), `hexestra-restrictions-${Date.now()}.yaml`);
    const now = '2026-08-13T00:00:00.000Z';
    writeRestrictionDocument(filePath, { version: 1, rules: [
      { id: 'general', text: 'General rule', enabled: true, selector: { kind: 'general' }, createdAt: now, updatedAt: now },
      { id: 'scan', text: 'Scan rule', enabled: true, selector: { kind: 'attack', tacticIds: ['TA0043'], techniqueIds: ['T1595'] }, createdAt: now, updatedAt: now },
    ] });
    const loaded = readRestrictionDocument(filePath, 'project');
    expect(loaded.diagnostics).toEqual([]);
    expect(loaded.document.rules).toHaveLength(2);
    const resolved = resolveRestrictions(path.join(os.tmpdir(), 'missing-global-restrictions.yaml'), filePath, 'TA0043', ['T1595', 'T1595.001']);
    expect(resolved.diagnostics).toEqual([]);
    expect(resolved.rules).toHaveLength(2);
    expect(resolved.rules.some((rule) => rule.matchedBy.includes('technique:T1595'))).toBe(true);
    expect(resolved.rules.some((rule) => rule.matchedBy.includes('tactic:TA0043'))).toBe(true);
    fs.rmSync(filePath, { force: true });
  });

  it('rejects duplicate IDs and unknown ATT&CK references', () => {
    const result = validateRestrictionDocument({ version: 1, rules: [{ id: 'same', text: 'a', enabled: true, selector: { kind: 'attack', tacticIds: ['TA9999'], techniqueIds: [] }, createdAt: '2026-08-13T00:00:00.000Z', updatedAt: '2026-08-13T00:00:00.000Z' }, { id: 'same', text: 'b', enabled: true, selector: { kind: 'general' }, createdAt: '2026-08-13T00:00:00.000Z', updatedAt: '2026-08-13T00:00:00.000Z' }] });
    expect(result.diagnostics).toEqual(expect.arrayContaining(['Rule same references unknown tactic TA9999']));
  });

  it('applies global and project rules together and folds exact duplicates', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-restriction-layers-'));
    const globalPath = path.join(directory, 'global.yaml');
    const projectPath = path.join(directory, 'project.yaml');
    const now = '2026-08-13T00:00:00.000Z';
    const duplicate = { text: 'Shared rule', enabled: true, selector: { kind: 'general' as const }, createdAt: now, updatedAt: now };
    writeRestrictionDocument(globalPath, { version: 1, rules: [{ id: 'global-shared', ...duplicate }] });
    writeRestrictionDocument(projectPath, { version: 1, rules: [
      { id: 'project-shared', ...duplicate },
      { id: 'project-only', text: 'Project rule', enabled: true, selector: { kind: 'general' }, createdAt: now, updatedAt: now },
    ] });
    const resolved = resolveRestrictions(globalPath, projectPath, 'TA0043', []);
    expect(resolved.rules).toHaveLength(2);
    expect(resolved.rules.find((rule) => rule.text === 'Shared rule')).toMatchObject({
      sources: ['global', 'project'],
      ruleIds: ['global-shared', 'project-shared'],
    });
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('seeds global restrictions once and does not recreate a user-deleted file', () => {
    const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-restriction-seed-'));
    expect(seedGlobalRestrictions(userDataPath)).toBe(true);
    const filePath = globalRestrictionsPath(userDataPath);
    expect(readRestrictionDocument(filePath, 'global').document.rules).toHaveLength(0);
    fs.rmSync(filePath);
    expect(seedGlobalRestrictions(userDataPath)).toBe(false);
    expect(fs.existsSync(filePath)).toBe(false);
    fs.rmSync(userDataPath, { recursive: true, force: true });
  });

  it('merges imports by ID and rejects stale previews', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-restrictions-'));
    const filePath = path.join(directory, 'restrictions.yaml');
    const base = { version: 1 as const, rules: [{ id: 'keep', text: 'Keep this', enabled: true, selector: { kind: 'general' as const }, createdAt: '2026-08-13T00:00:00.000Z', updatedAt: '2026-08-13T00:00:00.000Z' }] };
    writeRestrictionDocument(filePath, base);
    const preview = previewRestrictionImport(filePath, 'project', `version: 1\nrules:\n  - id: keep\n    text: Updated\n    enabled: true\n    selector:\n      kind: general\n    createdAt: 2026-08-13T00:00:00.000Z\n    updatedAt: 2026-08-13T00:00:00.000Z\n  - id: added\n    text: Added\n    enabled: true\n    selector:\n      kind: general\n    createdAt: 2026-08-13T00:00:00.000Z\n    updatedAt: 2026-08-13T00:00:00.000Z\n`);
    expect(preview.added.map((rule) => rule.id)).toEqual(['added']);
    expect(preview.updated.map((rule) => rule.id)).toEqual(['keep']);
    applyRestrictionImport(filePath, preview);
    expect(readRestrictionDocument(filePath, 'project').document.rules.map((rule) => rule.id)).toEqual(['keep', 'added']);
    writeRestrictionDocument(filePath, { ...base, rules: [...base.rules, { ...base.rules[0], id: 'other', text: 'Other' }] });
    expect(() => applyRestrictionImport(filePath, preview)).toThrow('preview again');
    fs.rmSync(directory, { recursive: true, force: true });
  });
});
