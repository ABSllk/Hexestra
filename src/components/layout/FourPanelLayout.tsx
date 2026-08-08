import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { useAppStore } from '@/stores';
import { cn } from '@/lib/cn';

interface FourPanelLayoutProps {
  leftPanel: React.ReactNode;
  centerPanel: React.ReactNode;
  rightPanel: React.ReactNode;
  bottomPanel: React.ReactNode;
}

export function FourPanelLayout({
  leftPanel,
  centerPanel,
  rightPanel,
  bottomPanel,
}: FourPanelLayoutProps) {
  const isNetMapVisible = useAppStore((s) => s.isNetMapVisible);

  return (
    <PanelGroup direction="vertical" autoSaveId="hexestra-main-layout">
      {/* Top area: three columns */}
      <Panel defaultSize={72} minSize={40}>
        <PanelGroup direction="horizontal" autoSaveId="hexestra-top-columns">
          {/* Left panel */}
          <Panel defaultSize={18} minSize={12} maxSize={35} collapsible>
            <div className="h-full min-w-0 overflow-hidden border-r border-border-subtle bg-panel">
              {leftPanel}
            </div>
          </Panel>

          <PanelResizeHandle
            className={cn(
              'w-1 transition-colors',
              'bg-transparent hover:bg-accent-blue/45',
              'data-[resize-handle-active]:bg-accent-blue'
            )}
          />

          {/* Center panel */}
          <Panel defaultSize={57} minSize={30}>
            <div className="h-full min-w-0 overflow-hidden bg-panel">
              {centerPanel}
            </div>
          </Panel>

          <PanelResizeHandle
            className={cn(
              'w-1 transition-colors',
              'bg-transparent hover:bg-accent-blue/45',
              'data-[resize-handle-active]:bg-accent-blue'
            )}
          />

          {/* Right panel */}
          <Panel defaultSize={25} minSize={15} maxSize={40} collapsible>
            <div className="h-full min-w-0 overflow-hidden border-l border-border-subtle bg-panel">
              {rightPanel}
            </div>
          </Panel>
        </PanelGroup>
      </Panel>

      {/* Bottom panel divider — only shown when NetMap is visible */}
      {isNetMapVisible && (
        <>
          <PanelResizeHandle
            className={cn(
              'h-1 transition-colors',
              'bg-border-subtle/45 hover:bg-accent-blue/50',
              'data-[resize-handle-active]:bg-accent-blue'
            )}
          />
          {/* Bottom panel: NetMap — spans full width */}
          <Panel defaultSize={28} minSize={10} maxSize={50} collapsible>
            <div className="h-full overflow-hidden border-t border-border-subtle bg-canvas">
              {bottomPanel}
            </div>
          </Panel>
        </>
      )}
    </PanelGroup>
  );
}
