const AUTHENTICATION_ERROR_PATTERN = /auth|login|credential|api[ -]?key|oauth/i;
const INVALID_EXECUTABLE_PATTERN = /\b(?:EFTYPE|ENOEXEC)\b|not a valid (?:Win32 )?application|exec format error/i;

export function isAgentAuthenticationError(message: string) {
  return AUTHENTICATION_ERROR_PATTERN.test(message);
}

export function formatAgentFailure(message: string) {
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
