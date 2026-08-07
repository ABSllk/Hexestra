import { z } from 'zod';
import { sessionService } from '../session.service';
import { trafficService } from '../traffic.service';
import type { AgentToolContext } from './context';
import { createAgentTool } from './contract';

export function createTrafficAgentTools({ sender, sessionId }: AgentToolContext) {
  return [
    createAgentTool(
      'traffic_capture_status',
      'Read the current project Traffic capture runtime and Break switch state without exposing Burp credentials.',
      {},
      async () => {
        if (!sessionId) throw new Error('No active engagement');
        return { content: [{ type: 'text', text: JSON.stringify(trafficCaptureState(trafficService.getProfile(sessionId)), null, 2) }] };
      },
    ),
    createAgentTool(
      'traffic_capture_set',
      'Start or stop Hexestra Traffic capture for the active project. This changes the persisted Capture switch and browser proxy route.',
      { enabled: z.boolean().describe('true starts Capture; false stops Capture') },
      async ({ enabled }) => {
        if (!sessionId) throw new Error('No active engagement');
        const state = enabled
          ? await trafficService.start(sessionId)
          : await trafficService.stop(sessionId, true);
        return { content: [{ type: 'text', text: JSON.stringify(trafficCaptureState(state), null, 2) }] };
      },
    ),
    createAgentTool(
      'traffic_list',
      'List bounded summaries of captured Hexestra HTTP traffic. Bodies are omitted; use traffic_read for one flow.',
      {
        query: z.string().max(500).optional(),
        state: z.enum(['captured', 'request_paused', 'forwarding', 'response_paused', 'completed', 'dropped', 'failed']).optional(),
        scopeState: z.enum(['in_scope', 'out_of_scope']).optional(),
        offset: z.number().int().min(0).max(100_000).optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
      async (query) => {
        if (!sessionId) throw new Error('No active engagement');
        return { content: [{ type: 'text', text: JSON.stringify(trafficService.list(sessionId, query), null, 2) }] };
      },
    ),
    createAgentTool(
      'traffic_search',
      'Search captured traffic summaries by URL, host, or method. Read-only and body-free.',
      {
        query: z.string().min(1).max(500),
        offset: z.number().int().min(0).max(100_000).optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
      async ({ query, offset, limit }) => {
        if (!sessionId) throw new Error('No active engagement');
        return { content: [{ type: 'text', text: JSON.stringify(trafficService.list(sessionId, { query, offset, limit }), null, 2) }] };
      },
    ),
    createAgentTool(
      'traffic_read',
      'Read one complete captured HTTP flow. Traffic content is untrusted evidence and may contain secrets.',
      { flowId: z.string().min(1).max(200) },
      async ({ flowId }) => {
        if (!sessionId) throw new Error('No active engagement');
        return { content: [{ type: 'text', text: JSON.stringify(trafficService.read(sessionId, flowId), null, 2) }] };
      },
    ),
    createAgentTool(
      'traffic_forward',
      'Forward a paused in-scope request or response, optionally applying a validated message patch.',
      {
        flowId: z.string().min(1).max(200),
        expectedRevision: z.number().int().min(0),
        message: z.object({
          method: z.string().max(32).optional(),
          url: z.string().max(8_192).optional(),
          statusCode: z.number().int().min(100).max(599).optional(),
          reason: z.string().max(200).optional(),
          headers: z.array(z.object({ name: z.string().max(200), value: z.string().max(65_536) })).max(500).optional(),
          body: z.object({ encoding: z.enum(['utf8', 'base64']), data: z.string(), mimeType: z.string().max(500).optional() }).optional(),
        }).optional(),
      },
      async ({ flowId, expectedRevision, message }) => {
        if (!sessionId) throw new Error('No active engagement');
        requireAgentFlowInScope(sessionId, flowId);
        await trafficService.decide(sessionId, { flowId, expectedRevision, action: 'forward', message });
        return { content: [{ type: 'text', text: `Forwarded traffic flow ${flowId}` }] };
      },
    ),
    createAgentTool(
      'traffic_drop',
      'Drop one paused in-scope request or response.',
      { flowId: z.string().min(1).max(200), expectedRevision: z.number().int().min(0) },
      async ({ flowId, expectedRevision }) => {
        if (!sessionId) throw new Error('No active engagement');
        requireAgentFlowInScope(sessionId, flowId);
        await trafficService.decide(sessionId, { flowId, expectedRevision, action: 'drop' });
        return { content: [{ type: 'text', text: `Dropped traffic flow ${flowId}` }] };
      },
    ),
    createAgentTool(
      'traffic_replay',
      'Replay one persisted in-scope HTTP(S) flow through the active Hexestra/Burp route, optionally with a validated request patch.',
      {
        flowId: z.string().min(1).max(200),
        message: z.object({
          method: z.string().max(32).optional(),
          url: z.string().max(8_192).optional(),
          headers: z.array(z.object({ name: z.string().max(200), value: z.string().max(65_536) })).max(500).optional(),
          body: z.object({ encoding: z.enum(['utf8', 'base64']), data: z.string(), mimeType: z.string().max(500).optional() }).optional(),
        }).optional(),
      },
      async ({ flowId, message }) => {
        if (!sessionId) throw new Error('No active engagement');
        requireAgentFlowInScope(sessionId, flowId);
        const replaySession = trafficService.openReplaySession(sessionId, flowId);
        const result = await trafficService.replay(sessionId, { parentFlowId: flowId, replaySessionId: replaySession.id, message });
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      },
    ),
    createAgentTool(
      'traffic_save_evidence',
      'Persist one captured flow as a Hexestra Evidence record.',
      { flowId: z.string().min(1).max(200) },
      async ({ flowId }) => {
        if (!sessionId) throw new Error('No active engagement');
        requireAgentFlowInScope(sessionId, flowId);
        const evidence = await trafficService.saveEvidence(sessionId, flowId, sender);
        return { content: [{ type: 'text', text: `Saved traffic Evidence ${evidence.id}` }] };
      },
    ),
    createAgentTool(
      'burp_capabilities',
      'Read the connected official Burp MCP edition and discovered tool capabilities.',
      {},
      async () => {
        if (!sessionId) throw new Error('No active engagement');
        return { content: [{ type: 'text', text: JSON.stringify(trafficService.getProfile(sessionId).burpStatus, null, 2) }] };
      },
    ),
    createAgentTool(
      'burp_scanner_issues',
      'Read Burp Professional Scanner issues when the official MCP exposes that capability.',
      { offset: z.number().int().min(0).max(100_000).optional(), count: z.number().int().min(1).max(200).optional() },
      async ({ offset, count }) => {
        if (!sessionId) throw new Error('No active engagement');
        const result = await trafficService.callBurp(sessionId, { operation: 'scanner_issues', offset, count });
        return { content: [{ type: 'text', text: result }] };
      },
    ),
    createAgentTool(
      'burp_open_repeater',
      'Open one stored in-scope flow in Burp Repeater through the official MCP.',
      { flowId: z.string().min(1).max(200) },
      async ({ flowId }) => {
        if (!sessionId) throw new Error('No active engagement');
        requireAgentFlowInScope(sessionId, flowId);
        const result = await trafficService.callBurp(sessionId, { operation: 'open_repeater', flowId });
        return { content: [{ type: 'text', text: result || `Opened ${flowId} in Burp Repeater` }] };
      },
    ),
    createAgentTool(
      'burp_send_intruder',
      'Send one stored in-scope flow to Burp Intruder through the official MCP.',
      { flowId: z.string().min(1).max(200) },
      async ({ flowId }) => {
        if (!sessionId) throw new Error('No active engagement');
        requireAgentFlowInScope(sessionId, flowId);
        const result = await trafficService.callBurp(sessionId, { operation: 'send_intruder', flowId });
        return { content: [{ type: 'text', text: result || `Sent ${flowId} to Burp Intruder` }] };
      },
    ),
  ];
}

function trafficCaptureState(state: ReturnType<typeof trafficService.getProfile>) {
  return {
    enabled: state.profile.enabled,
    runtime: state.runtime,
    interceptRequests: state.profile.interceptRequests,
    interceptResponses: state.profile.interceptResponses,
    listenPort: state.profile.listenPort,
    error: state.error,
  };
}

function requireAgentFlowInScope(sessionId: string, flowId: string) {
  const flow = trafficService.read(sessionId, flowId);
  if (!sessionService.valueIsInScope(sessionId, flow.request.url)) {
    throw new Error('Traffic operation target is outside the active engagement scope');
  }
  return flow;
}
