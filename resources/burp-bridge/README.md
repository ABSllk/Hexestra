# Hexestra Bridge for Burp Suite

Hexestra Bridge receives completed HTTP request/response records from Hexestra on a loopback-only authenticated endpoint. It imports them into Burp's Site map and, by default, Organizer. It does not replay the request and does not place synthetic records in Burp Proxy history.

The extension listener uses only Java base socket APIs so it works inside Burp's isolated extension class loader; it does not require the optional `jdk.httpserver` module or custom JVM flags.

User-facing installation and pairing steps are documented in the top-level
[`README.md`](../../README.md) and [`README.zh-CN.md`](../../README.zh-CN.md), under
**Configure the integrations**. This file records the Bridge's behavior and
security boundary for maintainers and distribution reviewers.

Mirror mode keeps the Hexestra browser connected only to the Hexestra proxy. If
Burp or the Bridge is unavailable, browsing and capture continue; affected flows
show **SYNC FAILED** and can be retried with **RECONNECT & SYNC**.

Mirrored exchanges appear in Burp **Target > Site map** and optionally **Organizer**. Burp's public extension API does not allow synthetic entries to be inserted into **Proxy > HTTP history**; that history contains only traffic that actually traverses a Burp Proxy listener.

## Security boundary

- The Bridge binds only to `127.0.0.1`.
- A busy configured port falls back to an operating-system-selected loopback port; the selected port is shown and persisted instead of making the extension fail to load.
- Every request requires the persisted pairing token.
- The maximum imported exchange is 64 MiB.
- Regenerating the token immediately invalidates the previous token.
- Mirrored records can contain cookies, credentials, and tokens and become part of the Burp project.
