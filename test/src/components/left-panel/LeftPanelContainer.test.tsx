import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '@/stores';

vi.mock('@/components/left-panel/AssetWorkspaceTab', () => ({ AssetWorkspaceTab: () => <div>Assets content</div> }));
vi.mock('@/components/left-panel/TaskTreeTab', () => ({ TaskTreeTab: () => <div>Tasks content</div> }));
vi.mock('@/components/left-panel/RecordsTab', () => ({ RecordsTab: () => <div>Records content</div> }));
vi.mock('@/components/left-panel/SessionFilesTab', () => ({ SessionFilesTab: () => <div>Files content</div> }));
vi.mock('@/components/left-panel/ShellsTab', () => ({ ShellsTab: () => <div>Shells content</div> }));
vi.mock('@/components/left-panel/TrafficSidebar', () => ({ TrafficSidebar: () => <div>Traffic content</div> }));

import { LeftPanelContainer, LeftPanelNavigation } from '@/components/left-panel/LeftPanelContainer';

function Sidebar() {
  return <><LeftPanelNavigation /><LeftPanelContainer /></>;
}

describe('LeftPanelContainer activity bar', () => {
  beforeEach(() => {
    useAppStore.setState({ leftPanelView: 'targets', isLeftPanelOpen: true });
  });

  it('keeps feature controls in an icon-only vertical navigation rail', () => {
    render(<Sidebar />);

    const navigation = screen.getByRole('navigation', { name: 'Primary sidebar' });
    expect(navigation).toHaveClass('flex-col');
    const buttons = within(navigation).getAllByRole('button');
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Assets', 'Tasks', 'Records', 'Files', 'Traffic', 'Shells',
    ]);
    expect(within(screen.getByRole('button', { name: 'Assets' })).queryByText('Assets')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Assets' })).toHaveAttribute('aria-current', 'page');
  });

  it('reveals labels on hover or keyboard focus without resizing the rail', () => {
    render(<Sidebar />);

    const label = screen.getByText('Assets');
    expect(label).toHaveAttribute('aria-hidden', 'true');
    expect(label).toHaveClass(
      'opacity-0',
      'group-hover:opacity-100',
      'peer-focus-visible:opacity-100',
      'absolute',
    );
  });

  it('switches the visible feature and selected state from the rail', () => {
    render(<Sidebar />);

    fireEvent.click(screen.getByRole('button', { name: 'Shells' }));
    expect(screen.getByText('Shells content')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Shells' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Assets' })).not.toHaveAttribute('aria-current');
  });

  it('opens captured traffic in the left panel', () => {
    render(<Sidebar />);

    fireEvent.click(screen.getByRole('button', { name: 'Traffic' }));
    expect(screen.getByText('Traffic content')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Traffic' })).toHaveAttribute('aria-current', 'page');
  });

  it('toggles the active sidebar while retaining its mounted content', () => {
    render(<Sidebar />);
    const button = screen.getByRole('button', { name: 'Assets' });
    const content = screen.getByRole('region', { name: 'Assets' });
    expect(button).toHaveAttribute('aria-controls', content.id);
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(content).toHaveAttribute('aria-hidden', 'true');
    expect(content).toHaveAttribute('inert');
    expect(screen.getByText('Assets content')).toBeInTheDocument();
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(content).toHaveAttribute('aria-hidden', 'false');
    expect(content).not.toHaveAttribute('inert');
  });

  it('opens another sidebar after the active one was collapsed', () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByRole('button', { name: 'Assets' }));
    fireEvent.click(screen.getByRole('button', { name: 'Files' }));
    expect(screen.getByRole('button', { name: 'Files' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('region', { name: 'Files' })).not.toHaveAttribute('inert');
    expect(screen.getByText('Files content')).toBeInTheDocument();
  });

  it('reopens the sidebar for programmatic navigation', () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByRole('button', { name: 'Assets' }));
    act(() => useAppStore.getState().setLeftPanelView('traffic'));
    expect(screen.getByRole('button', { name: 'Traffic' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('region', { name: 'Traffic' })).not.toHaveAttribute('inert');
  });
});
