# Hexestra mitmproxy addon

Hexestra launches an operator-installed mitmproxy 12.2.3 executable and loads
`hexestra_addon.py` as a project-local sidecar addon. The executable and its
runtime are never bundled or installed by Hexestra.

mitmproxy is MIT licensed. Users who distribute a mitmproxy installation must
preserve its upstream license and notices according to the mitmproxy project
terms. Runtime discovery and configuration are documented in the top-level
README under Traffic Runtime.
