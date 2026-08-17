import { app, ipcMain } from 'electron';
import { spawn, type ChildProcess } from 'child_process';
import { v4 as uuid } from 'uuid';
import { projectProxyEnvironment } from './project-egress';
import { defaultToolCatalog, loadToolCatalog } from './tool-catalog.service';

interface ToolRun {
  id: string;
  tool: string;
  args: string[];
  status: 'running' | 'completed' | 'failed';
  process: ChildProcess;
  startedAt: string;
  completedAt?: string;
  exitCode?: number;
  stdout: string;
  stderr: string;
}

class ToolExecutor {
  private runs: Map<string, ToolRun> = new Map();

  // Inventory is resolved from the ATT&CK-aware catalog.
  get inventory() {
    try {
      return this.catalogInventory(loadToolCatalog(app.getPath('userData')));
    } catch {
      return this.catalogInventory(defaultToolCatalog());
    }
  }

  private catalogInventory(tools: ReturnType<typeof defaultToolCatalog>) {
    return tools.map((tool) => ({
      id: tool.id,
      name: tool.name,
      binary: tool.executable ?? tool.id,
      category: tool.capabilities[0] ?? tool.risk,
      description: tool.description,
      capabilities: tool.capabilities,
      tacticIds: tool.tacticIds,
      techniqueIds: tool.techniqueIds,
      risk: tool.risk,
      channel: tool.channel,
      disabled: tool.disabled ?? false,
      available: tool.available,
    }));
  }

  constructor() {
    this.registerHandlers();
  }

  private registerHandlers() {
    ipcMain.handle('tools:inventory', async () => {
      return this.inventory;
    });

    ipcMain.handle('tools:run', async (_event, tool: string, args: string[], cwd?: string, projectId?: string) => {
      return this.execute(tool, args, cwd, projectId);
    });

    ipcMain.handle('tools:kill', async (_event, runId: string) => {
      this.kill(runId);
    });

    ipcMain.handle('tools:status', async (_event, runId: string) => {
      return this.getStatus(runId);
    });

    ipcMain.handle('tools:runs', async () => {
      return this.listRuns();
    });
  }

  execute(tool: string, args: string[], cwd?: string, projectId?: string): string {
    const definition = this.inventory.find((candidate) => candidate.id === tool || candidate.binary === tool);
    if (!definition || definition.disabled) throw new Error(`Tool ${tool} is not enabled in the tool catalog`);
    if (definition.available === false) throw new Error(`Tool ${tool} is unavailable; probe or install it in the local Agent Runtime first`);
    const executable = definition.binary;
    const id = `run-${uuid().slice(0, 8)}`;
    console.log(`[Tool] Starting ${executable} ${args.join(' ')} (${id})`);

    const child = spawn(executable, args, {
      cwd: cwd || process.cwd(),
      shell: false,
      env: {
        ...(projectId ? projectProxyEnvironment(projectId, process.env) : process.env),
        ELECTRON_RUN_AS_NODE: undefined,
      },
    });

    const run: ToolRun = {
      id,
      tool: definition.id,
      args,
      status: 'running',
      process: child,
      startedAt: new Date().toISOString(),
      stdout: '',
      stderr: '',
    };

    // Stream stdout
    child.stdout?.on('data', (data: Buffer) => {
      run.stdout += data.toString();
      this.emitOutput(id, 'stdout', data.toString());
    });

    // Stream stderr
    child.stderr?.on('data', (data: Buffer) => {
      run.stderr += data.toString();
      this.emitOutput(id, 'stderr', data.toString());
    });

    // Handle completion
    child.on('close', (code) => {
      run.status = code === 0 ? 'completed' : 'failed';
      run.exitCode = code ?? undefined;
      run.completedAt = new Date().toISOString();
      this.emitComplete(id, code ?? 1, run.stdout, run.stderr);
      console.log(`[Tool] ${executable} finished with code ${code} (${id})`);
    });

    child.on('error', (err) => {
      run.status = 'failed';
      run.completedAt = new Date().toISOString();
      this.emitComplete(id, 1, run.stdout, err.message);
      console.error(`[Tool] ${executable} error: ${err.message} (${id})`);
    });

    this.runs.set(id, run);
    return id;
  }

  kill(runId: string) {
    const run = this.runs.get(runId);
    if (run && run.status === 'running') {
      run.process.kill();
      console.log(`[Tool] Killed ${runId}`);
    }
  }

  getStatus(runId: string) {
    const run = this.runs.get(runId);
    if (!run) return null;
    return {
      id: run.id,
      tool: run.tool,
      args: run.args,
      status: run.status,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      exitCode: run.exitCode,
    };
  }

  listRuns() {
    return Array.from(this.runs.values()).map((r) => ({
      id: r.id,
      tool: r.tool,
      args: r.args,
      status: r.status,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      exitCode: r.exitCode,
    }));
  }

  // ============================================================
  // Event emitters — send to all windows
  // ============================================================

  private emitOutput(runId: string, stream: string, data: string) {
    const { BrowserWindow } = require('electron');
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('tools:output', { runId, stream, data });
      }
    }
  }

  private emitComplete(runId: string, exitCode: number, stdout: string, stderr: string) {
    const { BrowserWindow } = require('electron');
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('tools:complete', { runId, exitCode, stdout, stderr });
      }
    }
  }
}

export const toolExecutor = new ToolExecutor();
