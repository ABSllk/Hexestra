# Contributing to Hexestra

Thank you for helping build a better shared operating surface for human and AI
security testers.

Hexestra is security-sensitive software. Contributions should preserve operator
control, explicit scope, auditable state changes, and compatibility with the tools
practitioners already use.

## Before you start

- Search the existing project context before opening a new change request.
- Discuss large UI, architecture, data-model, protocol, or safety-boundary changes
  before implementation.
- Never attach real client targets, credentials, cookies, captured traffic, private
  reports, or exploit evidence from non-public systems.

## Development environment

The verified development target is Windows 10 or Windows 11.

Required:

- Node.js 24
- npm

Required only for the Burp Bridge:

- JDK 17 or newer, including `javac`, `jar`, `java`, and `jdeps`

Optional runtime integrations:

- Claude Code, authenticated through its normal setup
- WSL for Linux-hosted tools
- Burp Suite
- mitmproxy 12.2.3 for Traffic capture packaging

Install and run:

```bash
npm ci
npm run electron:dev
```

Run the source quality gate:

```bash
npm run audit:public
npm run check
```

Build the Burp Bridge:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-burp-bridge.ps1
```

The bridge build downloads the pinned Montoya API as a compile-time dependency,
verifies its SHA-256 checksum, runs a loopback smoke test, and does not bundle the API
JAR.

## Pull requests

Keep pull requests focused and explain:

- the operator problem being solved;
- the safety and Scope implications;
- the human/AI handoff behavior;
- tests added or updated;
- visual evidence for UI changes;
- any migration or compatibility impact.

Before requesting review:

1. Rebase or merge the current default branch as appropriate.
2. Run `npm run audit:public`.
3. Run `npm run check`.
4. Run the relevant desktop or integration smoke checks.
5. Confirm documentation and both READMEs remain accurate.

Generated output, copied runtimes, local project state, captured traffic, and
credentials must not be committed. See `.gitignore`; `npm run audit:public`
enforces the reviewed public source boundary.

## Compatibility identifiers

The `.pengent` directory name and `pengent:last-project` local-storage key are retained
only to migrate data created by older development builds. Do not reuse them for new
features or current branding.

## Contribution terms

Hexestra is licensed under Apache-2.0. Unless you explicitly state otherwise, a
contribution intentionally submitted for inclusion in the project is provided under
the same license, as described in section 5 of the license. No additional contributor
license agreement is currently required.
