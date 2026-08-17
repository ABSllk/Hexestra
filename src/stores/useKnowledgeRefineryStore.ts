import { create } from 'zustand';
import type { KnowledgeSource, RefineryJob } from '@/types';

interface KnowledgeRefineryStore {
  projectId: string | null;
  sources: KnowledgeSource[];
  jobs: RefineryJob[];
  loading: boolean;
  error: string | null;
  selectedSourceId: string | null;
  selectedJobId: string | null;
  load: (sessionId?: string | null) => Promise<void>;
  importSources: () => Promise<KnowledgeSource[]>;
  createJobFromSource: (sourceId: string) => Promise<RefineryJob | null>;
  createConversationJob: (branchId: string) => Promise<RefineryJob | null>;
  selectSource: (sourceId: string | null) => void;
  selectJob: (jobId: string | null) => void;
  reset: () => void;
}

export const useKnowledgeRefineryStore = create<KnowledgeRefineryStore>((set, get) => ({
  projectId: null,
  sources: [],
  jobs: [],
  loading: false,
  error: null,
  selectedSourceId: null,
  selectedJobId: null,

  load: async (sessionId) => {
    if (!window.hexestra) return;
    const current = sessionId ?? get().projectId;
    if (!current) return;
    set({ loading: true, error: null });
    try {
      const [sources, jobs] = await Promise.all([
        window.hexestra.invoke<KnowledgeSource[]>('refinery:sources:list'),
        window.hexestra.invoke<RefineryJob[]>('refinery:jobs:list', current),
      ]);
      if (get().projectId && get().projectId !== current) return;
      set((state) => ({
        projectId: current,
        sources,
        jobs,
        loading: false,
        selectedSourceId: state.selectedSourceId && sources.some((source) => source.id === state.selectedSourceId) ? state.selectedSourceId : sources[0]?.id ?? null,
        selectedJobId: state.selectedJobId && jobs.some((job) => job.id === state.selectedJobId) ? state.selectedJobId : jobs[0]?.id ?? null,
      }));
    } catch (error) {
      set({ loading: false, error: String(error) });
    }
  },

  importSources: async () => {
    if (!window.hexestra) return [];
    try {
      const sources = await window.hexestra.invoke<KnowledgeSource[]>('refinery:sources:import');
      const sessionId = get().projectId;
      if (sessionId) await get().load(sessionId);
      return sources;
    } catch (error) {
      set({ error: String(error) });
      return [];
    }
  },

  createJobFromSource: async (sourceId) => {
    const sessionId = get().projectId;
    if (!window.hexestra || !sessionId) return null;
    try {
      const job = await window.hexestra.invoke<RefineryJob>('refinery:jobs:create-from-source', sessionId, sourceId);
      set({ selectedJobId: job.id });
      await get().load(sessionId);
      return job;
    } catch (error) {
      set({ error: String(error) });
      return null;
    }
  },

  createConversationJob: async (branchId) => {
    const sessionId = get().projectId;
    if (!window.hexestra || !sessionId) return null;
    try {
      const job = await window.hexestra.invoke<RefineryJob>('refinery:jobs:create-from-conversation', sessionId, branchId);
      set({ selectedJobId: job.id });
      await get().load(sessionId);
      return job;
    } catch (error) {
      set({ error: String(error) });
      return null;
    }
  },

  selectSource: (selectedSourceId) => set({ selectedSourceId }),
  selectJob: (selectedJobId) => set({ selectedJobId }),
  reset: () => set({ projectId: null, sources: [], jobs: [], loading: false, error: null, selectedSourceId: null, selectedJobId: null }),
}));
