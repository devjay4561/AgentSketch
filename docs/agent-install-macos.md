# AgentSketch — macOS install guide for AI agents

This guide installs the macOS app, which has no Developer ID signature or notarization, and registers its bundled CLI wrapper as an MCP server. Ask before choosing an install folder, working folder, or MCP host. Keep the MCP `--root` limited to the folder the user approved.

## Requirements

- macOS 12 or newer; Apple Silicon uses arm64 or universal builds.
- Node.js 24 or newer on `PATH` for the CLI/MCP wrapper.
- Google Chrome or Microsoft Edge on `PATH`/installed for image rendering and previews.

## Install

1. Download `AgentSketch-macOS-universal.zip` from the [latest release](https://github.com/devjay4561/AgentSketch/releases/latest). If no universal archive is available, use the arm64 archive on Apple Silicon.
2. Verify it against the matching entry in `SHA256SUMS.txt`.
3. Move `AgentSketch.app` to `/Applications` or another folder the user chose.
4. The app has only an ad-hoc signature, with no Developer ID signature or notarization. If Gatekeeper blocks it, first verify the archive, then follow [Apple's Open Anyway steps](https://support.apple.com/en-sg/102445).

The CLI wrapper is inside the app bundle:

```sh
cli="/Applications/AgentSketch.app/Contents/Resources/agentsketch"
"$cli" capabilities --query node
```

## Register MCP

Ask the user which hosts to configure. Use an approved working folder and substitute their actual home path. For a JSON-based host:

```json
{"mcpServers":{"agentsketch":{"command":"/Applications/AgentSketch.app/Contents/Resources/agentsketch","args":["mcp","--root","/Users/your-name/Documents/AgentSketch"]}}}
```

Reload the MCP host, call `agentsketch_capabilities` with `{"query":"node"}`, then call `agentsketch_connect`. Confirm the app shows the external-control indicator. Never claim that installation or registration succeeded before checking the host response.

The app stores recovery and MCP connection data under `~/Library/Application Support/AgentSketch`. The CLI requires Node.js 24. Preview rendering uses an installed Chrome or Edge; it does not download a browser.
