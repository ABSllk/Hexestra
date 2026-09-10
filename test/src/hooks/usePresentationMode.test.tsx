import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { usePresentationMode } from '@/hooks/usePresentationMode';

describe('presentation mode state', () => {
  it('toggles transient renderer state', () => {
    const { result } = renderHook(() => usePresentationMode());
    expect(result.current.enabled).toBe(false);
    act(() => result.current.toggle());
    expect(result.current.enabled).toBe(true);
    act(() => result.current.toggle());
    expect(result.current.enabled).toBe(false);
  });
});
