import net from 'net';
import { X509Certificate } from 'crypto';

export interface BrowserCertificateLike {
  data: string;
  fingerprint: string;
  issuerCert?: BrowserCertificateLike;
}

export interface PinnedCertificateAuthority {
  certificate: X509Certificate;
  fingerprint: string;
}

export function loadPinnedCertificateAuthority(
  certificateData: string | Buffer,
  expectedFingerprint: string,
): PinnedCertificateAuthority {
  const certificate = new X509Certificate(certificateData);
  const fingerprint = normalizeSha256Fingerprint(certificate.fingerprint256);
  if (fingerprint !== normalizeSha256Fingerprint(expectedFingerprint)) {
    throw new Error('Traffic CA certificate fingerprint does not match the proxy runtime');
  }
  if (!certificate.ca) throw new Error('Traffic CA certificate is not a certificate authority');
  if (!isCurrentlyValid(certificate)) throw new Error('Traffic CA certificate is not currently valid');
  return { certificate, fingerprint };
}

export function isCertificateTrustedByAuthority(
  certificate: BrowserCertificateLike,
  hostname: string,
  authority: PinnedCertificateAuthority,
) {
  try {
    const leaf = new X509Certificate(certificate.data);
    if (!isCurrentlyValid(leaf) || !certificateMatchesHostname(leaf, hostname)) return false;

    if (normalizeSha256Fingerprint(leaf.fingerprint256) === authority.fingerprint) return true;
    if (leaf.verify(authority.certificate.publicKey)) return true;

    let current = certificate;
    let currentCertificate = leaf;
    const visited = new Set<string>();
    while (current.issuerCert) {
      const issuer = current.issuerCert;
      const issuerCertificate = new X509Certificate(issuer.data);
      const issuerFingerprint = normalizeSha256Fingerprint(issuerCertificate.fingerprint256);
      if (visited.has(issuerFingerprint)) break;
      visited.add(issuerFingerprint);
      if (!isCurrentlyValid(issuerCertificate) || !currentCertificate.verify(issuerCertificate.publicKey)) return false;
      if (issuerFingerprint === authority.fingerprint) return true;
      current = issuer;
      currentCertificate = issuerCertificate;
    }
    return currentCertificate.verify(authority.certificate.publicKey);
  } catch {
    return false;
  }
}

export function normalizeSha256Fingerprint(value: string) {
  const normalized = value.replace(/:/g, '').toUpperCase();
  if (!/^[A-F0-9]{64}$/.test(normalized)) throw new Error('Invalid traffic CA fingerprint');
  return normalized;
}

function certificateMatchesHostname(certificate: X509Certificate, hostname: string) {
  const normalized = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
  return net.isIP(normalized)
    ? certificate.checkIP(normalized) !== undefined
    : certificate.checkHost(normalized) !== undefined;
}

function isCurrentlyValid(certificate: X509Certificate) {
  const now = Date.now();
  return Date.parse(certificate.validFrom) <= now && now <= Date.parse(certificate.validTo);
}
