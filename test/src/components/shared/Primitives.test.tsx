import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button, EmptyState, FormField, IconButton, SegmentedControl, Tabs, TextInput } from '@/components/shared';

describe('shared workbench primitives', () => {
  it('renders typed button tones and forwards activation', () => {
    const onClick = vi.fn();
    render(<Button tone="primary" size="compact" leadingIcon="send" onClick={onClick}>Run</Button>);

    const button = screen.getByRole('button', { name: 'Run' });
    expect(button).toHaveClass('ui-button-primary', 'min-h-7');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('labels icon actions and keeps focusable controls reachable', () => {
    render(<IconButton name="settings" label="Open settings" />);
    const button = screen.getByRole('button', { name: 'Open settings' });
    button.focus();
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute('title', 'Open settings');
  });

  it('exposes tab and segmented state through ARIA', () => {
    const onChange = vi.fn();
    render(
      <>
        <Tabs items={[{ id: 'one', label: 'One' }, { id: 'two', label: 'Two' }]} value="one" onChange={onChange} />
        <SegmentedControl items={[{ id: 'dark', label: 'Dark' }, { id: 'light', label: 'Light' }]} value="dark" onChange={onChange} />
      </>,
    );

    expect(screen.getByRole('tab', { name: 'One' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('tab', { name: 'Two' }));
    expect(onChange).toHaveBeenCalledWith('two');
  });

  it('connects field labels, inline errors, and empty state actions', () => {
    render(
      <>
        <FormField label="Search" htmlFor="search" error="Required"><TextInput id="search" /></FormField>
        <EmptyState title="No assets" description="Add a target to begin." action={<Button>Open folder</Button>} />
      </>,
    );

    expect(screen.getByLabelText('Search')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Required');
    expect(screen.getByRole('button', { name: 'Open folder' })).toBeInTheDocument();
  });
});
