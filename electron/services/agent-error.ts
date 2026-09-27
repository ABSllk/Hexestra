const AUTHENTICATION_ERROR_PATTERN = /auth|login|credential|api[ -]?key|oauth/i;
const INVALID_EXECUTABLE_PATTERN = /\b(?:EFTYPE|ENOEXEC)\b|not a valid (?:Win32 )?application|exec format error/i;

export function isAgentAuthenticationError(message: string) {
  return AUTHENTICATION_ERROR_PATTERN.test(message);
}

export function formatAgentFailure(message: string, backendId = 'claude') {
  if (backendId === 'codex') {
    const heading = `Codex error: ${message}`;
    if (/\bENOENT\b|Codex CLI executable .* was not found/i.test(message)) {
      return `${heading}\n\nCheck the Codex executable under Settings → Connection → Codex and run codex --version in the selected environment.`;
    }
    if (INVALID_EXECUTABLE_PATTERN.test(message)) return `${heading}\n\nInstall or select a working Codex executable in Agent settings.`;
    if (isAgentAuthenticationError(message)) return `${heading}\n\nSign in with the Codex CLI in the selected runtime.`;
    return heading;
  }
  const heading = `Claude Agent SDK error: ${message}`;
  if (INVALID_EXECUTABLE_PATTERN.test(message)) {
    return [
      heading,
      '',
      'Claude Code could not start because its executable is incomplete or invalid. Reinstall the project dependencies without interrupting npm install, then restart Hexestra.',
    ].join('\n');
  }
  if (isAgentAuthenticationError(message)) {
    return [
      heading,
      '',
      'Open Claude Code once and complete authentication, or configure ANTHROPIC_API_KEY.',
    ].join('\n');
  }
  return heading;
}
