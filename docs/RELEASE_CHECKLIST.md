# Hexestra release checklist

Use this checklist for v0.1.0 and adapt it for later releases. Do not publish directly
from an unreviewed development directory.

## 1. Repository identity

- [ ] Create the public GitHub repository under the final owner.
- [ ] Add the canonical repository, homepage, bug tracker, and author metadata to
      `package.json`.
- [ ] Replace or add canonical release links in `CHANGELOG.md`.
- [ ] Confirm the repository description and topics match the README positioning.
- [ ] Confirm the name, domain, and social handles; complete a trademark review if the
      project will be operated as a long-term brand.

## 2. Public source boundary

- [ ] Start from the explicit source set in `docs/PUBLICATION_BOUNDARY.md`.
- [ ] Run `npm run audit:public`.
- [ ] Run `npm run release:source` and use the generated
      `artifacts/open-source/Hexestra-<version>-source/` directory as the public
      repository root.
- [ ] Inspect every file added since the previous release.
- [ ] Confirm local AI/Trellis state, build output, user projects, captures, credentials,
      certificates, and copied runtimes are absent.
- [ ] Confirm no mitmproxy executable/runtime directory or
      `resources/burp-bridge/hexestra-burp-bridge.jar` is in source history.
- [ ] Run a repository secret scanner after the first Git history exists.

## 3. Legal and third-party review

- [ ] Confirm `LICENSE` and `package.json` both declare Apache-2.0.
- [ ] Review the production Node/Electron dependency tree and preserve all required
      licenses and notices in the binary distribution.
- [ ] Verify the README's pinned mitmproxy version and that no mitmproxy runtime is bundled.
- [ ] Confirm the Montoya API remains compile-only and is absent from the bridge JAR.
- [ ] Review the upstream license files against the exact installer contents.

## 4. Product assets

- [ ] Replace Electron's default icon with the final Hexestra application/installer icon.
- [ ] Add a clear hero screenshot to both READMEs.
- [ ] Record a short demo showing human/AI handoff on the same browser, terminal,
      traffic, and task state.
- [ ] Redact all targets, credentials, traffic, reports, usernames, and local paths.

## 5. Source verification

- [ ] Run `npm ci` on clean Windows, Linux, Intel macOS, and Apple Silicon macOS environments using Node.js 24.
- [ ] Run `npm run audit:public`.
- [ ] Run `npm run check`.
- [ ] Run relevant browser, Traffic, terminal, WSL, and desktop smoke checks.
- [ ] Build and smoke-test the Burp Bridge with `npm run build:burp-bridge`.

## 6. Source-only verification

- [ ] Run the desktop startup smoke on all four supported source-run platforms.
- [ ] Install mitmproxy 12.2.3 separately on a validation machine and verify automatic
      discovery, manual executable selection, Capture, and the missing/incompatible error.
- [ ] Build and smoke-test the Burp Bridge with `npm run build:burp-bridge` on a JDK 17 host.

## 7. Release publication

- [ ] Change `CHANGELOG.md` v0.1.0 from `Unreleased` to the actual date.
- [ ] Finalize `docs/releases/v0.1.0.md` and verify every claim.
- [ ] Tag the reviewed commit as `v0.1.0`.
- [ ] Create a GitHub pre-release from that tag.
- [ ] Publish the reviewed source archive and test its extraction from a signed-out browser.

## 8. After publication

- [ ] Monitor installation failures, security reports, and documentation gaps.
- [ ] Publish known issues without exposing engagement data.
- [ ] Triage feedback into Now, Next, Later, or out of scope.
- [ ] Record release metrics without adding invasive application telemetry.
