// @vitest-environment node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createAssetRecord } from '@electron/services/asset-record';

const electronMocks = vi.hoisted(() => ({
  windows: [] as Array<{
    isDestroyed: () => boolean;
    webContents: { send: ReturnType<typeof vi.fn> };
  }>,
}));

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => electronMocks.windows,
  },
  dialog: {
    showOpenDialog: vi.fn(),
  },
  ipcMain: {
    handle: vi.fn(),
  },
}));

describe('folder project service', () => {
  let root: string;
  let previousUserData: string | undefined;
  let previousHexestraHome: string | undefined;
  let sessionService: typeof import('@electron/services/session.service').sessionService;
  let isVisibleSessionFileChange: typeof import('@electron/services/session.service').isVisibleSessionFileChange;
  let resolveProjectWatchPath: typeof import('@electron/services/session.service').resolveProjectWatchPath;

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-folder-projects-'));
    previousUserData = process.env.HEXESTRA_USER_DATA;
    previousHexestraHome = process.env.HEXESTRA_HOME;
    process.env.HEXESTRA_USER_DATA = path.join(root, 'user-data');
    process.env.HEXESTRA_HOME = root;
    vi.resetModules();
    const sessionModule = await import('@electron/services/session.service');
    sessionService = sessionModule.sessionService;
    isVisibleSessionFileChange = sessionModule.isVisibleSessionFileChange;
    resolveProjectWatchPath = sessionModule.resolveProjectWatchPath;
  });

  afterAll(() => {
    sessionService.close();
    electronMocks.windows = [];
    process.env.HEXESTRA_USER_DATA = previousUserData;
    process.env.HEXESTRA_HOME = previousHexestraHome;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('initializes the complete project contract inside the selected folder', async () => {
    const projectPath = path.join(root, 'alpha');
    fs.mkdirSync(projectPath, { recursive: true });
    const project = await sessionService.openProjectPath(projectPath, {
      name: 'Alpha',
      scope: 'example.com',
    });

    expect(project.basePath).toBe(projectPath);
    expect(fs.existsSync(path.join(projectPath, 'ptt.md'))).toBe(true);
    expect(fs.existsSync(path.join(projectPath, 'targets.md'))).toBe(true);
    expect(fs.existsSync(path.join(projectPath, 'findings'))).toBe(false);
    expect(fs.existsSync(path.join(projectPath, 'vulnerabilities'))).toBe(false);
    expect(fs.existsSync(path.join(projectPath, 'reports'))).toBe(false);
    expect(fs.existsSync(path.join(projectPath, 'evidence'))).toBe(false);
    expect(fs.existsSync(path.join(projectPath, '.hexestra', 'project.json'))).toBe(true);
    expect(fs.existsSync(path.join(projectPath, '.hexestra', 'project-state.json'))).toBe(true);
    expect(fs.existsSync(path.join(projectPath, '.hexestra', 'engagement.db'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'user', 'skills'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'user', 'restrictions.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(projectPath, '.hexestra', 'user', 'restrictions.yaml'))).toBe(false);
    expect(fs.existsSync(path.join(
      projectPath,
      '.claude',
      'skills',
      'hexestra-pentest',
      'SKILL.md',
    ))).toBe(true);
    expect(fs.existsSync(path.join(
      projectPath,
      '.claude',
      'skills',
      'hexestra-records',
      'SKILL.md',
    ))).toBe(true);
    expect(fs.existsSync(path.join(
      projectPath,
      '.claude',
      'skills',
      'hexestra-report',
      'SKILL.md',
    ))).toBe(true);
    expect(JSON.parse(fs.readFileSync(
      path.join(projectPath, '.claude', 'settings.local.json'),
      'utf8',
    )).skillOverrides).toMatchObject({
      pentest: 'off',
      'hexestra-pentest': 'on',
      'hexestra-records': 'on',
      'hexestra-report': 'on',
    });

    const reopened = await sessionService.openProjectPath(projectPath);
    expect(reopened.id).toBe(project.id);
    expect(sessionService.getProjectState(project.id).agent.branches[0].id).toBe('main');
    sessionService.updateProjectState(project.id, { preferences: { permissionMode: 'auto' } });
    sessionService.updateProjectState(project.id, { preferences: { permissionMode: 'default' } });
    expect(sessionService.getProjectState(project.id).preferences.permissionMode).toBe('default');
    expect(fs.existsSync(path.join(projectPath, '.hexestra', 'project-state.json.tmp'))).toBe(false);

    const metadataPath = path.join(projectPath, '.hexestra', 'project.json');
    const staleMetadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as Record<string, unknown>;
    staleMetadata.findingCount = 9;
    fs.writeFileSync(metadataPath, JSON.stringify(staleMetadata, null, 2), 'utf8');
    expect((await sessionService.openProjectPath(projectPath)).findingCount).toBe(0);
  });

  it('isolates project assets and removing a recent reference never deletes the folder', async () => {
    const alpha = (await sessionService.listSessions()).find((project) => project.name === 'Alpha');
    const betaPath = path.join(root, 'beta');
    fs.mkdirSync(betaPath, { recursive: true });
    const beta = await sessionService.openProjectPath(betaPath, {
      name: 'Beta',
      scope: 'example.net',
    });
    expect(alpha).toBeTruthy();

    const now = '2026-07-31T00:00:00.000Z';
    sessionService.addTarget(alpha!.id, {
      id: 'alpha-host',
      ip: '192.0.2.10',
      domains: ['example.com'],
      status: 'scanned',
      tags: [],
      ports: [],
      services: [],
      vulnCount: 0,
      firstSeen: now,
      lastUpdated: now,
    });

    expect(sessionService.listTargets(alpha!.id)).toHaveLength(1);
    expect(sessionService.listTargets(beta.id)).toHaveLength(0);

    await sessionService.deleteSession(beta.id);
    expect(fs.existsSync(beta.basePath)).toBe(true);
    expect((await sessionService.listSessions()).some((project) => project.id === beta.id)).toBe(false);
  });

  it('recomputes semantic scope annotations on every read without destroying scan status', async () => {
    const projectPath = path.join(root, 'scope-projection');
    fs.mkdirSync(projectPath, { recursive: true });
    const project = await sessionService.openProjectPath(projectPath, {
      name: 'Scope projection',
      scope: 'example.com',
    });
    const now = '2026-07-31T01:00:00.000Z';
    sessionService.addTarget(project.id, {
      id: 'scope-host', ip: '198.51.100.10', domains: ['api.example.com'], status: 'scanned',
      tags: [], ports: [], services: [], vulnCount: 0, firstSeen: now, lastUpdated: now,
    });
    sessionService.upsertAsset(project.id, {
      ...createAssetRecord('domain', 'api.example.com'),
      status: 'scanned',
    });

    expect(sessionService.listTargets(project.id)[0].status).toBe('scanned');
    expect(sessionService.listAssets(project.id)[0].status).toBe('scanned');

    await sessionService.updateScope(project.id, {
      mode: 'whitelist', allowRules: ['other.example.net'], excludeRules: [],
    });
    expect(sessionService.listTargets(project.id)[0]).toMatchObject({ status: 'scanned', scopeAnnotation: undefined });
    expect(sessionService.listAssets(project.id)[0]).toMatchObject({ status: 'scanned', scopeAnnotation: undefined });

    await sessionService.updateScope(project.id, {
      mode: 'whitelist', allowRules: ['example.com'], excludeRules: [],
    });
    expect(sessionService.listTargets(project.id)[0].status).toBe('scanned');
    expect(sessionService.listAssets(project.id)[0].status).toBe('scanned');
    expect(sessionService.listTargets(project.id)[0].scopeAnnotation).toBe('authorized');
    expect(sessionService.listAssets(project.id)[0].scopeAnnotation).toBe('authorized');
    expect((await sessionService.getNetMap(project.id)).assets[0].scopeAnnotation).toBe('authorized');
  });

  it('counts reusable Findings separately from validated Vulnerabilities', async () => {
    const projectPath = path.join(root, 'record-counts');
    fs.mkdirSync(projectPath, { recursive: true });
    const project = await sessionService.openProjectPath(projectPath, { name: 'Record counts', scope: 'example.org' });
    const now = '2026-08-01T00:00:00.000Z';
    const target = sessionService.addTarget(project.id, {
      id: 'count-host', ip: '192.0.2.90', domains: ['example.org'], status: 'scanned', tags: [],
      ports: [], services: [], vulnCount: 0, firstSeen: now, lastUpdated: now,
    });
    sessionService.upsertFinding(project.id, { title: 'Shared error signature', kind: 'behavior' });
    const vulnerability = sessionService.upsertVulnerability(project.id, {
      assetId: target.id, title: 'Validated access control weakness', severity: 'high',
    });

    expect(await sessionService.loadSession(project.id)).toMatchObject({ findingCount: 1, vulnerabilityCount: 1 });
    expect(sessionService.listTargets(project.id)[0].vulnCount).toBe(1);

    sessionService.upsertVulnerability(project.id, { ...vulnerability, status: 'resolved' });
    expect(await sessionService.loadSession(project.id)).toMatchObject({ findingCount: 1, vulnerabilityCount: 0 });
    expect(sessionService.listTargets(project.id)[0].vulnCount).toBe(0);
  });

  it('debounces visible nested file changes and ignores hidden project state', async () => {
    expect(isVisibleSessionFileChange('docs\\report.md')).toBe(true);
    expect(isVisibleSessionFileChange('.hexestra\\engagement.db')).toBe(false);
    expect(isVisibleSessionFileChange('docs/.cache/result.json')).toBe(false);

    const projectPath = path.join(root, 'live-files');
    fs.mkdirSync(projectPath, { recursive: true });
    const project = await sessionService.openProjectPath(projectPath, { name: 'Live files' });
    const send = vi.fn();
    electronMocks.windows = [{ isDestroyed: () => false, webContents: { send } }];
    sessionService.listFiles(project.id);

    const docsPath = path.join(projectPath, 'docs');
    fs.mkdirSync(docsPath);
    fs.writeFileSync(path.join(docsPath, 'report.md'), '# Report', 'utf8');

    await vi.waitFor(() => expect(send).toHaveBeenCalledWith(
      'session:data-changed',
      { sessionId: project.id, files: true },
    ), { timeout: 2_000 });
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(send.mock.calls.filter(([channel, change]) => (
      channel === 'session:data-changed' && change.files === true
    ))).toHaveLength(1);

    send.mockClear();
    fs.writeFileSync(path.join(projectPath, '.hexestra', 'watcher-noise.json'), '{}', 'utf8');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(send).not.toHaveBeenCalled();
  });

  it('keeps a focused Step active while its lifecycle and result are updated', async () => {
    const projectPath = path.join(root, 'persistent-task-focus');
    fs.mkdirSync(projectPath, { recursive: true });
    const project = await sessionService.openProjectPath(projectPath, {
      name: 'Persistent task focus',
    });
    const [objective] = await sessionService.planTasks(project.id, [{
      tacticId: 'TA0043',
      techniqueId: 'T1595.002',
      tasks: [{
        title: 'Scan exposed services',
        description: 'Collect a bounded service inventory.',
        successCriteria: [{ id: 'objective-criterion', text: 'Service inventory recorded', completed: false }],
      }],
    }]);
    await sessionService.focusTask(project.id, objective.id);
    const steps = await sessionService.planTaskSteps(project.id, {
      objectiveId: objective.id,
      steps: [
        { title: 'Prepare scan inputs' },
        { title: 'Run service scan' },
        { title: 'Record verified services' },
      ],
    });
    const prepared = await sessionService.upsertTaskStep(project.id, {
      id: steps[0].id,
      parentId: objective.id,
      title: steps[0].title,
      order: steps[0].order,
      successCriteria: [{ id: 'step-criterion', text: 'Inputs validated', completed: false }],
    });

    await sessionService.focusTask(project.id, prepared.id);
    await sessionService.updateTaskCriterion(project.id, prepared.id, 'step-criterion', true);
    const completed = await sessionService.upsertTaskStep(project.id, {
      id: prepared.id,
      parentId: objective.id,
      title: prepared.title,
      order: prepared.order,
      status: 'completed',
      resultSummary: 'Validated the selected hosts and scan limits.',
    });

    expect(completed).toMatchObject({
      id: prepared.id,
      status: 'completed',
      resultSummary: 'Validated the selected hosts and scan limits.',
      successCriteria: [{ id: 'step-criterion', completed: true }],
    });
    expect(sessionService.getProjectState(project.id).agent.branches[0].focusedTaskId).toBe(prepared.id);
    await expect(sessionService.upsertTaskStep(project.id, {
      id: steps[1].id,
      parentId: objective.id,
      title: 'Rename another pending Step',
    })).rejects.toThrow('Focus the Objective before changing its execution plan');
    await expect(sessionService.focusTask(project.id, prepared.id)).resolves.toMatchObject({
      activeStep: { id: prepared.id },
    });
  }, 60_000);

  it('scopes task focus, execution gates, and Agent lifecycle updates to the originating branch', async () => {
    const projectPath = path.join(root, 'branch-scoped-task-focus');
    fs.mkdirSync(projectPath, { recursive: true });
    const project = await sessionService.openProjectPath(projectPath, { name: 'Branch-scoped task focus' });
    const [objective] = await sessionService.planTasks(project.id, [{
      tacticId: 'TA0043',
      techniqueId: 'T1595.002',
      tasks: [{
        title: 'Inventory branch-specific services',
        successCriteria: [{ text: 'Branch-specific service inventory recorded' }],
      }],
    }]);
    const initialState = sessionService.getProjectState(project.id);
    const mainBranch = initialState.agent.branches[0];
    sessionService.updateProjectState(project.id, {
      agent: {
        activeBranchId: mainBranch.id,
        branches: [
          mainBranch,
          { ...mainBranch, id: 'branch-b', title: 'Branch B', runtime: null, focusedTaskId: null },
        ],
      },
    });

    await sessionService.focusTask(project.id, objective.id, 'branch-b');
    const steps = await sessionService.planTaskSteps(project.id, {
      objectiveId: objective.id,
      steps: [{ title: 'Prepare inputs' }, { title: 'Probe services' }, { title: 'Record results' }],
    }, 'branch-b');
    await sessionService.focusTask(project.id, steps[0].id, 'branch-b');

    const state = sessionService.getProjectState(project.id);
    expect(state.agent.branches.find((branch) => branch.id === mainBranch.id)?.focusedTaskId).toBeNull();
    expect(state.agent.branches.find((branch) => branch.id === 'branch-b')?.focusedTaskId).toBe(steps[0].id);
    await expect(sessionService.assertTaskExecutionReady(project.id, 'Bash', 'branch-b')).resolves.toBeUndefined();
    await expect(sessionService.assertTaskExecutionReady(project.id, 'Bash', mainBranch.id)).rejects.toThrow(
      'Create and focus an Agent Task before using execution tools',
    );
    await expect(sessionService.updateTaskStatusForBranch(project.id, steps[1].id, 'in_progress', 'branch-b')).rejects.toThrow(
      'Focus the Task or one of its Steps before updating execution state',
    );
    await expect(sessionService.updateTaskStatusForBranch(project.id, steps[0].id, 'in_progress', 'branch-b')).resolves.toMatchObject({
      id: steps[0].id,
      status: 'in_progress',
    });
    await expect(sessionService.focusTask(project.id, objective.id, 'missing-branch')).rejects.toThrow(
      'Conversation branch missing-branch not found',
    );
  }, 60_000);

  it('canonicalizes Windows watcher roots without changing POSIX paths', () => {
    const shortPath = ['C:', 'Users', 'RUNNER~1', 'AppData', 'Local', 'Temp', 'project'].join('\\');
    const longPath = ['C:', 'Users', 'runneradmin', 'AppData', 'Local', 'Temp', 'project'].join('\\');
    const resolveRealPath = vi.fn(() => longPath);

    expect(resolveProjectWatchPath(shortPath, 'win32', resolveRealPath)).toBe(longPath);
    expect(resolveRealPath).toHaveBeenCalledWith(shortPath);
    expect(resolveProjectWatchPath(shortPath, 'linux', resolveRealPath)).toBe(shortPath);
  });
});
