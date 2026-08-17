import { create } from 'zustand';
import type {
  WorkflowDocument,
  WorkflowExportResult,
  WorkflowRunPreparation,
  WorkflowSaveInput,
  WorkflowSummary,
} from '@electron/contracts/workflows';

interface WorkflowStore {
  workflows: WorkflowSummary[];
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  read: (id: string) => Promise<WorkflowDocument | null>;
  save: (input: WorkflowSaveInput) => Promise<WorkflowDocument | null>;
  remove: (id: string, expectedFingerprint?: string) => Promise<boolean>;
  importWorkflow: (sourcePath?: string, overwrite?: boolean) => Promise<{ canceled: boolean; conflict?: boolean; sourcePath?: string; workflow?: WorkflowDocument; existing?: WorkflowSummary }>;
  exportWorkflow: (id: string) => Promise<WorkflowExportResult>;
  prepareRun: (id: string, note?: string) => Promise<WorkflowRunPreparation>;
}

export const useWorkflowStore = create<WorkflowStore>((set, get) => ({
  workflows: [],
  loading: false,
  error: null,

  load: async () => {
    if (!window.hexestra) return;
    set({ loading: true, error: null });
    try {
      const workflows = await window.hexestra.invoke<WorkflowSummary[]>('workflows:list');
      set({ workflows, loading: false });
    } catch (error) {
      set({ loading: false, error: String(error) });
    }
  },

  read: async (id) => {
    if (!window.hexestra) return null;
    try {
      return await window.hexestra.invoke<WorkflowDocument | null>('workflows:read', id);
    } catch (error) {
      set({ error: String(error) });
      return null;
    }
  },

  save: async (input) => {
    if (!window.hexestra) return null;
    try {
      const workflow = await window.hexestra.invoke<WorkflowDocument>('workflows:save', input);
      await get().load();
      return workflow;
    } catch (error) {
      set({ error: String(error) });
      return null;
    }
  },

  remove: async (id, expectedFingerprint) => {
    if (!window.hexestra) return false;
    try {
      const removed = await window.hexestra.invoke<boolean>('workflows:delete', id, expectedFingerprint);
      await get().load();
      return removed;
    } catch (error) {
      set({ error: String(error) });
      return false;
    }
  },

  importWorkflow: async (sourcePath, overwrite = false) => {
    if (!window.hexestra) return { canceled: true };
    try {
      const result = await window.hexestra.invoke<{ canceled: boolean; conflict?: boolean; sourcePath?: string; workflow?: WorkflowDocument; existing?: WorkflowSummary }>('workflows:import', sourcePath, overwrite);
      if (result.workflow) await get().load();
      return result;
    } catch (error) {
      set({ error: String(error) });
      return { canceled: false };
    }
  },

  exportWorkflow: async (id) => {
    if (!window.hexestra) return { canceled: true };
    try {
      return await window.hexestra.invoke<WorkflowExportResult>('workflows:export', id);
    } catch (error) {
      set({ error: String(error) });
      return { canceled: false };
    }
  },

  prepareRun: async (id, note) => {
    if (!window.hexestra) throw new Error('Workflow execution requires the Hexestra desktop app');
    return window.hexestra.invoke<WorkflowRunPreparation>('workflows:prepare-run', id, note);
  },
}));
