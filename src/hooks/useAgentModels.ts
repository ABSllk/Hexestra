import { useEffect, useState } from 'react';
import type { AgentModelOption } from '@electron/contracts/agent-runtime';
import { useI18n } from '@/i18n';

export type ModelBackendId = 'claude' | 'codex';

type CatalogState = { key: string; models: AgentModelOption[]; loading: boolean; error: string | null };

export function useAgentModels(backendId: ModelBackendId, enabled: boolean, sessionId?: string | null, refreshKey = 0) {
  const { t } = useI18n();
  const key = JSON.stringify([backendId, sessionId ?? null, refreshKey, enabled]);
  const [catalog, setCatalog] = useState<CatalogState>({ key: '', models: [], loading: false, error: null });

  useEffect(() => {
    if (!enabled || !window.hexestra) {
      setCatalog({ key, models: [], loading: false, error: null });
      return;
    }
    let active = true;
    setCatalog({ key, models: [], loading: true, error: null });
    void window.hexestra.invoke<AgentModelOption[]>('agent:models:list', backendId, sessionId ?? null)
      .then((value) => {
        if (!active) return;
        setCatalog({ key, models: value, loading: false, error: null });
      })
      .catch((reason) => {
        if (!active) return;
        setCatalog({ key, models: [], loading: false, error: reason instanceof Error ? reason.message : String(reason) });
      });
    return () => { active = false; };
  }, [backendId, enabled, sessionId, refreshKey, key]);

  const current = catalog.key === key ? catalog : { models: [], loading: enabled, error: null };
  const readableError = current.error && backendId === 'codex' && /\bENOENT\b|Codex CLI executable .* was not found/i.test(current.error)
    ? t('agent.codexExecutableMissing')
    : current.error && backendId === 'codex' && /WSL is unavailable/i.test(current.error)
      ? t('agent.codexWslMissing')
    : current.error?.replace(/^Error:\s*/, '').replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^Error:\s*/, '') ?? null;
  return { models: enabled ? current.models : [], loading: enabled && current.loading, error: enabled ? readableError : null };
}
