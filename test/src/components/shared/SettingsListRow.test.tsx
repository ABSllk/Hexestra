import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SettingsListRow } from '@/components/shared/SettingsListRow';

describe('SettingsListRow', () => {
  it('exposes selection and status while keeping row actions independent', () => {
    const onSelect = vi.fn();
    const onDelete = vi.fn();
    render(
      <SettingsListRow
        selected
        onSelect={onSelect}
        ariaLabel="nmap"
        title="Nmap"
        meta="nmap"
        badge="Enabled"
        description="Port and service discovery"
        status="success"
        statusLabel="Enabled"
        actions={<button type="button" onClick={onDelete}>Delete</button>}
      />,
    );

    const rowButton = screen.getByRole('button', { name: 'nmap' });
    expect(rowButton).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Enabled', { selector: '.sr-only' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.click(rowButton);
    expect(onSelect).toHaveBeenCalledOnce();
  });
});
