import { useCallback, useEffect, useMemo, useState } from 'react';
import { DismissibleNotice, Icon } from '@/components/shared';
import { useChatStore } from '@/stores';
import {
  SHELL_IPC,
  type ReverseListenerProfile,
  type ShellConnectCommandResult,
  type ShellConnectObfuscation,
  type ShellConnectTemplateId,
  type ShellConnectTemplateSummary,
} from '@electron/contracts/shell';

const OBFUSCATION_OPTIONS: { value: ShellConnectObfuscation; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'base64', label: 'Base64' },
];

export function ShellConnectBuilder({ projectId, listener, onClose }: {
  projectId: string;
  listener: ReverseListenerProfile;
  onClose: () => void;
}) {
  const queueAgentContext = useChatStore((state) => state.queueAgentContext);
  const [templates, setTemplates] = useState<ShellConnectTemplateSummary[]>([]);
  const [templateId, setTemplateId] = useState<ShellConnectTemplateId | ''>('');
  const [obfuscation, setObfuscation] = useState<ShellConnectObfuscation>('none');
  const [callbackAddress, setCallbackAddress] = useState(listener.bindAddress);
  const [detecting, setDetecting] = useState(false);
  const [result, setResult] = useState<ShellConnectCommandResult | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === templateId),
    [templateId, templates],
  );

  // Reset callback address when listener changes
  useEffect(() => {
    setCallbackAddress(listener.bindAddress);
  }, [listener.bindAddress, listener.id]);

  useEffect(() => {
    let current = true;
    setTemplates([]);
    setTemplateId('');
    setResult(null);
    setError('');
    void window.hexestra?.invoke<ShellConnectTemplateSummary[]>(SHELL_IPC.CONNECT_TEMPLATE_LIST)
      .then((nextTemplates) => {
        if (!current) return;
        setTemplates(nextTemplates);
        setTemplateId(nextTemplates[0]?.id ?? '');
      })
      .catch((nextError) => {
        if (current) setError(errorMessage(nextError));
      });
    return () => { current = false; };
  }, [listener.id]);

  useEffect(() => {
    if (!templateId || !window.hexestra) {
      setResult(null);
      return;
    }
    let current = true;
    setResult(null);
    setError('');
    void window.hexestra.invoke<ShellConnectCommandResult>(SHELL_IPC.CONNECT_COMMAND_BUILD, {
      projectId,
      listenerId: listener.id,
      templateId,
      callbackAddress,
      callbackPort: listener.port,
      obfuscation,
    }).then((nextResult) => {
      if (current) setResult(nextResult);
    }).catch((nextError) => {
      if (current) setError(errorMessage(nextError));
    });
    return () => { current = false; };
  }, [callbackAddress, listener.id, listener.port, projectId, templateId, obfuscation]);

  const detectPublicIp = useCallback(async () => {
    if (!window.hexestra) return;
    setDetecting(true);
    setError('');
    try {
      const ip = await window.hexestra.invoke<string | null>(SHELL_IPC.PUBLIC_IP_DETECT);
      if (ip) {
        setCallbackAddress(ip);
        setNotice('Public IP detected.');
      } else {
        setError('Could not detect public IP. Enter it manually.');
      }
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setDetecting(false);
    }
  }, []);

  const copyCommand = async () => {
    if (!result || !window.hexestra) return;
    setError('');
    try {
      await window.hexestra.invoke('clipboard:write-text', result.command);
      setNotice('Copied.');
    } catch (nextError) {
      setError(errorMessage(nextError));
    }
  };

  const askAgent = () => {
    if (!result) return;
    queueAgentContext({
      kind: 'shell-command',
      projectId,
      listenerId: result.listenerId,
      templateId: result.template.id,
      templateLabel: result.template.label,
      callbackAddress: result.callbackAddress,
      callbackPort: result.callbackPort,
      command: result.command,
      localOnly: result.localOnly,
      obfuscation: result.obfuscation,
    }, 'Explain this connection command, its runtime requirements, and confirm it is only for use on authorized targets.');
    setNotice('Added to the Agent draft. It was not sent.');
  };

  return (
    <section aria-label="Payload Generator" className="space-y-2 rounded border border-accent-purple/35 bg-canvas p-2">
      <div className="flex items-center justify-between text-text-secondary">
        <span className="flex items-center gap-1.5"><Icon name="sparkles" size={11} className="text-accent-purple" /> Payload Generator</span>
        <button className="ui-icon-button" aria-label="Close Payload Generator" onClick={onClose}><Icon name="close" size={11} /></button>
      </div>

      <div className="font-mono text-[11px] text-text-muted">
        <span className="truncate">{listener.name}</span>
        <span className="text-text-secondary"> · listener {listener.bindAddress}:{listener.port}</span>
      </div>

      <label className="block text-[11px] text-text-muted">
        Callback address
        <div className="mt-1 flex gap-1">
          <input
            type="text"
            aria-label="Callback address"
            className="ui-control h-7 flex-1 px-2 font-mono text-[11px]"
            value={callbackAddress}
            onChange={(event) => { setCallbackAddress(event.target.value); setNotice(''); setError(''); }}
            placeholder="e.g. 203.0.113.5"
            spellCheck={false}
          />
          <button
            type="button"
            className="ui-control h-7 shrink-0 px-2 text-[11px]"
            disabled={detecting || !window.hexestra}
            onClick={() => void detectPublicIp()}
          >{detecting ? '…' : 'Detect'}</button>
        </div>
      </label>

      <label className="block text-[11px] text-text-muted">
        Runtime template
        <select
          aria-label="Runtime template"
          className="ui-control mt-1 h-7 w-full px-2 text-[11px]"
          value={templateId}
          onChange={(event) => setTemplateId(event.target.value as ShellConnectTemplateId)}
        >
          {templates.map((template) => <option key={template.id} value={template.id}>{template.label} · {template.target}</option>)}
        </select>
      </label>

      <label className="block text-[11px] text-text-muted">
        Obfuscation
        <select
          aria-label="Obfuscation"
          className="ui-control mt-1 h-7 w-full px-2 text-[11px]"
          value={obfuscation}
          onChange={(event) => setObfuscation(event.target.value as ShellConnectObfuscation)}
        >
          {OBFUSCATION_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
        </select>
      </label>

      {selectedTemplate && (
        <div className="space-y-1 rounded bg-panel p-1.5 text-[11px] leading-4 text-text-muted">
          <div><span className="text-text-secondary">Requires:</span> {selectedTemplate.runtime}</div>
          <div><span className="text-text-secondary">Shell:</span> {selectedTemplate.shell} · PTY {selectedTemplate.pty}</div>
          <div>{selectedTemplate.note}</div>
        </div>
      )}

      <textarea
        aria-label="Generated connection command"
        className="ui-control min-h-24 w-full resize-y p-2 font-mono text-[11px] leading-4"
        readOnly
        spellCheck={false}
        value={result?.command ?? ''}
        placeholder={templateId ? 'Building command…' : 'Loading templates…'}
      />

      <div className="grid grid-cols-2 gap-1">
        <button className="ui-control h-7" disabled={!result} onClick={() => void copyCommand()}><Icon name="copy" size={10} className="mr-1 inline" />Copy</button>
        <button className="ui-control h-7" disabled={!result} onClick={askAgent}><Icon name="bot" size={10} className="mr-1 inline" />Ask Agent</button>
      </div>

      {error && <DismissibleNotice tone="error" className="p-2 text-[11px]" onDismiss={() => setError('')}>{error}</DismissibleNotice>}
      {notice && <DismissibleNotice tone="success" className="p-2 text-[11px]" onDismiss={() => setNotice('')}>{notice}</DismissibleNotice>}
    </section>
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
