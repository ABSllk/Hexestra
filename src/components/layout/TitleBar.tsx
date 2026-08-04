import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/shared';
import { useSessionStore } from '@/stores';
import { openSettingsTab } from '@/stores/useTabStore';
import { useI18n } from '@/i18n';
import type { PlatformCapabilities } from '@electron/contracts/platform';

export function TitleBar() {
  const { t } = useI18n();
  const project = useSessionStore((state) => state.currentSession);
  const openProjectFolder = useSessionStore((state) => state.openProjectFolder);
  const createProjectFolder = useSessionStore((state) => state.createProjectFolder);
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [capabilities, setCapabilities] = useState<PlatformCapabilities | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!window.hexestra) return;
    void window.hexestra.invoke<boolean>('app:window:is-maximized').then(setMaximized);
    void window.hexestra.invoke<PlatformCapabilities>('app:getCapabilities').then(setCapabilities).catch(() => undefined);
    return window.hexestra.on('app:window:maximized', (value) => setMaximized(Boolean(value)));
  }, []);

  useEffect(() => {
    if (!fileMenuOpen) return;
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setFileMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFileMenuOpen(false);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [fileMenuOpen]);

  const windowAction = async (channel: string) => {
    if (!window.hexestra) return;
    const result = await window.hexestra.invoke<boolean | void>(channel);
    if (typeof result === 'boolean') setMaximized(result);
  };

  return <header
    className={`relative z-[100] flex h-9 shrink-0 select-none items-center border-b border-surface bg-bg-tertiary/95 text-text-muted ${capabilities?.usesNativeTitleBar ? 'pl-20' : ''}`}
    style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    onDoubleClick={() => void windowAction('app:window:toggle-maximize')}
  >
    <div ref={menuRef} className="relative flex h-full items-center" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      <div className="flex h-full w-10 items-center justify-center text-accent-teal"><Icon name="shield" size={15} /></div>
      <button aria-expanded={fileMenuOpen} onClick={() => setFileMenuOpen((open) => !open)} className={`h-7 rounded-md px-2 text-[11px] ${fileMenuOpen ? 'bg-surface/70 text-text-primary' : 'hover:bg-surface/45 hover:text-text-secondary'}`}>{t('menu.file')}</button>
      <button onClick={() => openSettingsTab()} className="h-7 rounded-md px-2 text-[11px] hover:bg-surface/45 hover:text-text-secondary">{t('common.settings')}</button>
      {fileMenuOpen && <div role="menu" className="ui-popover absolute left-10 top-8 w-52 p-1.5">
        <MenuItem label={t('menu.openFolder')} shortcut="Ctrl+O" onClick={() => void runMenuAction(openProjectFolder, setFileMenuOpen)} />
        <MenuItem label={t('menu.newProjectFolder')} onClick={() => void runMenuAction(createProjectFolder, setFileMenuOpen)} />
        <div className="my-1 border-t border-surface" />
        <MenuItem label={t('menu.exit')} onClick={() => { setFileMenuOpen(false); void windowAction('app:window:close'); }} />
      </div>}
    </div>
    <div className="pointer-events-none absolute left-1/2 flex max-w-[42vw] -translate-x-1/2 items-center gap-2 truncate font-mono text-[10px] tracking-wide">
      <span className="text-text-secondary">HEXESTRA</span>
      {project && <><span className="text-surface-light">/</span><span className="truncate text-text-muted">{project.name}</span></>}
    </div>
    {!capabilities?.usesNativeTitleBar && <div className="ml-auto flex h-full items-stretch" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <WindowButton label={t('window.minimize')} icon="window-minimize" onClick={() => void windowAction('app:window:minimize')} />
        <WindowButton label={maximized ? t('window.restore') : t('window.maximize')} icon={maximized ? 'window-restore' : 'window-maximize'} onClick={() => void windowAction('app:window:toggle-maximize')} />
        <WindowButton label={t('common.close')} icon="close" destructive onClick={() => void windowAction('app:window:close')} />
      </div>}
  </header>;
}

function MenuItem({ label, shortcut, onClick }: { label: string; shortcut?: string; onClick: () => void }) {
  return <button role="menuitem" onClick={onClick} className="flex h-7 w-full items-center rounded-md px-2 text-left text-[11px] text-text-secondary hover:bg-surface/45 hover:text-text-primary"><span className="flex-1">{label}</span>{shortcut && <span className="font-mono text-[9px] text-text-muted">{shortcut}</span>}</button>;
}

function WindowButton({ label, icon, destructive = false, onClick }: { label: string; icon: 'window-minimize' | 'window-maximize' | 'window-restore' | 'close'; destructive?: boolean; onClick: () => void }) {
  return <button aria-label={label} title={label} onDoubleClick={(event) => event.stopPropagation()} onClick={onClick} className={`mx-0.5 my-1 flex w-10 items-center justify-center rounded-md ${destructive ? 'hover:bg-red-500/75 hover:text-white' : 'hover:bg-surface/55 hover:text-text-primary'}`}><Icon name={icon} size={13} /></button>;
}

async function runMenuAction(action: () => Promise<unknown>, setOpen: (open: boolean) => void) {
  setOpen(false);
  await action();
}
