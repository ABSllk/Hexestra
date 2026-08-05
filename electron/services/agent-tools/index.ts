import type { AgentToolContext } from './context';
import { createBrowserAgentTools } from './browser-tools';
import { createProjectAgentTools } from './project-tools';
import { createShellAgentTools } from './shell-tools';
import { createTrafficAgentTools } from './traffic-tools';

export function createHexestraAgentTools(context: AgentToolContext) {
  return [
    ...createBrowserAgentTools(context),
    ...createShellAgentTools(context),
    ...createTrafficAgentTools(context),
    ...createProjectAgentTools(context),
  ];
}
