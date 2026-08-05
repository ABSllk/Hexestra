export const TERMINAL_CONTEXT_LIMIT = 12_000;

export function stripTerminalControlSequences(value: string) {
  return value
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, '')
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\r(?!\n)/g, '\n')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

export function appendTerminalContext(current: string, chunk: string, limit = TERMINAL_CONTEXT_LIMIT) {
  const combined = current + stripTerminalControlSequences(chunk);
  return combined.length > limit ? combined.slice(-limit) : combined;
}

export function terminalScrollLabel(viewportY: number, baseY: number) {
  if (baseY <= 0 || viewportY >= baseY) return 'LIVE';
  const percent = Math.round((viewportY / baseY) * 100);
  return `${percent}%`;
}
