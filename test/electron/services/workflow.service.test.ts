// @vitest-environment node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkflowService, parseWorkflowMarkdown, renderWorkflowMarkdown } from '@electron/services/workflow.service';

const roots: string[] = [];
const valid = `---\nschema: 1\nid: web-baseline\nname: Web Baseline\ndescription: Baseline web review\nversion: "1.0.0"\ntags: [web, baseline]\n---\n\n# Check\n\nEnumerate the application.\n`;

afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe('workflow service', () => {
  it('parses and renders canonical frontmatter', () => {
    const parsed = parseWorkflowMarkdown(valid);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.value?.id).toBe('web-baseline');
    const rendered = renderWorkflowMarkdown({ name: 'Web Baseline', description: 'Baseline web review', version: '1.0.0', tags: ['web'], body: '# Check' });
    expect(rendered.diagnostics).toEqual([]);
    expect(rendered.raw).toContain('schema: 1');
    expect(parseWorkflowMarkdown(rendered.raw ?? '').value?.body).toBe('# Check');
  });

  it('supports atomic save, list, fingerprint protection and immutable run snapshots', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-workflows-')); roots.push(root);
    const service = new WorkflowService(root, false);
    const saved = service.save({ id: 'web-baseline', name: 'Web Baseline', description: 'Baseline', version: '1.0.0', tags: ['web'], body: '# First' });
    expect(service.list().map((item) => item.id)).toEqual(['web-baseline']);
    const preparation = service.prepareRun(saved.id, 'Focus on login');
    expect(preparation.content).toContain('<hexestra_workflow>');
    expect(preparation.content).toContain('# First');
    expect(preparation.invocation.fingerprint).toBe(saved.fingerprint);
    expect(() => service.save({ id: saved.id, name: 'Changed', version: '1.0.0', body: '# Changed' })).toThrow(/confirm the overwrite/);
    expect(() => service.save({ id: saved.id, name: 'Changed', version: '1.0.0', body: '# Changed', expectedFingerprint: 'stale' })).toThrow(/changed on disk/);
    const changed = service.save({ id: saved.id, name: 'Changed', version: '1.0.0', body: '# Changed', expectedFingerprint: saved.fingerprint });
    expect(changed.fingerprint).not.toBe(saved.fingerprint);
    expect(preparation.content).toContain('# First');
    expect(service.remove(saved.id, changed.fingerprint)).toBe(true);
    expect(service.read(saved.id)).toBeNull();
  });

  it('reports import conflicts and safely copies valid files', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-workflows-')); roots.push(root);
    const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-workflow-source-')); roots.push(sourceDir);
    const source = path.join(sourceDir, 'external.md');
    fs.writeFileSync(source, valid, 'utf8');
    const service = new WorkflowService(root, false);
    expect(service.importFile(source).workflow?.id).toBe('web-baseline');
    const conflict = service.importFile(source);
    expect(conflict.conflict).toBe(true);
    expect(conflict.sourcePath).toBe(path.resolve(source));
    expect(service.importFile(source, true).workflow?.id).toBe('web-baseline');
    expect(() => service.importFile(path.join(sourceDir, '..', 'missing.md'))).toThrow();
  });
});
