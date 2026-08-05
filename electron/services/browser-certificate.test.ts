// @vitest-environment node
import { execFileSync } from 'child_process';
import { X509Certificate } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  isCertificateTrustedByAuthority,
  loadPinnedCertificateAuthority,
} from './browser-certificate';

const opensslAvailable = (() => {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe.runIf(opensslAvailable)('project browser certificate trust', () => {
  let fixtureDirectory = '';
  let caPem = '';
  let leafPem = '';
  let unrelatedPem = '';

  beforeAll(() => {
    fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'hexestra-browser-cert-'));
    const caKeyPath = path.join(fixtureDirectory, 'ca.key');
    const caPath = path.join(fixtureDirectory, 'ca.pem');
    const leafKeyPath = path.join(fixtureDirectory, 'leaf.key');
    const leafCsrPath = path.join(fixtureDirectory, 'leaf.csr');
    const leafPath = path.join(fixtureDirectory, 'leaf.pem');
    const unrelatedKeyPath = path.join(fixtureDirectory, 'unrelated.key');
    const unrelatedPath = path.join(fixtureDirectory, 'unrelated.pem');
    const caConfigPath = path.join(fixtureDirectory, 'ca.cnf');
    const leafConfigPath = path.join(fixtureDirectory, 'leaf.cnf');
    const unrelatedConfigPath = path.join(fixtureDirectory, 'unrelated.cnf');
    fs.writeFileSync(caConfigPath, certificateConfig('Hexestra Test CA', true));
    fs.writeFileSync(leafConfigPath, certificateConfig('example.test', false, 'DNS:example.test'));
    fs.writeFileSync(unrelatedConfigPath, certificateConfig('example.test', false, 'DNS:example.test'));
    const runOpenSsl = (args: string[], configPath: string) => execFileSync('openssl', args, {
      cwd: fixtureDirectory,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, OPENSSL_CONF: configPath },
    });

    runOpenSsl([
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', caKeyPath, '-out', caPath,
      '-config', caConfigPath, '-days', '2',
    ], caConfigPath);
    runOpenSsl([
      'req', '-newkey', 'rsa:2048', '-nodes', '-keyout', leafKeyPath, '-out', leafCsrPath,
      '-config', leafConfigPath,
    ], leafConfigPath);
    runOpenSsl([
      'x509', '-req', '-in', leafCsrPath, '-CA', caPath, '-CAkey', caKeyPath,
      '-CAcreateserial', '-out', leafPath, '-days', '1',
      '-extfile', leafConfigPath, '-extensions', 'v3_cert',
    ], leafConfigPath);
    runOpenSsl([
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', unrelatedKeyPath, '-out', unrelatedPath,
      '-config', unrelatedConfigPath, '-days', '1',
    ], unrelatedConfigPath);

    caPem = fs.readFileSync(caPath, 'utf8');
    leafPem = fs.readFileSync(leafPath, 'utf8');
    unrelatedPem = fs.readFileSync(unrelatedPath, 'utf8');
  });

  afterAll(() => {
    if (fixtureDirectory.startsWith(os.tmpdir())) {
      fs.rmSync(fixtureDirectory, { recursive: true, force: true });
    }
  });

  it('trusts a valid hostname certificate signed directly by the pinned project CA', () => {
    const ca = new X509Certificate(caPem);
    const leaf = new X509Certificate(leafPem);
    const authority = loadPinnedCertificateAuthority(caPem, ca.fingerprint256);

    expect(isCertificateTrustedByAuthority({
      data: leafPem,
      fingerprint: leaf.fingerprint256,
    }, 'example.test', authority)).toBe(true);
    expect(isCertificateTrustedByAuthority({
      data: leafPem,
      fingerprint: leaf.fingerprint256,
    }, 'other.test', authority)).toBe(false);
  });

  it('rejects an unrelated certificate and a mismatched CA fingerprint', () => {
    const ca = new X509Certificate(caPem);
    const unrelated = new X509Certificate(unrelatedPem);
    const authority = loadPinnedCertificateAuthority(caPem, ca.fingerprint256);

    expect(isCertificateTrustedByAuthority({
      data: unrelatedPem,
      fingerprint: unrelated.fingerprint256,
    }, 'example.test', authority)).toBe(false);
    expect(() => loadPinnedCertificateAuthority(caPem, unrelated.fingerprint256)).toThrow(/fingerprint/);
  });
});

function certificateConfig(commonName: string, certificateAuthority: boolean, subjectAltName?: string) {
  return [
    '[req]',
    'prompt=no',
    'distinguished_name=subject',
    'x509_extensions=v3_cert',
    'req_extensions=v3_cert',
    '[subject]',
    `CN=${commonName}`,
    '[v3_cert]',
    `basicConstraints=critical,CA:${certificateAuthority ? 'TRUE' : 'FALSE'}`,
    certificateAuthority
      ? 'keyUsage=critical,keyCertSign,cRLSign'
      : 'keyUsage=critical,digitalSignature,keyEncipherment',
    ...(subjectAltName ? [`subjectAltName=${subjectAltName}`] : []),
    '',
  ].join('\n');
}
