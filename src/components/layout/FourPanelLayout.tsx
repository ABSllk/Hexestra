import { useEffect, useRef, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle } from 'react-resizable-panels';
import { useAppStore } from '@/stores';
import { cn } from '@/lib/cn';

interface FourPanelLayoutProps {
  leftNavigation: React.ReactNode;
  leftPanel: React.ReactNode;
  centerPanel: React.ReactNode;
  rightPanel: React.ReactNode;
  bottomPanel: React.ReactNode;
}

export function FourPanelLayout({
  leftNavigation,
  leftPanel,
  centerPanel,
  rightPanel,
  bottomPanel,
}: FourPanelLayoutProps) {
  const isNetMapVisible = useAppStore((s) => s.isNetMapVisible);
  const isLeftPanelOpen = useAppStore((s) => s.isLeftPanelOpen);
  const setLeftPanelOpen = useAppStore((s) => s.setLeftPanelOpen);
  const leftPanelRef = useRef<ImperativePanelHandle>(null);
  const [sidebarAnimating, setSidebarAnimating] = useState(false);

  useEffect(() => {
    const panel = leftPanelRef.current;
    if (!panel || panel.isCollapsed() === !isLeftPanelOpen) return;
    setSidebarAnimating(true);
    if (isLeftPanelOpen) panel.expand();
    else panel.collapse();
    const timeout = window.setTimeout(() => setSidebarAnimating(false), 220);
    return () => window.clearTimeout(timeout);
  }, [isLeftPanelOpen]);

  return (
    <PanelGroup direction="vertical" autoSaveId="hexestra-main-layout">
      {/* Top area: three columns */}
      <Panel defaultSize={72} minSize={40}>
        <div className="isolate flex h-full min-h-0">
          {leftNavigation}
        <PanelGroup direction="horizontal" autoSaveId="hexestra-top-columns" className={cn('min-w-0 flex-1', sidebarAnimating && 'sidebar-layout-animating')}>
          {/* Left panel */}
          <Panel ref={leftPanelRef} defaultSize={15} minSize={12} maxSize={35} collapsible collapsedSize={0} onCollapse={() => setLeftPanelOpen(false)} onExpand={() => setLeftPanelOpen(true)}>
            <div className="h-full min-w-0 overflow-hidden bg-canvas py-1.5 pr-0.5">
              {leftPanel}
            </div>
          </Panel>

          <PanelResizeHandle
            disabled={!isLeftPanelOpen}
            hitAreaMargins={{ coarse: 12, fine: 6 }}
            onDragging={(dragging) => { if (dragging) setSidebarAnimating(false); }}
            className={cn(
              'my-1.5 w-px transition-colors',
              'bg-transparent hover:bg-accent-blue/45 focus-visible:bg-accent-blue',
              'data-[resize-handle-active]:bg-accent-blue',
              !isLeftPanelOpen && 'invisible',
            )}
          />

          {/* Center panel */}
          <Panel defaultSize={60} minSize={30}>
            <div className="h-full min-w-0 overflow-hidden bg-panel">
              {centerPanel}
            </div>
          </Panel>

          <PanelResizeHandle
            hitAreaMargins={{ coarse: 12, fine: 6 }}
            onDragging={(dragging) => { if (dragging) setSidebarAnimating(false); }}
            className={cn(
              'my-1.5 mr-0.5 w-px transition-colors',
              'bg-transparent hover:bg-accent-blue/45 focus-visible:bg-accent-blue',
              'data-[resize-handle-active]:bg-accent-blue'
            )}
          />

          {/* Right panel */}
          <Panel defaultSize={25} minSize={15} maxSize={40} collapsible>
            <div className="h-full min-w-0 overflow-hidden bg-canvas py-1.5">
              <div className="right-sidebar-content h-full min-w-0 overflow-hidden rounded-xl bg-panel">
                {rightPanel}
              </div>
            </div>
          </Panel>
        </PanelGroup>
        </div>
      </Panel>

      {/* Bottom panel divider — only shown when NetMap is visible */}
      {isNetMapVisible && (
        <>
          <PanelResizeHandle
            hitAreaMargins={{ fine: 6, coarse: 12 }}
            className={cn(
              'h-px transition-colors',
              'bg-transparent hover:bg-accent-blue/50 focus-visible:bg-accent-blue/50',
              'data-[resize-handle-active]:bg-accent-blue'
            )}
          />
          {/* Bottom panel: NetMap — spans full width */}
          <Panel defaultSize={28} minSize={10} maxSize={50} collapsible>
            <div className="h-full overflow-hidden bg-canvas">
              {bottomPanel}
            </div>
          </Panel>
        </>
      )}
    </PanelGroup>
  );
}
