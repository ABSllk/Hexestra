import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '@/stores';

vi.mock('./AssetWorkspaceTab', () => ({ AssetWorkspaceTab: () => <div>Assets content</div> }));
vi.mock('./TaskTreeTab', () => ({ TaskTreeTab: () => <div>Tasks content</div> }));
vi.mock('./RecordsTab', () => ({ RecordsTab: () => <div>Records content</div> }));
vi.mock('./SessionFilesTab', () => ({ SessionFilesTab: () => <div>Files content</div> }));
vi.mock('./ShellsTab', () => ({ ShellsTab: () => <div>Shells content</div> }));
vi.mock('./TrafficSidebar', () => ({ TrafficSidebar: () => <div>Traffic content</div> }));

import { LeftPanelContainer } from './LeftPanelContainer';

describe('LeftPanelContainer activity bar', () => {
  beforeEach(() => {
    useAppStore.setState({ leftPanelView: 'targets' });
  });

  it('keeps feature controls in an icon-only vertical navigation rail', () => {
    render(<LeftPanelContainer />);

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
    render(<LeftPanelContainer />);

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
    render(<LeftPanelContainer />);

    fireEvent.click(screen.getByRole('button', { name: 'Shells' }));
    expect(screen.getByText('Shells content')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Shells' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Assets' })).not.toHaveAttribute('aria-current');
  });

  it('opens captured traffic in the left panel', () => {
    render(<LeftPanelContainer />);

    fireEvent.click(screen.getByRole('button', { name: 'Traffic' }));
    expect(screen.getByText('Traffic content')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Traffic' })).toHaveAttribute('aria-current', 'page');
  });
});
