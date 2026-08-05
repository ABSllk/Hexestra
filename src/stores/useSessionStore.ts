import { create } from 'zustand';
import { RECORDS_IPC } from '@electron/contracts/records';
import type {
  AsmFinding,
  AsmFindingInput,
  AssetChangeRecord,
  AssetRecord,
  EvidenceInput,
  EvidenceRecord,
  GraphEdge,
  ManagedRecordKind,
  ScanRunRecord,
  ReportInput,
  ReportRecord,
  Session,
  SessionFileEntry,
  SessionSummary,
  Target,
  VulnerabilityInput,
  VulnerabilityRecord,
} from '@/types';

interface SessionNetMap {
  version: 3;
  assets?: AssetRecord[];
  edges: GraphEdge[];
}

const LAST_PROJECT_KEY = 'hexestra:last-project';
const LEGACY_LAST_PROJECT_KEY = 'pengent:last-project';

function readLastProjectId() {
  const current = window.localStorage.getItem(LAST_PROJECT_KEY);
  if (current) return current;
  const legacy = window.localStorage.getItem(LEGACY_LAST_PROJECT_KEY);
  if (legacy) {
    window.localStorage.setItem(LAST_PROJECT_KEY, legacy);
    window.localStorage.removeItem(LEGACY_LAST_PROJECT_KEY);
  }
  return legacy;
}

function rememberLastProject(id: string) {
  window.localStorage.setItem(LAST_PROJECT_KEY, id);
  window.localStorage.removeItem(LEGACY_LAST_PROJECT_KEY);
}

interface SessionStore {
  sessions: SessionSummary[];
  currentSession: Session | null;
  isLoading: boolean;
  error: string | null;
  targets: Target[];
  assets: AssetRecord[];
  netmapEdges: GraphEdge[];
  files: SessionFileEntry[];
  scanRuns: ScanRunRecord[];
  assetChanges: AssetChangeRecord[];
  findings: AsmFinding[];
  vulnerabilities: VulnerabilityRecord[];
  evidenceRecords: EvidenceRecord[];
  reports: ReportRecord[];

  loadSessionList: () => Promise<void>;
  openProjectFolder: () => Promise<Session | null>;
  createProjectFolder: () => Promise<Session | null>;
  loadSession: (id: string) => Promise<Session>;
  closeSession: () => void;
  deleteSession: (id: string) => Promise<void>;
  loadTargets: (sessionId?: string) => Promise<Target[]>;
  loadNetMap: (sessionId?: string) => Promise<GraphEdge[]>;
  loadFiles: (relativePath?: string) => Promise<SessionFileEntry[]>;
  loadAsm: (sessionId?: string) => Promise<void>;
  upsertFinding: (finding: AsmFindingInput) => Promise<AsmFinding | null>;
  upsertVulnerability: (vulnerability: VulnerabilityInput) => Promise<VulnerabilityRecord | null>;
  upsertEvidence: (evidence: EvidenceInput) => Promise<EvidenceRecord | null>;
  upsertReport: (report: ReportInput) => Promise<ReportRecord | null>;
  deleteManagedRecord: (kind: ManagedRecordKind, recordId: string) => Promise<boolean>;
  updateScope: (scope: NonNullable<Session['scope']>) => Promise<void>;
  applyScope: (scope: NonNullable<Session['scope']>) => void;
  setError: (error: string | null) => void;
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: [],
  currentSession: null,
  isLoading: false,
  error: null,
  targets: [],
  assets: [],
  netmapEdges: [],
  files: [],
  scanRuns: [],
  assetChanges: [],
  findings: [],
  vulnerabilities: [],
  evidenceRecords: [],
  reports: [],

