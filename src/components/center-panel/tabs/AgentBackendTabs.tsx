import { cn } from '@/lib/cn';

export type AgentBackend = 'claude' | 'codex';

export function AgentBackendTabs({ value, onChange, label }: {
  value: AgentBackend;
  onChange: (backend: AgentBackend) => void;
  label?: string;
}) {
  return <div className="flex gap-1 border-b border-border-subtle px-6 pt-3" role="group" aria-label={label}>
    {(['claude', 'codex'] as const).map((id) => <button key={id} type="button" aria-pressed={value === id}
      onClick={() => onChange(id)}
      className={cn('relative rounded-t-lg border border-b-0 px-4 py-2 text-xs', value === id
        ? 'z-10 border-border-subtle bg-canvas text-text-primary after:absolute after:-bottom-px after:left-0 after:right-0 after:h-px after:bg-canvas'
        : 'border-transparent text-text-muted hover:text-text-secondary')}>
      {id === 'claude' ? 'Claude Code' : 'Codex'}
    </button>)}
  </div>;
}
