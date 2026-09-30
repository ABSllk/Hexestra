import { fireEvent, screen } from '@testing-library/react';
import { vi } from 'vitest';

/** jsdom has no layout; give the trigger a visible anchor, then use the public UI. */
export function openSelect(trigger: HTMLElement) {
  vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({ left: 20, top: 100, right: 220, bottom: 132, width: 200, height: 32, x: 20, y: 100, toJSON: () => ({}) });
  fireEvent.click(trigger);
}

export function selectOption(trigger: HTMLElement, label: string) {
  openSelect(trigger);
  fireEvent.click(screen.getByRole('option', { name: label }));
}
