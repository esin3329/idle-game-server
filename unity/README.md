# Core Forge Unity client

Portrait Android client for the existing idle-game-server. The server is not modified.

## Environment

- Editor: Unity 6000.6.4f1 (the version currently installed on this machine).
- Project: `IdleGameClient`.
- MCP for Unity Editor package: pinned to v10.3.0. The local Python server currently uses v10.2.0; editor registration and command execution were verified with this combination.
- API address is editable on the login screen. It is not a credential.
- Default API origin: `http://100.73.115.1:3007`, accessed through Tailscale. Do not append `/api`: client routes include their required prefixes.
- HTTP is enabled for the Editor and development builds. Enable Development Build for Android testing, and connect the device to the same Tailscale network. Release builds require an HTTPS API address.
- Tokens remain in memory; closing the application requires signing in again.

## Open and run

Open `IdleGameClient` in Unity. After compilation, select **Idle Game > Create Bootstrap Scene**, then Play. The scene is saved as `Assets/Scenes/Bootstrap.unity` and registered for builds. Do not recreate it over an unsaved scene.

## MCP

The local Python environment is ignored at `.tools/unity-mcp` in the repository root. Install it with Python 3.10+:

```powershell
python -m venv .tools/unity-mcp
.tools/unity-mcp/Scripts/python.exe -m pip install mcpforunityserver==10.2.0
.tools/unity-mcp/Scripts/mcp-for-unity.exe --transport http --http-host 127.0.0.1 --http-port 8080
```

Codex uses `http://127.0.0.1:8080/mcp`. Restart the Codex MCP connection to load newly registered tools. The Unity Editor connects through **Idle Game > Connect Unity MCP**. The bundled `unity-mcp` CLI can also verify and control the same connection:

```powershell
$env:PYTHONIOENCODING = 'utf-8'
.tools/unity-mcp/Scripts/unity-mcp.exe status
```

## Current implementation

Login, registration, server connectivity check, electricity collection, production upgrade, stage listing, battle session start/status/abandon, and portrait safe-area UI are implemented. Actual combat and battle reward collection are not yet implemented. No demo balance or fake rewards are shown. A missing game API is reported instead of falling back to a mock server.

On 2026-10-04, the user-provided port 3007 responded through Tailscale: `/health`, `/stages`, and `/api/stages` returned HTTP 200 with game JSON. `/stages` returned four stages. The earlier HTTPS `/api` address returned 404.

Verified in Unity on 2026-10-04: MCP editor connection and commands, saved `Assets/Scenes/Bootstrap.unity`, Play Mode entry, Korean login UI rendering, successful server connectivity through the actual UI button handler, and empty-login validation. After user login, UI handlers verified collection (7,842 to 8,196 E), one production upgrade (100 E consumed, production 2 to 3 E/s), stage listing, first-stage session creation/status, abandonment, and return to base. Console checks returned no errors or warnings. Screenshots: `IdleGameClient/Captures/login-overlay.png`, `base-verified.png`, and `battle-session.png`.

Deployed-server contract differences: `/wallet` returned a stale zero balance while `/api/players/:id` reflected collection and upgrades, so the client reads the player endpoint for base balances. Stage availability uses `canEnter` when provided, otherwise the deployed server's `unlocked` field; explicit `canEnter: false` remains authoritative. The server's wallet inconsistency is not repaired by this client change. Registration, full combat/rewards, Android builds, and device execution remain unverified.
