// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createShellAgentTools } from '@electron/services/agent-tools/shell-tools';
import { validateWebShellOptions } from '@electron/services/shell-contract';

const mocks = vi.hoisted(() => ({
  saveProfile: vi.fn(),
  listProfiles: vi.fn(),
  listListeners: vi.fn(),
  listCredentialStatuses: vi.fn(),
  listNetworkInterfaces: vi.fn(),
  listProfileHealth: vi.fn(),
  verifyProfile: vi.fn(),
  getTarget: vi.fn(),
  listAssets: vi.fn(),
}));

vi.mock('@electron/services/shell.service', () => ({ shellService: mocks }));
vi.mock('@electron/services/session.service', () => ({ sessionService: mocks }));

describe('Shell Agent tools', () => {
  it('allows Agent-created WebShell profiles with complete request settings', async () => {
    const saved = { id: 'profile-web', name: 'Agent WebShell', kind: 'webshell' };
    mocks.saveProfile.mockImplementation((_projectId: string, profile: { webshell?: unknown }) => {
      validateWebShellOptions(profile.webshell);
      return saved;
    });
    const tool = createShellAgentTools({ sender: {} as never, sessionId: 'project-1', permissionMode: 'default' })
      .find((item) => item.name === 'shell_profile_create');
    if (!tool) throw new Error('shell_profile_create tool was not registered');
    expect(tool.description).toContain('{{command_base64}}');
    expect(tool.description).toContain('POST JSON example');
    expect(tool.description).toContain("base64_decode('{{command_base64}}')");
    expect(tool.description).toContain('auto tries direct OS commands and then PHP eval');

    const input = z.object(tool.inputSchema).parse({
      name: 'Agent WebShell',
      kind: 'webshell',
      assetRole: 'infrastructure',
      shellFlavor: 'posix',
      webshell: {
        url: 'https://example.test/run',
        method: 'POST',
        headers: [{ name: 'Cookie', value: 'sid=plain' }],
        bodyKind: 'json',
        bodyTemplate: '{"command":{{command}}}',
        responseExtract: 'body',
        responseEncoding: 'utf-8',
        allowInvalidTls: false,
      },
    });

    await tool.execute(input);
    expect(mocks.saveProfile).toHaveBeenCalledWith('project-1', expect.objectContaining({
      kind: 'webshell',
      webshell: expect.objectContaining({
        url: 'https://example.test/run',
        headers: [{ name: 'Cookie', value: 'sid=plain' }],
        bodyTemplate: '{"command":{{command}}}',
        commandMode: 'auto',
      }),
    }));
  });

  it('returns saved WebShell settings without redaction for now', async () => {
    const profile = {
      id: 'profile-web',
      kind: 'webshell',
      webshell: { url: 'https://example.test/run?token=plain&cmd={{command}}', headers: [{ name: 'Cookie', value: 'sid=plain' }] },
    };
    mocks.listProfiles.mockReturnValue([profile]);
    mocks.listListeners.mockReturnValue([]);
    mocks.listCredentialStatuses.mockReturnValue([]);
    mocks.listNetworkInterfaces.mockReturnValue([]);
    const tool = createShellAgentTools({ sender: {} as never, sessionId: 'project-1', permissionMode: 'default' })
      .find((item) => item.name === 'shell_profiles');
    if (!tool) throw new Error('shell_profiles tool was not registered');

    const result = await tool.execute({});
    expect(result.content[0]).toMatchObject({ type: 'text' });
    expect((result.content[0] as { text: string }).text).toContain('token=plain');
    expect((result.content[0] as { text: string }).text).toContain('sid=plain');
  });

  it('preserves AntSword-compatible adapter settings through the Agent schema', async () => {
    const saved = { id: 'profile-ant', name: 'PHP adapter', kind: 'webshell' };
    mocks.saveProfile.mockImplementation((_projectId: string, profile: { webshell?: unknown }) => {
      validateWebShellOptions(profile.webshell);
      return saved;
    });
    const tool = createShellAgentTools({ sender: {} as never, sessionId: 'project-1', permissionMode: 'default' })
      .find((item) => item.name === 'shell_profile_create');
    if (!tool) throw new Error('shell_profile_create tool was not registered');

    const input = z.object(tool.inputSchema).parse({
      name: 'PHP adapter',
      kind: 'webshell',
      assetRole: 'infrastructure',
      shellFlavor: 'posix',
      webshell: {
        adapterId: 'antsword.v2.php',
        runtime: 'php',
        url: 'https://example.test/run',
        method: 'POST',
        headers: [],
        bodyKind: 'form',
        responseExtract: 'body',
        responseEncoding: 'utf-8',
        allowInvalidTls: false,
        antsword: { passwordParameter: 'pass', encoder: 'raw' },
      },
    });

    await tool.execute(input);
    expect(mocks.saveProfile).toHaveBeenCalledWith('project-1', expect.objectContaining({
      webshell: expect.objectContaining({
        adapterId: 'antsword.v2.php',
        runtime: 'php',
        antsword: { passwordParameter: 'pass', encoder: 'raw' },
      }),
    }));
  });

  it('exposes shell_profile_status as a read-only health listing', async () => {
    const healthRecords = [
      { profileId: 'profile-web', status: 'healthy', adapterId: 'generic', consecutiveFailures: 0 },
      { profileId: 'profile-ant', status: 'degraded', adapterId: 'antsword.v2.php', consecutiveFailures: 2, lastError: 'timeout' },
    ];
    mocks.listProfileHealth.mockReturnValue(healthRecords);
    const tool = createShellAgentTools({ sender: {} as never, sessionId: 'project-1', permissionMode: 'default' })
      .find((item) => item.name === 'shell_profile_status');
    if (!tool) throw new Error('shell_profile_status tool was not registered');

    const result = await tool.execute({});
    expect(mocks.listProfileHealth).toHaveBeenCalledWith('project-1');
    expect((result.content[0] as { text: string }).text).toContain('healthy');
    expect((result.content[0] as { text: string }).text).toContain('antsword.v2.php');
  });

  it('exposes shell_profile_verify to actively verify a WebShell profile', async () => {
    const healthResult = {
      profileId: 'profile-web',
      status: 'healthy',
      adapterId: 'generic',
      shellFlavor: 'posix',
      latencyMs: 150,
      consecutiveFailures: 0,
    };
    mocks.verifyProfile.mockResolvedValue(healthResult);
    const tool = createShellAgentTools({ sender: {} as never, sessionId: 'project-1', permissionMode: 'default' })
      .find((item) => item.name === 'shell_profile_verify');
    if (!tool) throw new Error('shell_profile_verify tool was not registered');

    const result = await tool.execute({ profileId: 'profile-web' });
    expect(mocks.verifyProfile).toHaveBeenCalledWith('project-1', 'profile-web');
    expect((result.content[0] as { text: string }).text).toContain('healthy');
    expect((result.content[0] as { text: string }).text).toContain('posix');
  });
});
