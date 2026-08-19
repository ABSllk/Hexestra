import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentConnectionSettings } from '@electron/contracts/agent-settings';

vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() },
  BrowserWindow: { fromWebContents: vi.fn(() => null) },
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: { handle: vi.fn() },
}));
vi.mock('@electron/services/agent-settings.service', () => ({
  agentSettingsService: { getSettings: vi.fn() },
}));
vi.mock('@electron/services/session.service', () => ({
  sessionService: { getSessionPath: vi.fn() },
}));

import { ClaudeCapabilitiesService, wslPathToUnc } from '@electron/services/claude-capabilities.service';
import { dialog } from 'electron';

const settings: AgentConnectionSettings = {
  version: 1,
  executionMode: 'native',
  wslDistribution: 'Ubuntu-24.04',
  claudeExecutable: '',
  model: null,
  settingSources: ['user', 'project', 'local'],
};

let root = '';
let home = '';
let project = '';
let userData = '';
let service: ClaudeCapabilitiesService;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-capabilities-'));
  home = path.join(root, 'home');
  project = path.join(root, 'project');
  userData = path.join(root, 'user-data');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(project, { recursive: true });
  service = new ClaudeCapabilitiesService({
    getSettings: () => settings,
    getSessionPath: () => project,
    resolveRuntimeHome: async () => home,
    getGlobalUserPath: () => path.join(userData, 'user'),
  }, false);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('Claude capability management', () => {
  it('previews and imports a Skill folder with nested resources, repairs metadata, and enables it', async () => {
    const source = path.join(root, 'external-skill');
    fs.mkdirSync(path.join(source, 'references', 'templates'), { recursive: true });
    fs.writeFileSync(path.join(source, 'SKILL.md'), '# Imported workflow\n');
    fs.writeFileSync(path.join(source, 'references', 'templates', 'example.md'), 'keep me');

    const preview = await service.inspectSkillImport(source, 'directory', 'session-1');
    expect(preview.fileCount).toBe(2);
    expect(preview.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(['missing-name', 'missing-description']));
    expect(preview.content).toContain('# Imported workflow');

    const imported = await service.applySkillImport({
      sessionId: 'session-1',
      selectionId: preview.selectionId,
      scope: 'project',
      name: 'recon-helper',
      description: 'Imported reconnaissance workflow',
      collision: 'reject',
    });
    expect(imported.document).toEqual(expect.objectContaining({ name: 'recon-helper', scope: 'project', enabled: true }));
    const installed = path.join(project, '.hexestra', 'user', 'skills', 'recon-helper');
    expect(fs.readFileSync(path.join(installed, 'SKILL.md'), 'utf8')).toContain('name: recon-helper');
    expect(fs.readFileSync(path.join(installed, 'SKILL.md'), 'utf8')).toContain('description: Imported reconnaissance workflow');
    expect(fs.readFileSync(path.join(installed, 'references', 'templates', 'example.md'), 'utf8')).toBe('keep me');
    expect(fs.existsSync(path.join(project, '.claude', 'skills', 'recon-helper', 'SKILL.md'))).toBe(true);
    await service.toggleSkill({ sessionId: 'session-1', scope: 'project', name: 'recon-helper', enabled: true });
    expect(fs.readFileSync(path.join(project, '.hexestra', 'user', 'skills-disabled', 'recon-helper', 'references', 'templates', 'example.md'), 'utf8')).toBe('keep me');
    await service.toggleSkill({ sessionId: 'session-1', scope: 'project', name: 'recon-helper', enabled: false });
    expect(fs.readFileSync(path.join(project, '.hexestra', 'user', 'skills', 'recon-helper', 'references', 'templates', 'example.md'), 'utf8')).toBe('keep me');
  });

  it('imports a standalone SKILL.md into the global scope', async () => {
    const source = path.join(root, 'standalone', 'SKILL.md');
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.writeFileSync(source, '---\nname: shared-helper\ndescription: Shared workflow\ncustom: retained\n---\n\n# Shared\n');
    const preview = await service.inspectSkillImport(source, 'skill-file', null);
    const imported = await service.applySkillImport({
      selectionId: preview.selectionId,
      scope: 'global',
      name: 'shared-helper',
      description: 'Shared workflow',
      collision: 'reject',
    });
    expect(imported.document).toEqual(expect.objectContaining({ name: 'shared-helper', scope: 'global', enabled: true }));
    const content = fs.readFileSync(path.join(userData, 'user', 'skills', 'shared-helper', 'SKILL.md'), 'utf8');
    expect(content).toContain('custom: retained');
  });

  it('supports selecting multiple folders in one import picker operation', async () => {
    const first = path.join(root, 'picker-one');
    const second = path.join(root, 'picker-two');
    for (const [directory, name] of [[first, 'picker-one'], [second, 'picker-two']] as const) {
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: Picked\n---\n`);
    }
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: [first, second] } as never);
    const previews = await service.pickSkillImport({} as never, 'directory', 'session-1');
    if (!Array.isArray(previews)) throw new Error('Expected a batch preview');
    expect(previews).toHaveLength(2);
    expect(previews.map((item) => item.sourceLabel)).toEqual(['picker-one', 'picker-two']);
  });

  it('rejects malformed YAML and detects a source changed after review', async () => {
    const malformed = path.join(root, 'malformed');
    fs.mkdirSync(malformed, { recursive: true });
    fs.writeFileSync(path.join(malformed, 'SKILL.md'), '---\nname: [broken\ndescription: nope\n---\n');
    await expect(service.inspectSkillImport(malformed, 'directory', 'session-1')).rejects.toThrow('invalid YAML');

    const changing = path.join(root, 'changing');
    fs.mkdirSync(changing, { recursive: true });
    const sourceFile = path.join(changing, 'SKILL.md');
    fs.writeFileSync(sourceFile, '---\nname: changing\ndescription: Original\n---\n\n# Original\n');
    const preview = await service.inspectSkillImport(changing, 'directory', 'session-1');
    fs.appendFileSync(sourceFile, '\nchanged after review');
    await expect(service.applySkillImport({
      sessionId: 'session-1',
      selectionId: preview.selectionId,
      scope: 'project',
      name: 'changing',
      description: 'Original',
      collision: 'reject',
    })).rejects.toThrow('changed after review');
  });

  it('handles same-scope collisions, safe replacement, and ambiguous enabled/disabled copies', async () => {
    const first = path.join(root, 'first');
    const second = path.join(root, 'second');
    for (const [directory, heading] of [[first, 'First'], [second, 'Second']] as const) {
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, 'SKILL.md'), `---\nname: collision\ndescription: ${heading}\n---\n\n# ${heading}\n`);
    }
    const initial = await service.inspectSkillImport(first, 'directory', null);
    await service.applySkillImport({
      selectionId: initial.selectionId,
      scope: 'global',
      name: 'collision',
      description: 'First',
      collision: 'reject',
    });
    const collisionPreview = await service.inspectSkillImport(second, 'directory', null);
    const collision = collisionPreview.existing.find((item) => item.scope === 'global' && item.name === 'collision');
    expect(collision).toBeDefined();
    await expect(service.applySkillImport({
      selectionId: collisionPreview.selectionId,
      scope: 'global',
      name: 'collision',
      description: 'Second',
      collision: 'reject',
    })).rejects.toThrow('already exists');
    const replacementPreview = await service.inspectSkillImport(second, 'directory', null);
    const replacementCollision = replacementPreview.existing.find((item) => item.scope === 'global' && item.name === 'collision');
    await service.applySkillImport({
      selectionId: replacementPreview.selectionId,
      scope: 'global',
      name: 'collision',
      description: 'Second',
      collision: 'replace',
      expectedTargetId: replacementCollision!.id,
    });
    expect(fs.readFileSync(path.join(userData, 'user', 'skills', 'collision', 'SKILL.md'), 'utf8')).toContain('description: Second');

    fs.mkdirSync(path.join(userData, 'user', 'skills-disabled', 'collision'), { recursive: true });
    fs.writeFileSync(path.join(userData, 'user', 'skills-disabled', 'collision', 'SKILL.md'), '# disabled');
    const ambiguousPreview = await service.inspectSkillImport(second, 'directory', null);
    expect(ambiguousPreview.existing.filter((item) => item.name === 'collision')).toHaveLength(2);
    await expect(service.applySkillImport({
      selectionId: ambiguousPreview.selectionId,
      scope: 'global',
      name: 'collision',
      description: 'Second',
      collision: 'replace',
      expectedTargetId: ambiguousPreview.existing.find((item) => item.enabled)?.id,
    })).rejects.toThrow('both enabled and disabled');
  });

  it('enforces project availability and import package limits', async () => {
    const source = path.join(root, 'global-only');
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(source, 'SKILL.md'), '---\nname: global-only\ndescription: Global\n---\n');
    const preview = await service.inspectSkillImport(source, 'directory', null);
    await expect(service.applySkillImport({
      selectionId: preview.selectionId,
      scope: 'project',
      name: 'global-only',
      description: 'Global',
      collision: 'reject',
    })).rejects.toThrow('Open a project folder');

    const oversized = path.join(root, 'oversized');
    fs.mkdirSync(oversized, { recursive: true });
    fs.writeFileSync(path.join(oversized, 'SKILL.md'), Buffer.alloc(512 * 1024 + 1, 'x'));
    await expect(service.inspectSkillImport(oversized, 'directory', null)).rejects.toThrow('512 KiB');

    const tooMany = path.join(root, 'too-many');
    fs.mkdirSync(tooMany, { recursive: true });
    fs.writeFileSync(path.join(tooMany, 'SKILL.md'), '# many');
    for (let index = 0; index < 1_000; index += 1) fs.writeFileSync(path.join(tooMany, `file-${index}.txt`), 'x');
    await expect(service.inspectSkillImport(tooMany, 'directory', null)).rejects.toThrow('1000 file limit');

    const missingRoot = path.join(root, 'missing-root');
    fs.mkdirSync(path.join(missingRoot, 'nested'), { recursive: true });
    fs.writeFileSync(path.join(missingRoot, 'nested', 'SKILL.md'), '# nested');
    await expect(service.inspectSkillImport(missingRoot, 'directory', null)).rejects.toThrow('root');

    const managed = path.join(userData, 'user', 'skills', 'already-managed');
    fs.mkdirSync(managed, { recursive: true });
    fs.writeFileSync(path.join(managed, 'SKILL.md'), '# managed');
    await expect(service.inspectSkillImport(managed, 'directory', null)).rejects.toThrow('managed Skill directories');
  });

  it('restores the previous directory when the atomic replacement rename fails', async () => {
    await service.saveSkill({
      scope: 'global',
      name: 'rollback-helper',
      content: '---\nname: rollback-helper\ndescription: Old\n---\n\n# Old\n',
    });
    const source = path.join(root, 'rollback-source');
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(source, 'SKILL.md'), '---\nname: rollback-helper\ndescription: New\n---\n\n# New\n');
    const preview = await service.inspectSkillImport(source, 'directory', null);
    const target = path.join(userData, 'user', 'skills', 'rollback-helper', 'SKILL.md');
    const originalRename = fs.renameSync;
    const rename = vi.spyOn(fs, 'renameSync').mockImplementation((oldPath, newPath) => {
      if (String(oldPath).includes('.import-')) throw new Error('simulated rename failure');
      return originalRename(oldPath, newPath);
    });
    await expect(service.applySkillImport({
      selectionId: preview.selectionId,
      scope: 'global',
      name: 'rollback-helper',
      description: 'New',
      collision: 'replace',
      expectedTargetId: 'global:enabled:rollback-helper',
    })).rejects.toThrow('simulated rename failure');
    rename.mockRestore();
    expect(fs.readFileSync(target, 'utf8')).toContain('description: Old');
    expect(fs.existsSync(path.join(userData, 'user', 'skills-disabled', 'rollback-helper'))).toBe(false);
  });

  it('creates, edits, disables, enables, and deletes a native project Skill without losing assets', async () => {
    const created = await service.saveSkill({
      sessionId: 'session-1',
      scope: 'project',
      name: 'recon-helper',
      content: '---\nname: recon-helper\ndescription: Recon workflow\n---\n\n# Recon',
    });
    expect(created.description).toBe('Recon workflow');
    fs.writeFileSync(path.join(project, '.hexestra', 'user', 'skills', 'recon-helper', 'template.md'), 'preserved');

    const listed = await service.listSkills('session-1');
    expect(listed.items).toEqual([expect.objectContaining({ name: 'recon-helper', scope: 'project', enabled: true })]);

    const disabled = await service.toggleSkill({ sessionId: 'session-1', scope: 'project', name: 'recon-helper', enabled: true });
    expect(disabled.enabled).toBe(false);
    expect(fs.readFileSync(path.join(project, '.hexestra', 'user', 'skills-disabled', 'recon-helper', 'template.md'), 'utf8')).toBe('preserved');

    const enabled = await service.toggleSkill({ sessionId: 'session-1', scope: 'project', name: 'recon-helper', enabled: false });
    expect(enabled.enabled).toBe(true);
    await service.deleteSkill({ sessionId: 'session-1', scope: 'project', name: 'recon-helper', enabled: true });
    expect((await service.listSkills('session-1')).items).toHaveLength(0);
  });

  it('supports global Skills without a project and requires one for project Skills', async () => {
    const listed = await service.listSkills(null);
    expect(listed.projectAvailable).toBe(false);
    expect(listed.items).toHaveLength(0);
    await service.saveSkill({ scope: 'global', name: 'shared', content: '# shared' });
    expect((await service.listSkills(null)).items).toEqual([expect.objectContaining({ name: 'shared', scope: 'global' })]);
    await expect(service.saveSkill({ scope: 'project', name: 'blocked', content: '# blocked' }))
      .rejects.toThrow('Open a project folder');
  });

  it('resolves the selected runtime home once per service instance', async () => {
    const resolveRuntimeHome = vi.fn(async () => home);
    const cachedService = new ClaudeCapabilitiesService({
      getSettings: () => settings,
      getSessionPath: () => project,
      resolveRuntimeHome,
      getGlobalUserPath: () => path.join(userData, 'user'),
    }, false);

    await cachedService.listSkills(null);
    await cachedService.listMcpServers('session-1');

    expect(resolveRuntimeHome).toHaveBeenCalledTimes(1);
  });

  it('preserves unrelated Claude JSON and applies local > project > user MCP precedence', async () => {
    fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({
      theme: 'dark',
      mcpServers: { shared: { type: 'http', url: 'https://user.example/mcp' } },
      projects: {
        [project]: {
          mcpServers: { shared: { type: 'http', url: 'https://local.example/mcp' } },
        },
      },
    }));
    fs.writeFileSync(path.join(project, '.mcp.json'), JSON.stringify({
      customKey: true,
      mcpServers: { shared: { type: 'http', url: 'https://project.example/mcp' } },
    }));

    const listed = await service.listMcpServers('session-1');
    expect(listed.items.filter((item) => item.name === 'shared')).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: 'local', effective: true, shadowedBy: null }),
      expect.objectContaining({ scope: 'project', effective: false, shadowedBy: 'local' }),
      expect.objectContaining({ scope: 'user', effective: false, shadowedBy: 'local' }),
    ]));

    await service.saveMcpServer({
      sessionId: 'session-1',
      scope: 'local',
      name: 'scanner',
      definition: { type: 'stdio', command: 'scanner-mcp', args: ['--safe'] },
    });
    const userConfig = JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8'));
    expect(userConfig.theme).toBe('dark');
    expect(userConfig.projects[project].mcpServers.scanner.command).toBe('scanner-mcp');
  });

  it('round-trips project MCP definitions and preserves unrelated project keys', async () => {
    fs.writeFileSync(path.join(project, '.mcp.json'), JSON.stringify({ customKey: { keep: true } }));
    await service.saveMcpServer({
      sessionId: 'session-1',
      scope: 'project',
      name: 'web-tools',
      definition: { type: 'http', url: 'https://example.com/mcp', headers: { Authorization: 'secret' } },
    });
    await service.deleteMcpServer({ sessionId: 'session-1', scope: 'project', name: 'web-tools' });
    const config = JSON.parse(fs.readFileSync(path.join(project, '.mcp.json'), 'utf8'));
    expect(config.customKey).toEqual({ keep: true });
    expect(config.mcpServers).toEqual({});
  });

  it('reports malformed sources instead of overwriting or starting servers', async () => {
    fs.writeFileSync(path.join(home, '.claude.json'), '{ invalid');
    const listed = await service.listMcpServers('session-1');
    expect(listed.errors[0]).toMatchObject({ source: 'user/local MCP' });
    await expect(service.saveMcpServer({
      scope: 'user',
      name: 'safe',
      definition: { type: 'stdio', command: 'safe-mcp' },
    })).rejects.toThrow();
  });

  it('validates names and MCP transport requirements at the Electron boundary', async () => {
    await expect(service.saveSkill({ scope: 'global', name: '../escape', content: '# bad' })).rejects.toThrow('Name must');
    await expect(service.saveMcpServer({ scope: 'user', name: 'broken', definition: { type: 'stdio' } })).rejects.toThrow('requires a command');
    await expect(service.saveMcpServer({ scope: 'user', name: 'broken-http', definition: { type: 'http', url: 'file:///tmp/x' } })).rejects.toThrow('HTTP(S)');
  });
});

describe('WSL capability paths', () => {
  it('maps an absolute Linux home to the selected distribution UNC path', () => {
    expect(wslPathToUnc('Ubuntu-24.04', '/home/testuser')).toBe('\\\\wsl.localhost\\Ubuntu-24.04\\home\\testuser');
    expect(() => wslPathToUnc('Ubuntu-24.04', 'home/abs')).toThrow('absolute path');
  });
});