  loadSessionList: async () => {
    set({ isLoading: true, error: null });
    try {
      if (window.hexestra) {
        const sessions = await window.hexestra.invoke<SessionSummary[]>('project:list-recent');
        const lastSessionId = readLastProjectId();
        if (lastSessionId && !get().currentSession && sessions.some((session) => session.id === lastSessionId)) {
          const currentSession = await window.hexestra.invoke<Session>('project:open-recent', lastSessionId);
          set({ sessions, currentSession, targets: [], assets: [], netmapEdges: [], files: [], scanRuns: [], assetChanges: [], findings: [], vulnerabilities: [], evidenceRecords: [], reports: [], isLoading: false });
        } else {
          set({ sessions, isLoading: false });
        }
      } else {
        set({ isLoading: false });
      }
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  openProjectFolder: async () => {
    set({ isLoading: true, error: null });
    try {
      if (!window.hexestra) throw new Error('Open Folder requires the Hexestra desktop app');
      const session = await window.hexestra.invoke<Session | null>('project:open-folder');
      if (!session) {
        set({ isLoading: false });
        return null;
      }
      const sessions = await window.hexestra.invoke<SessionSummary[]>('project:list-recent');
      rememberLastProject(session.id);
      set({
        currentSession: session,
        targets: [], assets: [],
        netmapEdges: [],
        files: [], scanRuns: [], assetChanges: [], findings: [], vulnerabilities: [], evidenceRecords: [], reports: [],
        sessions,
        isLoading: false,
      });
      return session;
    } catch (e) {
      set({ error: String(e), isLoading: false });
      throw e;
    }
  },

  createProjectFolder: async () => {
    set({ isLoading: true, error: null });
    try {
      if (!window.hexestra) throw new Error('New Project Folder requires the Hexestra desktop app');
      const session = await window.hexestra.invoke<Session | null>('project:create-folder');
      if (!session) {
        set({ isLoading: false });
        return null;
      }
      const sessions = await window.hexestra.invoke<SessionSummary[]>('project:list-recent');
      rememberLastProject(session.id);
      set({
        currentSession: session,
        targets: [], assets: [], netmapEdges: [], files: [],
        scanRuns: [], assetChanges: [], findings: [], vulnerabilities: [], evidenceRecords: [], reports: [], sessions, isLoading: false,
      });
      return session;
    } catch (e) {
      set({ error: String(e), isLoading: false });
      throw e;
    }
  },

  loadSession: async (id) => {
    set({ isLoading: true, error: null });
    try {
      if (window.hexestra) {
        const session = await window.hexestra.invoke<Session>('project:open-recent', id);
        rememberLastProject(session.id);
        set({ currentSession: session, targets: [], assets: [], netmapEdges: [], files: [], scanRuns: [], assetChanges: [], findings: [], vulnerabilities: [], evidenceRecords: [], reports: [], isLoading: false });
        return session;
      }
      throw new Error('Session not found (no IPC)');
    } catch (e) {
      set({ error: String(e), isLoading: false });
      throw e;
    }
  },

  closeSession: () => {
    window.localStorage.removeItem(LAST_PROJECT_KEY);
    window.localStorage.removeItem(LEGACY_LAST_PROJECT_KEY);
    set({ currentSession: null, targets: [], assets: [], netmapEdges: [], files: [], scanRuns: [], assetChanges: [], findings: [], vulnerabilities: [], evidenceRecords: [], reports: [] });
  },

  deleteSession: async (id) => {
    try {
      if (window.hexestra) {
        await window.hexestra.invoke('project:remove-recent', id);
      }
      set((s) => ({
        sessions: s.sessions.filter((sess) => sess.id !== id),
      }));
    } catch (e) {
      set({ error: String(e) });
    }
  },

  loadTargets: async (sessionId) => {
    const id = sessionId ?? get().currentSession?.id;
    if (!id || !window.hexestra) return [];
    try {
      const targets = await window.hexestra.invoke<Target[]>('targets:list', id);
      set({ targets });
      return targets;
    } catch (e) {
      set({ error: String(e) });
      return [];
    }
  },

  loadNetMap: async (sessionId) => {
    const id = sessionId ?? get().currentSession?.id;
    if (!id || !window.hexestra) return [];
    try {
      const graph = await window.hexestra.invoke<SessionNetMap>('netmap:get', id);
      const netmapEdges = graph.edges ?? [];
      set({ netmapEdges, assets: graph.assets ?? [] });
      return netmapEdges;
    } catch (e) {
      set({ error: String(e) });
      return [];
    }
  },

  loadFiles: async (relativePath = '') => {
    const id = get().currentSession?.id;
    if (!id || !window.hexestra) return [];
    try {
      const files = await window.hexestra.invoke<SessionFileEntry[]>('files:list', id, relativePath);
      if (!relativePath) set({ files });
      return files;
    } catch (e) {
      set({ error: String(e) });
      return [];
    }
  },

  loadAsm: async (sessionId) => {
    const id = sessionId ?? get().currentSession?.id;
    if (!id || !window.hexestra) return;
    try {
      const [scanRuns, assetChanges, findings, vulnerabilities, evidenceRecords, reports] = await Promise.all([
        window.hexestra.invoke<ScanRunRecord[]>('asm:scan-runs', id),
        window.hexestra.invoke<AssetChangeRecord[]>('asm:changes', id),
        window.hexestra.invoke<AsmFinding[]>('findings:list', id),
        window.hexestra.invoke<VulnerabilityRecord[]>('vulnerabilities:list', id),
        window.hexestra.invoke<EvidenceRecord[]>('evidence:list', id),
        window.hexestra.invoke<ReportRecord[]>('reports:list', id),
      ]);
      if (get().currentSession?.id === id) {
        const findingCount = findings.filter((finding) => finding.status !== 'archived').length;
        const vulnerabilityCount = vulnerabilities
          .filter((vulnerability) => vulnerability.status !== 'resolved').length;
        set((state) => ({
          scanRuns,
          assetChanges,
          findings,
          vulnerabilities,
          evidenceRecords,
          reports,
          currentSession: state.currentSession
            ? { ...state.currentSession, findingCount, vulnerabilityCount }
            : null,
          sessions: state.sessions.map((session) =>
            session.id === id ? { ...session, findingCount, vulnerabilityCount } : session
          ),
        }));
      }
    } catch (e) {
      set({ error: String(e) });
    }
  },

  upsertFinding: async (finding) => {
    const id = get().currentSession?.id;
    if (!id || !window.hexestra) return null;
    try {
      const result = await window.hexestra.invoke<AsmFinding>('findings:upsert', id, finding);
      await get().loadAsm(id);
      return result;
    } catch (e) {
      set({ error: String(e) });
      return null;
    }
  },

  upsertVulnerability: async (vulnerability) => {
    const id = get().currentSession?.id;
    if (!id || !window.hexestra) return null;
    try {
      const result = await window.hexestra.invoke<VulnerabilityRecord>(
        'vulnerabilities:upsert', id, vulnerability,
      );
      const [updated] = await Promise.all([
        window.hexestra.invoke<Session>('project:open-recent', id),
        get().loadAsm(id),
        get().loadTargets(id),
        get().loadNetMap(id),
      ]);
      if (get().currentSession?.id === id) set({ currentSession: updated });
      return result;
    } catch (e) {
      set({ error: String(e) });
      return null;
    }
  },

  upsertEvidence: async (evidence) => {
    const id = get().currentSession?.id;
    if (!id || !window.hexestra) return null;
    try {
      const result = await window.hexestra.invoke<EvidenceRecord>('evidence:upsert', id, evidence);
      await get().loadAsm(id);
      return result;
    } catch (e) {
      set({ error: String(e) });
      return null;
    }
  },

  upsertReport: async (report) => {
    const id = get().currentSession?.id;
    if (!id || !window.hexestra) return null;
    try {
      const result = await window.hexestra.invoke<ReportRecord>('reports:upsert', id, report);
      await get().loadAsm(id);
      return result;
    } catch (e) {
      set({ error: String(e) });
      return null;
    }
  },

  deleteManagedRecord: async (kind, recordId) => {
    const id = get().currentSession?.id;
    if (!id || !window.hexestra) return false;
    try {
      const deleted = await window.hexestra.invoke<boolean>(RECORDS_IPC.DELETE, id, kind, recordId);
      if (!deleted) return false;
      await Promise.all([
        get().loadAsm(id),
        ...(kind === 'vulnerability' ? [get().loadTargets(id), get().loadNetMap(id)] : []),
      ]);
      return true;
    } catch (e) {
      set({ error: String(e) });
      return false;
    }
  },

  updateScope: async (scope) => {
    const session = get().currentSession;
    if (!session || !window.hexestra) return;
    try {
      const updated = await window.hexestra.invoke<Session>('scope:update', session.id, scope);
      if (get().currentSession?.id === updated.id) {
        set({ currentSession: updated });
        await Promise.all([get().loadTargets(updated.id), get().loadNetMap(updated.id)]);
      }
    } catch (e) {
      set({ error: String(e) });
    }
  },

  applyScope: (scope) => set((state) => ({
    currentSession: state.currentSession ? { ...state.currentSession, scope } : null,
  })),

  setError: (error) => set({ error }),
}));
