import { ipcMain } from 'electron';
import { spawn, type ChildProcess } from 'child_process';
import { v4 as uuid } from 'uuid';

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

  // Tool inventory — mirrors pentest-tools.yaml
  readonly inventory: Array<{
    id: string;
    name: string;
    binary: string;
    category: string;
    description: string;
  }> = [
    { id: 'nmap', name: 'Nmap', binary: 'nmap', category: 'scanning', description: 'Network discovery and port scanning' },
    { id: 'gobuster', name: 'Gobuster', binary: 'gobuster', category: 'scanning', description: 'Directory/file brute-forcing' },
    { id: 'ffuf', name: 'FFUF', binary: 'ffuf', category: 'fuzzing', description: 'Web fuzzer' },
    { id: 'nuclei', name: 'Nuclei', binary: 'nuclei', category: 'scanning', description: 'Template-based vulnerability scanner' },
    { id: 'sqlmap', name: 'SQLMap', binary: 'sqlmap', category: 'exploitation', description: 'SQL injection tool' },
    { id: 'nikto', name: 'Nikto', binary: 'nikto', category: 'scanning', description: 'Web server scanner' },
    { id: 'curl', name: 'cURL', binary: 'curl', category: 'utility', description: 'HTTP client' },
    { id: 'python3', name: 'Python 3', binary: 'python3', category: 'utility', description: 'Python interpreter' },
  ];

  constructor() {
    this.registerHandlers();
  }

  private registerHandlers() {
    ipcMain.handle('tools:inventory', async () => {
      return this.inventory;
    });

    ipcMain.handle('tools:run', async (_event, tool: string, args: string[], cwd?: string) => {
      return this.execute(tool, args, cwd);
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

  execute(tool: string, args: string[], cwd?: string): string {
    const id = `run-${uuid().slice(0, 8)}`;
    console.log(`[Tool] Starting ${tool} ${args.join(' ')} (${id})`);

    const child = spawn(tool, args, {
      cwd: cwd || process.cwd(),
      shell: false,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: undefined,
      },
    });

    const run: ToolRun = {
      id,
      tool,
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
      console.log(`[Tool] ${tool} finished with code ${code} (${id})`);
    });

    child.on('error', (err) => {
      run.status = 'failed';
      run.completedAt = new Date().toISOString();
      this.emitComplete(id, 1, run.stdout, err.message);
      console.error(`[Tool] ${tool} error: ${err.message} (${id})`);
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
