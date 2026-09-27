import { randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import http, { type Server } from 'http';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { AgentInteractionHandler } from '../../contracts/agent-runtime';
import type { AgentToolDefinition } from '../../contracts/agent-tools';
import { parseAskUserQuestionInput } from '../../agent-interaction-contract';

export class CodexToolBridge {
  private readonly token = randomBytes(32).toString('hex');
  private server: Server | null = null;
  private sessions = new Map<string, { mcp: McpServer; transport: StreamableHTTPServerTransport }>();
  private definitions = new Map<string, AgentToolDefinition>();
  private interactions: AgentInteractionHandler | null = null;
  private signal: AbortSignal | null = null;
  private scheduleWakeup: ((delayMs: number, prompt: string) => string) | null = null;
  private port = 0;

  constructor(private readonly allowWsl: boolean) {}

  async start(definitions: AgentToolDefinition[]) {
    if (this.server) return;
    this.definitions = new Map(definitions.map((definition) => [definition.name, definition]));
    const createSession = async () => {
    const mcp = new McpServer({ name: 'hexestra', version: '0.8.0' });
    for (const definition of definitions) {
      mcp.registerTool(definition.name, {
        description: definition.description,
        inputSchema: definition.inputSchema,
        annotations: { readOnlyHint: definition.riskLevel === 'read' },
      }, async (raw) => {
        const active = this.definitions.get(definition.name);
        const signal = this.signal;
        if (!active || !this.interactions || !signal || signal.aborted) {
          return { content: [{ type: 'text', text: 'No active Hexestra Agent turn' }], isError: true };
        }
        const input = z.object(active.inputSchema).parse(raw);
        const decision = await this.interactions.authorizeTool({
          toolName: active.name, riskLevel: active.riskLevel, input, toolUseId: randomUUID(), signal,
        });
        if (decision.behavior !== 'allow' || signal.aborted) {
          return { content: [{ type: 'text', text: decision.message ?? 'Tool request denied' }], isError: true };
        }
        return active.execute(decision.updatedInput ?? input);
      });
    }
    mcp.registerTool('AskUserQuestion', {
      description: 'Ask the Hexestra operator a clarifying question and wait for their answer.',
      inputSchema: { questions: z.array(z.object({
        question: z.string(), header: z.string(), multiSelect: z.boolean(),
        options: z.array(z.object({ label: z.string(), description: z.string(), preview: z.string().optional() })),
      })) },
    }, async (raw) => {
      const signal = this.signal;
      if (!this.interactions || !signal || signal.aborted) return { content: [{ type: 'text', text: 'No active Hexestra Agent turn' }], isError: true };
      const questions = parseAskUserQuestionInput(raw);
      const answers = await this.interactions.requestAnswers({
        toolName: 'AskUserQuestion', input: raw, toolUseId: randomUUID(), signal, questions,
      });
      return { content: [{ type: 'text', text: JSON.stringify({ answers }) }] };
    });
    mcp.registerTool('ScheduleWakeup', {
      description: 'Schedule one Hexestra-managed follow-up turn in this Codex conversation. One-shot only, from 1 second to 24 hours.',
      inputSchema: { delaySeconds: z.number().int().min(1).max(86_400), prompt: z.string().trim().min(1).max(8_000) },
    }, async ({ delaySeconds, prompt }) => {
      if (!this.scheduleWakeup || !this.signal || this.signal.aborted || !this.interactions) {
        return { content: [{ type: 'text', text: 'No active Codex conversation for scheduling' }], isError: true };
      }
      const decision = await this.interactions.authorizeTool({ toolName: 'ScheduleWakeup', riskLevel: 'write',
        input: { delaySeconds, prompt }, toolUseId: randomUUID(), signal: this.signal });
      if (decision.behavior !== 'allow' || this.signal.aborted) {
        return { content: [{ type: 'text', text: decision.message ?? 'Schedule denied' }], isError: true };
      }
      const id = this.scheduleWakeup(delaySeconds * 1_000, prompt);
      return { content: [{ type: 'text', text: JSON.stringify({ id, dueAt: new Date(Date.now() + delaySeconds * 1_000).toISOString() }) }] };
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID, enableJsonResponse: true });
    await mcp.connect(transport);
    return { mcp, transport };
    };
    const server = http.createServer((req, res) => {
      if (req.url !== '/mcp') { res.writeHead(404).end(); return; }
      const supplied = String(req.headers.authorization ?? '').replace(/^Bearer /i, '');
      const left = Buffer.from(supplied);
      const right = Buffer.from(this.token);
      if (left.length !== right.length || !timingSafeEqual(left, right)) { res.writeHead(401).end(); return; }
      void (async () => {
        const sessionId = req.headers['mcp-session-id'];
        const existing = typeof sessionId === 'string' ? this.sessions.get(sessionId) : undefined;
        if (sessionId && !existing) { res.writeHead(404).end('Unknown MCP session'); return; }
        if (!existing && req.method !== 'POST') { res.writeHead(400).end('MCP initialization requires POST'); return; }
        const session = existing ?? await createSession();
        try {
          await session.transport.handleRequest(req, res);
          const initializedId = session.transport.sessionId;
          if (!existing && initializedId) this.sessions.set(initializedId, session);
          else if (!existing) await session.mcp.close();
          if (req.method === 'DELETE' && typeof sessionId === 'string') {
            this.sessions.delete(sessionId);
            await session.mcp.close();
          }
        } catch (error) {
          if (!existing) await session.mcp.close();
          throw error;
        }
      })().catch((error) => {
        console.error('[Codex MCP] request failed', error);
        if (!res.headersSent) res.writeHead(500).end(String(error));
      });
    });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, this.allowWsl ? '0.0.0.0' : '127.0.0.1', () => {
          server.off('error', reject);
          resolve();
        });
      });
    } catch (error) {
      throw error;
    }
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Hexestra MCP bridge has no TCP address');
    this.port = address.port;
    this.server = server;
  }

  bind(definitions: AgentToolDefinition[], interactions: AgentInteractionHandler, signal: AbortSignal,
    scheduleWakeup?: (delayMs: number, prompt: string) => string) {
    this.definitions = new Map(definitions.map((definition) => [definition.name, definition]));
    this.interactions = interactions;
    this.signal = signal;
    this.scheduleWakeup = scheduleWakeup ?? null;
  }

  get bearerToken() { return this.token; }
  url(host = '127.0.0.1') { return `http://${host}:${this.port}/mcp`; }

  unbind() {
    this.signal = null;
    this.interactions = null;
    this.scheduleWakeup = null;
  }

  async close() {
    this.unbind();
    await Promise.all([...this.sessions.values()].map((session) => session.mcp.close()));
    this.sessions.clear();
    if (this.server) await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = null;
  }
}
