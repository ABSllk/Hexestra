import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ClaudeModeSelector } from '@/components/right-panel/ClaudeModeSelector';

describe('ClaudeModeSelector', () => {
  it('shows only ASK, AUTO, and BYPASS', () => {
    const onChange = vi.fn();
    render(<ClaudeModeSelector value="default" onChange={onChange} isProcessing={false} />);

    expect(screen.getByRole('button', { name: 'ASK' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'AUTO' }));
    expect(onChange).toHaveBeenCalledWith('auto');
    expect(screen.queryByText('PLAN')).not.toBeInTheDocument();
    expect(screen.queryByText('SAFE')).not.toBeInTheDocument();
    expect(screen.queryByText('DELEGATE')).not.toBeInTheDocument();
  });

  it('requires explicit confirmation before enabling bypass', () => {
    const onChange = vi.fn();
    render(<ClaudeModeSelector value="default" onChange={onChange} isProcessing={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'BYPASS' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('without permission prompts');

    fireEvent.click(screen.getByRole('button', { name: 'Enable bypass' }));
    expect(onChange).toHaveBeenCalledWith('bypassPermissions');
  });

  it('explains that a change during execution applies to the next request', () => {
    render(<ClaudeModeSelector value="auto" onChange={() => {}} isProcessing />);
    expect(screen.getByText('Changes apply to the next request')).toBeInTheDocument();
    expect(screen.getByText('Classifier reviews actions in the background')).toBeInTheDocument();
  });

  it('uses the same full-width option rows as the other composer menus', () => {
    render(<ClaudeModeSelector value="auto" onChange={() => {}} isProcessing={false} />);
    const selected = screen.getByRole('button', { name: 'AUTO' });
    expect(selected).toHaveClass('w-full', 'rounded-md', 'bg-accent-blue/10');
    expect(selected).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'ASK' })).toHaveClass('w-full');
    expect(screen.getByRole('button', { name: 'BYPASS' })).toHaveClass('w-full');
  });
});
