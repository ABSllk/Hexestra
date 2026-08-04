# Publication boundary

Hexestra uses a source-first public repository. A working development directory is
not automatically a safe release archive.

## Public source

The intended source set contains:

- root project configuration and community documents;
- `.github/` repository configuration;
- `src/` and `electron/` application source and tests;
- `burp-extension/` source and tests;
- `scripts/` build, audit, and smoke scripts;
- `resources/skills/`;
- the mitmproxy integration addon and runtime guidance;
- Burp Bridge instructions and notices;
- `docs/`.

The executable allow-list is maintained by
`scripts/audit-public-boundary.mjs`. Run it before every push and release.

Run `npm run release:source` to audit that allow-list and export it to:

- `artifacts/open-source/Hexestra-<version>-source/`;
- `artifacts/open-source/Hexestra-<version>-source.zip`.

Initialize or upload the public repository from the exported directory, never from
the working development directory. The ZIP is a transfer and archival copy; GitHub
automatically creates source archives for tagged releases.

## Local-only or reconstructed material

The following must not enter source history:

- dependency trees and package-manager caches;
- frontend, Electron, coverage, installer, and smoke-test output;
- local AI, Trellis, editor, and automation state;
- Hexestra/Pengent project data;
- credentials, environment files, certificates, and private keys;
- HAR, PCAP, Burp project files, captured traffic, and project databases;
- mitmproxy executables or runtime directories;
- the compiled Hexestra Burp Bridge JAR.

The user-installed mitmproxy runtime and Burp Bridge JAR are never part of the source
archive. This release is source-first; no platform installer is produced by the public
source workflow.

## Required audit behavior

`npm run audit:public`:

1. rejects unknown top-level files or directories;
2. walks only the explicit public roots;
3. rejects symlinks, unexpected large files, binaries, capture formats, credential
   files, high-confidence secret formats, developer home paths, and unapproved old
   branding;
4. checks that required ignore rules remain present;
5. prints the reviewed file count and byte total.

`npm run release:source` consumes the same audited file list, verifies the copied
directory again, and creates the ZIP only after both audits pass.

This is a guardrail, not a substitute for reviewing the exact source set before
publication.
