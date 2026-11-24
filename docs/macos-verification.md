# macOS port verification

This report records the Mac checks for the Windows/macOS port. The original Windows measurements remain in [검증결과.md](검증결과.md); they describe a Windows machine and are not Mac evidence.

## Local environment

- macOS host, Go 1.26.0, Node.js 24.22.2, Wails CLI v2.17.0.
- Go and Node were installed under the ignored project `.tools/` directory after validating the official archive checksums.
- No Developer ID signing identity or notarization workflow was used. The package script applies an ad-hoc signature so the completed app bundle can be verified locally.

## Results

Commands below used the checksum-verified Go and Node installations under `.tools/` where the system `PATH` did not include them.

- `npm ci` completed with no reported vulnerabilities. The package lock did not change.
- `npm test` passed: 174 tests, 0 failures.
- `npm run build` passed after the macOS shortcut-label changes. Vite reported the existing large-chunk advisory.
- `go test ./...` and `go vet ./...` passed on macOS.
- `GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go test -c -o /tmp/AgentSketch-windows.test.exe .` compiled the Windows package. This is a cross-compile check, not a Windows runtime test.
- `./scripts/build.sh --skip-install --skip-tests --arch universal` completed with Wails CLI v2.17.0. `lipo -archs` reported `x86_64 arm64`; `plutil -lint` passed; the bundle declares macOS 12.0 as its minimum version.
- The built plist contains `.agentsketch` and legacy `.flowpaper` document types, and the bundle contains `iconfile.icns`.
- `./scripts/package-macos.sh` created `release/AgentSketch-macOS-universal.zip` and `.dmg`. `codesign --verify --deep --strict` passed for the ad-hoc signed bundle; `unzip -t` found no archive errors; `hdiutil imageinfo` identified a compressed UDZO disk image.
- The app opened from the built bundle. Its recovery hint and keyboard labels displayed `⌘`; the bundled `agentsketch connect` wrapper returned live app state. Pressing `⌘Q` closed the app and wrote `recovery.agentsketch` under the isolated test home.
- The bundled MCP wrapper completed `initialize` and `tools/list`, returning all four tools. The two GitHub workflow files parsed as YAML.
- The built app's Apple Vision worker recognized both `AgentSketch OCR 123` and `안녕하세요` from a synthetic local PNG.

The frontend emits a large-chunk advisory; cgo links emit duplicate `-lobjc` warnings; `hdiutil` reports its current `create` syntax as deprecated. These did not fail the checks.

## Not established on this Mac

- Windows runtime behavior and WebView2 integration require a Windows runner; local source changes keep those imports and OCR behind Windows build tags.
- Intel runtime behavior requires an Intel Mac. A universal `lipo` result proves both slices are present, not execution on Intel hardware.
- Gatekeeper behavior after downloading a release archive was not exercised. The bundle has only an ad-hoc signature, no Developer ID signature, and no notarization; see [Apple's first-launch guidance](https://support.apple.com/en-sg/102445).
- Finder association registration and opening a file through Launch Services were not exercised; the built plist includes `.agentsketch` and `.flowpaper` document types.
- GitHub Actions were added but not run from this local checkout.
