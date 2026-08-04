import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DismissibleNotice } from './DismissibleNotice';

describe('DismissibleNotice', () => {
  it.each(['error', 'warning', 'success', 'info'] as const)('renders and dismisses the %s tone', (tone) => {
    const onDismiss = vi.fn();
    render(<DismissibleNotice tone={tone} onDismiss={onDismiss}>Notice content</DismissibleNotice>);

    expect(screen.getByText('Notice content')).toBeInTheDocument();
    const close = screen.getByRole('button', { name: 'Dismiss notice' });
    close.focus();
    expect(close).toHaveFocus();
    fireEvent.click(close);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('supports a square workbench banner layout', () => {
    render(<DismissibleNotice variant="banner" onDismiss={() => undefined}>Banner</DismissibleNotice>);
    expect(screen.getByRole('status')).toHaveClass('border-b');
    expect(screen.getByRole('status')).not.toHaveClass('rounded');
  });
});
