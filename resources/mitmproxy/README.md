# Hexestra mitmproxy addon

Packaged Hexestra builds include an official platform-specific mitmdump runtime
and load `hexestra_addon.py` as a project-local sidecar addon. The runtime
is staged outside `app.asar`, verified against the SHA-256 digest published in
mitmproxy's Sigstore release provenance, and used without a system-wide install.

Source runs may use an operator-installed executable. A path selected in
Settings overrides the bundled runtime; environment and PATH discovery remain
available as development and recovery fallbacks.

mitmproxy is MIT licensed. Users who distribute a mitmproxy installation must
preserve its upstream license and notices according to the mitmproxy project
terms. Hexestra does not install the generated mitmproxy CA into the operating-system
trust store. Runtime discovery and configuration are documented in the top-level
README under Traffic Runtime.
