import { describe, expect, it } from 'vitest';
import { formatAgentFailure, isAgentAuthenticationError } from '@electron/services/agent-error';

describe('agent error presentation', () => {
  it('identifies authentication failures without treating process failures as auth errors', () => {
    expect(isAgentAuthenticationError('OAuth token is invalid')).toBe(true);
    expect(isAgentAuthenticationError('spawn EFTYPE')).toBe(false);
  });

  it('gives incomplete Windows executables an installation recovery message', () => {
    const message = formatAgentFailure('spawn EFTYPE');

    expect(message).toContain('executable is incomplete or invalid');
    expect(message).toContain('without interrupting npm install');
    expect(message).not.toContain('ANTHROPIC_API_KEY');
  });

  it('only adds the login guidance to authentication failures', () => {
    expect(formatAgentFailure('OAuth login required')).toContain('ANTHROPIC_API_KEY');
    expect(formatAgentFailure('network timeout')).toBe('Claude Agent SDK error: network timeout');
  });
});
