import { useEffect, useState } from 'react';
import type { ToolDefinition } from '@electron/services/tool-catalog.service';

export function ToolCatalogSettings() {
  const [tools, setTools] = useState<ToolDefinition[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => void window.hexestra.invoke<ToolDefinition[]>('tools:catalog:list')
    .then(setTools)
    .catch((reason) => setError(String(reason)));

  useEffect(() => { refresh(); }, []);

  const probe = async () => {
    setBusy(true);
    setError(null);
    try {
      setTools(await window.hexestra.invoke<ToolDefinition[]>('tools:catalog:probe'));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-canvas">
      <div className="mx-auto max-w-5xl px-6 py-5">
        <header className="mb-5 flex items-start justify-between gap-4 border-b border-border-subtle pb-4">
          <div>
            <h1 className="text-lg font-semibold text-text-primary">Tool Catalog</h1>
            <p className="mt-1 text-xs leading-5 text-text-muted">Capabilities and ATT&amp;CK mappings are resolved here; execution still uses the configured Agent and Hexestra channels.</p>
          </div>
          <button onClick={() => void probe()} disabled={busy} className="min-h-9 rounded border border-accent-blue/30 bg-accent-blue/10 px-3 text-xs font-medium text-accent-blue transition-colors hover:bg-accent-blue/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50">
            {busy ? 'Probing…' : 'Probe local tools'}
          </button>
        </header>
        {error && <p className="mb-3 text-xs text-severity-critical">{error}</p>}
        <div className="space-y-2">
          {tools.map((tool) => (
            <div key={tool.id} className="rounded border border-border-subtle bg-panel/50 p-3">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-text-primary">{tool.name}</span>
                <span className="rounded border border-border-subtle px-1.5 py-0.5 text-[10px] uppercase text-text-muted">{tool.channel}</span>
                <span className={`ml-auto text-[11px] ${tool.available ? 'text-accent-green' : 'text-text-muted'}`}>
                  {tool.available ? `available${tool.version ? ` · ${tool.version}` : ''}` : 'not available / not probed'}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-text-muted">{tool.description}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {tool.capabilities.map((capability) => <span key={capability} className="rounded bg-accent-teal/10 px-1.5 py-0.5 font-mono text-[10px] text-accent-teal">{capability}</span>)}
                {tool.techniqueIds.map((technique) => <span key={technique} className="rounded bg-accent-blue/10 px-1.5 py-0.5 font-mono text-[10px] text-accent-blue">{technique}</span>)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
