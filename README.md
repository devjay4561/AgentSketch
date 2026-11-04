<div align="center">

<img src="public/favicon.svg" width="88" height="88" alt="AgentSketch logo" />

# AgentSketch <sup>Beta</sup>

**Map sources, prerequisites and processes on one canvas — an offline flowchart editor for Windows and macOS**

[![CI](https://github.com/devjay4561/AgentSketch/actions/workflows/ci.yml/badge.svg)](https://github.com/devjay4561/AgentSketch/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/devjay4561/AgentSketch?display_name=tag&sort=date&include_prereleases)](https://github.com/devjay4561/AgentSketch/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-f76b15.svg)](LICENSE)
![Windows](https://img.shields.io/badge/Windows-10%2B-0078D4?logo=windows)
![macOS](https://img.shields.io/badge/macOS-12%2B-555555?logo=apple)
![Go](https://img.shields.io/badge/Go-1.26-00ADD8?logo=go&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)
![Wails](https://img.shields.io/badge/Wails-v2.17-DF0000)

[Website](https://devjay4561.github.io/AgentSketch/) ·
[Download](https://github.com/devjay4561/AgentSketch/releases/latest) ·
[User guide (KO)](docs/사용안내.md) ·
[Agent control (KO)](docs/AI-사용안내.md) ·
[Contributing](CONTRIBUTING.md) ·
[한국어](README.ko.md)

<img src="docs/images/screenshot.png" alt="AgentSketch editor showing the sample launch-readiness board" width="100%" />

<img src="docs/images/demo.gif" alt="Real session: an AI agent in the terminal drives the AgentSketch app over MCP to draw a legislative-process map" width="100%" />
<sub>Unscripted real session: gjc + DeepSeek V4.1 Flash draws in the running app over MCP (thinking 13×, drawing 2×)</sub>

</div>

> [!NOTE]
> **macOS is available in [v0.1.2](https://github.com/devjay4561/AgentSketch/releases/tag/v0.1.2).** Download the universal app for Apple Silicon and Intel Macs, or the Windows x64 ZIP. Choose your platform on the [download website](https://devjay4561.github.io/AgentSketch/#download).
>
> The app supports English and Korean. Detailed guides are primarily in Korean; the [macOS agent install guide](docs/agent-install-macos.md) is in English.

## Why AgentSketch

Place shapes, text, notes and images on a large sheet and connect them to explain **where each piece of information comes from and what it is a prerequisite for**. It is designed around pasting screenshots and annotating them.

- 🪶 **Lightweight** — one Windows WebView2 executable or a native WKWebView app on macOS. No Node server or bundled Chromium, and nothing is redrawn while you are not editing.
- 🔒 **Local-first** — editing, saving and exporting all happen on your computer. OCR uses Windows OCR or Apple Vision locally; AI requests and LAN collaboration use the network only when you turn them on.
- 🧭 **Relationship-centric** — orthogonal connectors that route around obstacles, waypoints, conditional prerequisites, source/version/verification records and change-impact tracing.
- 🤖 **Agent-friendly** — 104 commands exposed through a CLI and an MCP (stdio) server, so agents such as Claude or Codex can create and edit documents.
- 📤 **Export anywhere** — PNG, SVG, PDF (vector text), editable PPTX, HTML, CSV and draw.io.

## Features

| Area | Supported |
| --- | --- |
| Canvas | Pointer-anchored zoom, Space+drag panning, fit to view, minimap, grid and object snapping |
| Elements | Rectangle, rounded rectangle, ellipse, diamond, text, note, image (crop/rotate), table, checklist, frame, freehand drawing |
| Connectors | Orthogonal, straight and curved; obstacle avoidance; up to 32 waypoints; labels; color, dash and width; one- or two-way arrows |
| Organizing | Align and distribute, nested groups, pages and layers, auto layout (left→right, top→down, tree, radial, by owner) with preview before applying |
| Source tracking | Source, version, owner, due date and file fingerprint; custom fields; conditional prerequisites; readiness, missing-item and change-impact analysis |
| Documents | Multiple document tabs, document cards linking other `.agentsketch` files, attachments, snapshots and stored versions, comments, bookmarks, presentation mode |
| Storage | `.agentsketch` (JSON with embedded images), autosave recovery of the latest board, undo/redo |
| Import / export | PNG, SVG, PDF, PPTX, HTML, CSV, draw.io / import from CSV and draw.io |

Full operations and shortcuts are in the [user guide](docs/사용안내.md); scope and limitations in [upgrade scope](docs/업그레이드범위.md) (both Korean).

## Install

### Executable (recommended)

Download `AgentSketch-Windows.zip` from [Releases](https://github.com/devjay4561/AgentSketch/releases/latest), extract it and run `AgentSketch.exe`.

- Windows 10/11 x64 with the [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) (preinstalled on Windows 11).
- Builds are not code-signed, so SmartScreen may warn on first launch. Verify downloads with the published `SHA256SUMS.txt`.

### macOS

Download `AgentSketch-macOS-universal.zip` from [Releases](https://github.com/devjay4561/AgentSketch/releases/latest), move `AgentSketch.app` to Applications, then launch it. Universal builds support Apple Silicon and Intel Macs; if a universal build is unavailable, use the arm64 archive on Apple Silicon.

- Requires macOS 12 or newer. OCR runs locally with Apple Vision and uses the recognition languages supported by macOS.
- The app has no Developer ID signature and is not notarized. If Gatekeeper blocks the first launch, verify the download and choose **System Settings → Privacy & Security → Open Anyway**. See [Apple's instructions](https://support.apple.com/en-sg/102445).

### 🤖 Let your AI agent install it

Paste this into Claude Code, Codex, GJC or another agent. It reads the [agent install guide](docs/agent-install.md) and downloads, verifies, registers the MCP server, installs the skill and checks the connection. It asks you for the install and working folders first.

```text
Install AgentSketch and connect it to yourself over MCP.
Follow https://raw.githubusercontent.com/devjay4561/AgentSketch/main/docs/agent-install.md step by step.
```

Requires Node.js 24 or newer. Once connected, ask something like "draw a flowchart of … in the AgentSketch app".

### First steps

1. Choose **File → New board** (파일 → 새 보드).
2. Pick rectangle, text or note in the left toolbar and click or drag on the canvas.
3. Paste a screenshot with **Ctrl+V on Windows** or **⌘V on Mac**, or drop an image file onto the canvas.
4. With the **connector** tool, click the source element and then the target.
5. Save a `.agentsketch` file with **Ctrl+S on Windows** or **⌘S on Mac**, and use **Export** (내보내기) for shareable files.

> [!IMPORTANT]
> **Autosave is not the same as saving a file.** Windows stores recovery under `%APPDATA%\AgentSketch`; macOS stores it under `~/Library/Application Support/AgentSketch`. To keep several boards or move them to another PC, save a document file.

## Controlling it with AI agents

The app's document engine is also available as a CLI and an MCP server. No AI API key is needed — your agent writes the commands.

```powershell
agentsketch.cmd capabilities --query node           # discover commands
agentsketch.cmd execute --request request.json --root C:\work
agentsketch.cmd connect                              # attach to the running app (shows an "external control" banner)
```

On macOS, use the wrapper included in the app bundle:

```sh
"/Applications/AgentSketch.app/Contents/Resources/agentsketch" capabilities --query node
"/Applications/AgentSketch.app/Contents/Resources/agentsketch" connect
```

```jsonc
// MCP host configuration (per-agent commands: docs/agent-install.md)
{ "mcpServers": { "agentsketch": { "command": "node", "args": ["<release folder>/AI/ai/cli.mjs", "mcp", "--root", "C:\\work"] } } }
```

- Changes are applied atomically per batch; `dryRun` returns the plan only. In the app, one Ctrl+Z undoes a whole batch.
- The live connection uses a random `127.0.0.1` port with a session token and rejects website origins.
- The CLI/MCP requires Node.js 24+; previews and exports render with Microsoft Edge on Windows or installed Chrome/Edge on macOS.

The full command map is in [AI-사용안내.md](docs/AI-사용안내.md) (Korean).

## Build from source

**Requirements:** Go 1.26+, Node.js 24 LTS, npm. Windows builds need Windows 10/11; macOS builds need macOS 12+ and Xcode Command Line Tools. The first build downloads dependencies and the Wails CLI (v2.17.0).

```powershell
git clone https://github.com/devjay4561/AgentSketch.git
cd AgentSketch
./scripts/build.ps1          # npm ci → frontend build → tests → build/bin/AgentSketch.exe
./scripts/package.ps1        # release/AgentSketch-Windows.zip, release/AgentSketch-source.zip
```

On macOS, build either Apple Silicon or universal binaries and package the app:

```sh
./scripts/build.sh --arch arm64
./scripts/build.sh --arch universal
./scripts/package-macos.sh           # app ZIP and DMG
```

The Wails CLI is installed only into the project's `.tools/bin`. For the per-user NSIS installer see [scripts/INSTALLER.md](scripts/INSTALLER.md).

### Development

```powershell
npm ci
npm run dev -- --port 18440  # browser dev mode (save = download, recovery = browser storage)
```

| Check | Command |
| --- | --- |
| Type check + frontend build | `npm run build` |
| Document, layout, routing and export unit tests | `npm test` |
| Go tests | `go test ./...` |
| WebView2 browser-argument patch | `go test github.com/wailsapp/go-webview2/pkg/edge -run AgentSketch` |
| UI regressions (dev server on 18440) | `node scripts/e2e-check.mjs`, `node scripts/editor-regressions.mjs` |
| Orthogonal routing and group UI | `node --experimental-strip-types scripts/routing-group-check.mjs` |

UI checks use the installed Microsoft Edge with Playwright.

## Architecture

```text
┌──────────────── AgentSketch (Go + Wails v2; WebView2 / WKWebView) ────────────────┐
│  main.go / app.go       window, single instance, recovery save before exit        │
│  store.go / export.go   file dialogs, save, recovery, export writes              │
│  ocr_windows.go / ocr_darwin.go  Windows OCR / Apple Vision (on request)          │
│  collaboration.go / ai.go   LAN sharing, external AI requests (opt-in only)       │
│ ┌───────────────── WebView2 (embedded dist/) ──────────────────┐                 │
│ │ src/main.ts         editing, selection, shortcuts, panels     │                 │
│ │ src/model.ts        validation, history  src/types.ts  format │                 │
│ │ src/routing.ts      orthogonal routing   src/layout-engine.ts │                 │
│ │ src/renderer.ts     Canvas 2D, PNG, SVG  src/export-*.ts      │                 │
│ └────────────────────────────────────────────────────────────────┘                │
└─────────────────────────────────────────────────────────────────────────────────┘
        ▲ 127.0.0.1 + session token (when connected)
ai/cli.mjs ── CLI · MCP stdio ── same document engine (src/commands.ts), also for offline files
```

| Path | Role |
| --- | --- |
| `src/` | TypeScript editor, document engine, renderer, exporters |
| `*.go` | Shared desktop app plus tagged Windows/macOS native adapters |
| `ai/` | CLI and MCP server |
| `skills/agentsketch/` | Skill for AI agents |
| `scripts/` | Build, packaging, installer and UI checks |
| `third_party/go-webview2/` | Pinned patch that passes browser arguments ([details](third_party/go-webview2/AGENTSKETCH-PATCH.md)) |

### Design principles

- **No continuous render loop** — redraw only on change; skip off-screen elements.
- **Memory budget** — image strings are shared across undo history and the decode cache is bounded. Up to 64 images nearest the center are drawn on screen; saving and exporting always include every image.
- **GPU off by default** — on the measured Canvas 2D workload this improved both memory and zoom responsiveness. Set `AGENTSKETCH_ENABLE_GPU=1` to turn it on.
- **Heavy features on demand** — PDF/PPTX modules, OCR and sharing load only when used.
- **Document contract** — the `.agentsketch` format is defined by [`src/types.ts`](src/types.ts) and `validateDocument`.

Measurement conditions and numbers are in [검증결과.md](docs/검증결과.md); design rationale in [DESIGN.md](DESIGN.md) (both Korean).

## Privacy and security

- Documents and recovery files stay on your PC. AgentSketch sends no telemetry and makes no automatic update requests.
- External AI is called only after you configure the endpoint, model and key and review what will be sent.
- Please report vulnerabilities privately as described in the [security policy](SECURITY.md), not in public issues.

## Contributing

Bug reports, feature ideas and pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md) first. Issues and PRs may be written in English or Korean.

## License

[MIT](LICENSE) © AgentSketch contributors

Bundled third-party components:

- [Pretendard](https://github.com/orioncactus/pretendard) v1.3.9 — SIL Open Font License 1.1 ([public/fonts/OFL.txt](public/fonts/OFL.txt)). The static PDF fonts derived from it are renamed *AgentSketch Export Sans* to respect the Reserved Font Name.
- [Wails](https://github.com/wailsapp/wails), [go-webview2](https://github.com/wailsapp/go-webview2) — MIT
- npm dependencies such as [pdf-lib](https://github.com/Hopding/pdf-lib), [PptxGenJS](https://github.com/gitbrent/PptxGenJS) and [Playwright](https://github.com/microsoft/playwright) — under their respective licenses
- Installer built with [NSIS](https://nsis.sourceforge.io/) — zlib/libpng and others ([scripts/NSIS-LICENSE.txt](scripts/NSIS-LICENSE.txt))

Release archives include `THIRD-PARTY-NOTICES.txt` with every dependency notice.
