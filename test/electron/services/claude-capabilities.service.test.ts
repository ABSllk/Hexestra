import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentConnectionSettings } from '@electron/contracts/agent-settings';

vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() },
  ipcMain: { handle: vi.fn() },
}));
vi.mock('@electron/services/agent-settings.service', () => ({
  agentSettingsService: { getSettings: vi.fn() },
}));
vi.mock('@electron/services/session.service', () => ({
  sessionService: { getSessionPath: vi.fn() },
}));

import { ClaudeCapabilitiesService, wslPathToUnc } from '@electron/services/claude-capabilities.service';

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
let service: ClaudeCapabilitiesService;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-capabilities-'));
  home = path.join(root, 'home');
  project = path.join(root, 'project');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(project, { recursive: true });
  service = new ClaudeCapabilitiesService({
    getSettings: () => settings,
    getSessionPath: () => project,
    resolveRuntimeHome: async () => home,
  }, false);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('Claude capability management', () => {
  it('creates, edits, disables, enables, and deletes a native project Skill without losing assets', async () => {
    const created = await service.saveSkill({
      sessionId: 'session-1',
      scope: 'project',
      name: 'recon-helper',
      content: '---\nname: recon-helper\ndescription: Recon workflow\n---\n\n# Recon',
    });
    expect(created.description).toBe('Recon workflow');
    fs.writeFileSync(path.join(project, '.claude', 'skills', 'recon-helper', 'template.md'), 'preserved');

    const listed = await service.listSkills('session-1');
    expect(listed.items).toEqual([expect.objectContaining({ name: 'recon-helper', scope: 'project', enabled: true })]);

    const disabled = await service.toggleSkill({ sessionId: 'session-1', scope: 'project', name: 'recon-helper', enabled: true });
    expect(disabled.enabled).toBe(false);
    expect(fs.readFileSync(path.join(project, '.claude', 'skills-disabled', 'recon-helper', 'template.md'), 'utf8')).toBe('preserved');

    const enabled = await service.toggleSkill({ sessionId: 'session-1', scope: 'project', name: 'recon-helper', enabled: false });
    expect(enabled.enabled).toBe(true);
    await service.deleteSkill({ sessionId: 'session-1', scope: 'project', name: 'recon-helper', enabled: true });
    expect((await service.listSkills('session-1')).items).toHaveLength(0);
  });

  it('lists personal Skills without an engagement and rejects project writes', async () => {
    await service.saveSkill({
      scope: 'personal',
      name: 'personal-skill',
      content: '---\nname: personal-skill\ndescription: Personal\n---\n',
    });
    const listed = await service.listSkills(null);
    expect(listed.projectAvailable).toBe(false);
    expect(listed.items[0]).toMatchObject({ name: 'personal-skill', scope: 'personal' });
    await expect(service.saveSkill({ scope: 'project', name: 'blocked', content: '# blocked' }))
      .rejects.toThrow('Open a project folder');
  });

  it('resolves the selected runtime home once per service instance', async () => {
    const resolveRuntimeHome = vi.fn(async () => home);
    const cachedService = new ClaudeCapabilitiesService({
      getSettings: () => settings,
      getSessionPath: () => project,
      resolveRuntimeHome,
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
    await expect(service.saveSkill({ scope: 'personal', name: '../escape', content: '# bad' })).rejects.toThrow('Name must');
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
