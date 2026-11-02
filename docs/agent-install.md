# AgentSketch — install guide for AI agents

You are an AI agent asked to install AgentSketch and connect yourself to it over MCP.
Follow these steps in order. Use PowerShell on Windows. Do not skip the verification step.

AgentSketch is an offline Windows flowchart editor. Its MCP server lets you create and edit
`.agentsketch` documents and control the running app. It needs no API key and makes no
network calls of its own.

## 0. Ask the user first

Confirm these with the user before changing anything. Suggest the defaults.

| Question | Default |
|---|---|
| Install folder | `%LOCALAPPDATA%\Programs\AgentSketch` |
| Working folder for documents (MCP `--root`; the server can only read and write inside it) | `%USERPROFILE%\Documents\AgentSketch` |
| Which agent hosts to register (Claude Code, Codex, GJC, other) | the host you are running in |

Do not pick a root folder wider than the user asks for (for example a whole drive or the user profile).

## 1. Check requirements

```powershell
[Environment]::OSVersion.Version   # Windows 10 or 11, x64
node --version                     # must be v24 or newer
```

If Node.js is missing or older than 24, stop and tell the user to install Node.js 24 LTS.
Microsoft Edge (or the WebView2 Runtime) must be present; it is built into Windows 11.

## 2. Download and verify

```powershell
$base = 'https://github.com/devjay4561/AgentSketch/releases/latest/download'
$tmp  = Join-Path $env:TEMP 'agentsketch-install'
New-Item -ItemType Directory -Force $tmp | Out-Null
Invoke-WebRequest "$base/AgentSketch-Windows.zip" -OutFile "$tmp\AgentSketch-Windows.zip"
Invoke-WebRequest "$base/SHA256SUMS.txt"          -OutFile "$tmp\SHA256SUMS.txt"
$expected = (Select-String -LiteralPath "$tmp\SHA256SUMS.txt" -Pattern 'AgentSketch-Windows.zip').Line.Split(' ')[0]
$actual   = (Get-FileHash -Algorithm SHA256 -LiteralPath "$tmp\AgentSketch-Windows.zip").Hash.ToLowerInvariant()
if ($expected -ne $actual) { throw 'Checksum mismatch: do not install.' }
```

## 3. Extract

The zip contains one top-level `AgentSketch` folder.

```powershell
$parent = Join-Path $env:LOCALAPPDATA 'Programs'          # parent of the confirmed install folder
Expand-Archive -LiteralPath "$tmp\AgentSketch-Windows.zip" -DestinationPath $parent -Force
$app  = Join-Path $parent 'AgentSketch'
$cli  = Join-Path $app 'AI\ai\cli.mjs'
$root = Join-Path $env:USERPROFILE 'Documents\AgentSketch' # the confirmed working folder
New-Item -ItemType Directory -Force $root | Out-Null
Test-Path $cli, (Join-Path $app 'AgentSketch.exe')         # both must be True
```

`AI\mcp-config.json` in the zip contains example paths from the build machine. Ignore it and use
`$cli` and `$root` from this step.

## 4. Register the MCP server

Use the server name `agentsketch`. Register only the hosts the user chose.

**Claude Code**

```powershell
claude mcp add agentsketch -s user -- node "$cli" mcp --root "$root"
```

**Codex CLI**

```powershell
codex mcp add agentsketch -- node "$cli" mcp --root "$root"
```

**GJC** (arguments that start with `--` need the `=` form; the timeout gives the server time to start)

```powershell
gjc mcp add agentsketch --command node --arg "$cli" --arg mcp --arg=--root --arg "$root" --timeout 120000
```

**Other MCP hosts** (Claude Desktop, Cursor, and similar): add this to the host's MCP JSON config,
with the real paths and backslashes escaped.

```json
{ "mcpServers": { "agentsketch": { "command": "node", "args": ["C:\\...\\AgentSketch\\AI\\ai\\cli.mjs", "mcp", "--root", "C:\\...\\Documents\\AgentSketch"] } } }
```

## 5. Install the skill (recommended)

The skill teaches agents the command contract and the expected workflow.
Copy it into the skill folder of each host you registered, then write `locations.json`.

| Host | Skill folder |
|---|---|
| Claude Code | `%USERPROFILE%\.claude\skills\agentsketch` |
| Codex | `%USERPROFILE%\.codex\skills\agentsketch` |
| GJC | `%USERPROFILE%\.gjc\agent\skills\agentsketch` |

```powershell
$skill = Join-Path $env:USERPROFILE '.claude\skills\agentsketch'   # repeat per host
Copy-Item -Recurse -Force (Join-Path $app 'AI\skills\agentsketch') $skill
@{ cli = $cli; executable = (Join-Path $app 'AgentSketch.exe'); root = $root } |
  ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $skill 'locations.json')
```

## 6. Verify

MCP servers load when a session starts, so start a new session (or reload MCP servers) first.

1. Call `agentsketch_capabilities` with `{"query": "node"}`. It must list commands such as `node.add`.
2. Call `agentsketch_connect`. The AgentSketch window opens and shows **외부 제어 중** (external control) in the toolbar.
3. Call `agentsketch_execute` with `{"request": {"target": {"live": true}, "command": "document.read"}}`. It must return a `revision`.

If step 1 fails, check the path in the registration and run `node "$cli" capabilities --query node` directly to see the error.

## 7. Report to the user

Tell the user:

- the install folder and the working folder (`--root`);
- which hosts were registered and where the skill was installed;
- that every AI edit can be undone with one Ctrl+Z in the app, and that the agent can only read and write files inside the working folder;
- how to uninstall: remove the `agentsketch` MCP registration and skill folder, then delete the install folder. Documents in the working folder are kept.
