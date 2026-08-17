// @vitest-environment node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: vi.fn() },
}));

describe('Agent fine-grained registration smoke', () => {
  let appData: string;
  let previousAppData: string | undefined;
  let previousHexestraHome: string | undefined;
  let projectPath: string;
  let sessionId: string;
  let sessionService: typeof import('@electron/services/session.service').sessionService;
  let tools: ReturnType<typeof import('@electron/services/agent-tools/project-tools').createProjectAgentTools>;

  beforeAll(async () => {
    appData = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-agent-graph-smoke-'));
    previousAppData = process.env.APPDATA;
    previousHexestraHome = process.env.HEXESTRA_HOME;
    process.env.APPDATA = appData;
    process.env.HEXESTRA_HOME = appData;
    vi.resetModules();
    sessionService = (await import('@electron/services/session.service')).sessionService;
    const { createProjectAgentTools } = await import('@electron/services/agent-tools/project-tools');
    projectPath = path.join(appData, 'project');
    fs.mkdirSync(projectPath, { recursive: true });
    sessionId = (await sessionService.openProjectPath(projectPath, {
      name: 'Agent graph smoke', scope: 'example.com',
    })).id;
    tools = createProjectAgentTools({
      sessionId,
      selectedTargetId: 'local-operator',
      sender: { isDestroyed: () => false, send: vi.fn() } as never,
      permissionMode: 'default',
    });
  });

  afterAll(() => {
    sessionService.close();
    process.env.APPDATA = previousAppData;
    process.env.HEXESTRA_HOME = previousHexestraHome;
    fs.rmSync(appData, { recursive: true, force: true });
  });

  it('executes register -> get for each discovery before continuing and reaches SQLite/NetMap', async () => {
    const timeline: string[] = [];
    const call = async (name: string, input: Record<string, unknown>) => {
      const tool = tools.find((candidate) => candidate.name === name)!;
      timeline.push(name);
      const result = await tool.execute(input);
      return JSON.parse(result.content[0].type === 'text' ? result.content[0].text : '{}');
    };

    const hostWrite = await call('asset_register', { assets: [{ type: 'host', ip: '192.0.2.55' }] });
    const hostId = hostWrite.registeredHosts[0].id as string;
    expect((await call('asset_get', { assetId: hostId })).asset).toMatchObject({ type: 'host', id: hostId });

    const portWrite = await call('asset_register', { assets: [{ type: 'port', hostAssetId: hostId, port: 443, protocol: 'tcp' }] });
    const portId = portWrite.registeredAssets[0].id as string;
    expect((await call('asset_get', { assetId: portId })).asset).toMatchObject({ type: 'port', id: portId });

    const webWrite = await call('asset_register', { assets: [{ type: 'webapp', url: 'https://api.example.com/' }] });
    const webId = webWrite.registeredAssets[0].id as string;
    await call('asset_get', { assetId: webId });
    const apiWrite = await call('asset_register', { assets: [{ type: 'api', baseUrl: 'https://api.example.com/v1', webAppAssetId: webId }] });
    const apiId = apiWrite.registeredAssets[0].id as string;
    await call('asset_get', { assetId: apiId });
    const endpointWrite = await call('asset_register', { assets: [{ type: 'endpoint', apiAssetId: apiId, method: 'GET', path: '/users/42' }] });
    const endpointId = endpointWrite.registeredAssets[0].id as string;
    await call('asset_get', { assetId: endpointId });

    expect(timeline).toEqual([
      'asset_register', 'asset_get',
      'asset_register', 'asset_get',
      'asset_register', 'asset_get',
      'asset_register', 'asset_get',
      'asset_register', 'asset_get',
    ]);
    const netmap = await sessionService.getNetMap(sessionId);
    expect(netmap.assets).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: portId, type: 'port' }),
      expect.objectContaining({ id: apiId, type: 'api' }),
      expect.objectContaining({ id: endpointId, type: 'endpoint' }),
    ]));
    expect(netmap.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: portId, target: hostId, semantic: 'port_of' }),
      expect.objectContaining({ source: endpointId, target: apiId, semantic: 'endpoint_of' }),
    ]));

    const database = new DatabaseSync(path.join(projectPath, '.hexestra', 'engagement.db'), { readOnly: true });
    const version = (database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    const portDetail = database.prepare('SELECT port_asset_id, port FROM endpoints WHERE port_asset_id = ?').get(portId);
    database.close();
    expect(version).toBe(5);
    expect(portDetail).toMatchObject({ port_asset_id: portId, port: 443 });
  });

  it('atomically creates catalog-backed Agent Tasks under Tactic and Technique headings', async () => {
    const planTool = tools.find((candidate) => candidate.name === 'task_plan_create');
    expect(planTool).toBeDefined();
    const result = await planTool!.execute({
      groups: [{
        tacticId: 'TA0043',
        techniqueId: 'T1595.001',
        tasks: [
          { title: 'Enumerate exposed IP blocks', successCriteria: [{ text: 'Record candidate ranges' }] },
          { title: 'Validate responsive hosts', successCriteria: [{ text: 'Confirm live hosts' }] },
        ],
      }],
    });
    const planned = JSON.parse(result.content[0].type === 'text' ? result.content[0].text : '[]') as Array<{ kind: string; techniqueIds: string[]; status: string }>;
    expect(planned).toHaveLength(2);
    expect(planned.every((task) => task.kind === 'objective' && task.status === 'pending' && task.techniqueIds[0] === 'T1595.001')).toBe(true);
    const markdown = fs.readFileSync(path.join(projectPath, 'ptt.md'), 'utf8');
    expect(markdown).toContain('## TA0043 Reconnaissance');
    expect(markdown).toContain('### T1595.001 Scanning IP Blocks');
    expect((await sessionService.listTasks(sessionId)).filter((task) => task.kind === 'objective')).toHaveLength(2);
  });
});
