import type {
  AgentAdapter,
  AgentBackendId,
} from '../../contracts/agent-runtime';

export class AgentAdapterRegistry {
  private readonly adapters = new Map<AgentBackendId, AgentAdapter>();

  register(adapter: AgentAdapter) {
    if (this.adapters.has(adapter.id)) {
      throw new Error(`Agent backend already registered: ${adapter.id}`);
    }
    this.adapters.set(adapter.id, adapter);
  }

  get(id: AgentBackendId) {
    return this.adapters.get(id);
  }

  require(id: AgentBackendId) {
    const adapter = this.get(id);
    if (!adapter) throw new Error(`Agent backend is unavailable: ${id}`);
    return adapter;
  }

  has(id: AgentBackendId) {
    return this.adapters.has(id);
  }

  list() {
    return [...this.adapters.values()];
  }
}
