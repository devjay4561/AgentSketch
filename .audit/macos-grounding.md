# macOS port grounding

## Current shape

`main.go` owns Wails startup and imports the WebView2 browser-argument hook for every OS. `App` in `app.go` owns recovery, file dialogs, launch paths, and the single-instance callback. `os.UserConfigDir()` already puts macOS app state under `~/Library/Application Support/AgentSketch`.

`source.go` validates paths and delegates OS opening. `source_windows.go` uses `ShellExecuteW`; `source_other.go` disables opening on macOS as well as other non-Windows targets. `ocr_windows.go` combines shared image checks with the Windows OCR process. The frontend binds OCR only when the native method exists.

The frontend already accepts Control and Meta key events. Shortcut labels still say Ctrl in static HTML, generated messages, and status text. AI live control has a separate profile path in `ai/runtime.mjs`, which does not match Go on macOS. It also assumes `AgentSketch.exe`, Microsoft Edge, and the WebView2 browser flag.

`scripts/build.ps1`, `scripts/package.mjs`, and `scripts/package.ps1` build Windows artifacts. CI and release workflows run on Windows only. The NSIS installer registers `.agentsketch`; the app has no macOS file association metadata or file-open callback.

## Design constraints

- Keep the shared document, recovery, and automation code in Go.
- Isolate Windows-only WebView2 code with build tags and keep the local third-party protection patch unchanged.
- Add Darwin path opening, Finder file-open delivery, and a macOS OCR implementation or explicit unavailable state.
- Make the Node profile path match Go's `os.UserConfigDir()` result on macOS.
- Keep one release publisher after Windows and macOS jobs upload artifacts.
- Use the Wails native `.app` bundle, plist, and platform-specific build runner.
- Preserve the existing untracked `.simpleclaw/` directory.

## Wails v2 practice checked

- The [Wails v2 cross-platform GitHub Actions guide](https://v2.wails.io/docs/guides/crossplatform-build/) uses separate Windows and macOS runners, `fail-fast: false`, a `darwin/universal` target, recursive checkout, and uploaded build artifacts.
- The [Wails v2 CLI reference](https://v2.wails.io/docs/reference/cli/) lists `darwin/arm64` and `darwin/universal`, and says a Mac production bundle uses `build/darwin/Info.plist`.
- The open-source [TCIA Data Retriever build guide](https://github.com/TCIA/data-retriever/blob/main/README.md) builds with `wails build --platform darwin/universal` and `windows/amd64` on their native hosts.
- Wails v2 `SingleInstanceLock` supports macOS, and `Mac.Options.OnFileOpen` receives opened document paths. Use those hooks instead of replacing the app's queued document flow.
- Apple says downloaded apps without notarization require approval in System Settings. The user-facing instructions must state that this build is unsigned and may be blocked by Gatekeeper.

## Baseline on this Mac

- Node 24.22.2 and Go 1.26.0 were installed under ignored `.tools/` after verifying the official archives' SHA-256 checksums.
- `npm ci` passed. `npm test` passed with 174 tests. `npm run build` passed.
- `go test ./...` failed before changes because the shared entry point imports `github.com/wailsapp/go-webview2/pkg/edge`, whose Darwin build excludes Windows loader files.
- No application code had changed when this baseline was captured.
