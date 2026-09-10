import { useCallback, useState } from 'react';

export function usePresentationMode() {
  const [enabled, setEnabled] = useState(false);
  const toggle = useCallback(() => setEnabled((current) => !current), []);

  return { enabled, toggle };
}
