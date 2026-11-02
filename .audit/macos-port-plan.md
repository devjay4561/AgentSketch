# macOS port plan

## Required workflow

- [x] Read the Principles section of the poteto-mode skill.
- [x] Phase A: Frame the definition of done, scope, effort, blockers, and rigor.
- [x] Phase B: Design verifiable units, order the riskiest unknown first, and record the workflow.
- [x] Phase C: State a hypothesis for each unit, make the smallest change, verify the real artifact, and keep or revert it.
- [x] Phase D: Keep the decision trail in `.audit/macos-port.tsv`.
- [x] Phase E: Verify the whole result against the definition of done and report what remains open.

## Architecture workflow

- [x] Ground: explain the current native, frontend, CLI, MCP, and release paths.
- [x] Sketch: compare at least two distinct platform designs against real Wails v2 practice.
- [x] Agree: choose a design from evidence without a human checkpoint.
- [x] Implement: follow the chosen sketch and revisit it if repeated workarounds appear.
- [x] Scrap: no repeated friction required a redesign.

## Designed delivery phases

1. [x] Capture baseline and finish platform inventory. Verify current tests before implementation.
2. [x] Add macOS-specific backend behavior and Apple Vision OCR. The bundled worker recognized Korean and English from a synthetic image; its synchronous Vision request runs in a killable worker to retain the 45-second deadline.
3. [x] Adapt frontend shortcuts and OS-specific browser or CLI/MCP launch behavior. Frontend tests/build and the bundled wrapper passed smoke checks.
4. [x] Add macOS build/package scripts, CI/release artifacts, icons and plist. The universal app, plist, signature, zip and DMG were checked locally.
5. [x] Update Korean/English docs, support notes, badges and changelog. Diff whitespace check passed.
6. [x] Run the requested suite, launch `.app`, inspect smoke behavior, then commit locally. No push or release.

## Definition of done

- `npm ci`, `npm test`, `npm run build`, `go test ./...`, and Wails builds complete on this Mac.
- The built `.app` exists, has a valid plist and universal executable, and launches for a smoke check.
- Windows-specific build/runtime behavior remains isolated behind Windows build tags and Windows workflows.
- A macOS build script and Windows/macOS CI and release matrix exist, with unsigned-build guidance.
- Korean and English docs describe supported platforms and macOS OCR behavior accurately.
- A local commit contains only this task's tracked changes. No push or release occurs.

## Rigor and scope

High rigor because the change crosses native build tags, app lifecycle, file access, shortcuts, CLI/MCP, packaging, release automation, and user docs. Rough scope is 8 to 12 code/build areas plus 4 documentation surfaces, with each phase checked before the next. Existing `.simpleclaw/` work is outside scope and must remain untouched.

## Arena workflow

- [x] Frame: compare two architectures against Windows preservation, macOS native behavior, small platform boundaries, Wails v2 release practice, and CLI/MCP consistency.
- [x] Fan out: not used; the session's workflow forbids unrequested agents, so both candidate sketches were compared directly.
- [x] Cross-judge: no independent reviewer was requested; compare candidates against the rubric directly.
- [x] Pick: choose build-tagged platform edges to match the observed code and Wails v2.
- [x] Graft: retain direct app launch, case-sensitive macOS paths, OCR capability UI, and packaged-resource checks from the other sketch.
- [x] Verify: check the synthesized sketch against existing call sites and Wails v2 guidance before implementation.

## Resolved setup issues

- The machine initially lacked Go on its default `PATH` and had Node 22. Checksum-verified Go 1.26.0 and Node 24.22.2 are installed under ignored `.tools/` and were explicitly added to `PATH` for the final build.
- Baseline `go test ./...` failed because the shared entry point imported WebView2's Windows-only loader. Build-tagged startup now compiles and tests on macOS.
- The Vision prototype and bundled worker both recognized synthetic English and Korean text; a disabled fallback remains available for builds without cgo.
- Both arm64 and universal builds are supported; the final bundle contains both `x86_64` and `arm64` slices.

## Remaining external checks

- Windows runtime/WebView2 execution, Intel hardware execution, Finder Launch Services behavior, downloaded-file Gatekeeper behavior, and remote GitHub Actions are listed in `docs/macos-verification.md`.
- The local task commit is still pending. No remote change or release has been made.

Architecture candidates and the decision are in `.audit/macos-architecture.md`.
