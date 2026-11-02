# macOS port architecture decision

## Candidates

1. **Build-tagged native edges:** keep `App`, document state, recovery and the command protocol shared; isolate Wails options, source opening, OCR and CLI paths at their existing OS boundaries.
2. **Concrete Host object:** route startup, profile discovery, file opening, browser choice and OCR through new Go and Node host facades.

Both designs preserve the same document model. Wails v2 supports a native `Mac.OnFileOpen` callback and OS-specific `darwin/arm64` and `darwin/universal` builds. Its own cross-platform guide uses one native runner per OS.

## Choice

Use the build-tagged native edges as the base. The project already has explicit Windows source adapters and Windows-only OCR; adding one Host object would move callers and lifecycle wiring without removing a repeated state transition. Keep the package root/profile/browser choices in focused Node helpers where `ai/runtime.mjs` already owns them. Use the useful Host-candidate findings: direct app executable launch for MCP, canonical case-sensitive path handling, capability-based OCR UI, and verify package resources after moving the app.

For Finder opens, change the single queued path into a bounded FIFO and serialize frontend handling. This preserves the existing dirty-document confirmation while preventing rapid opens from silently replacing one another. Start OCR experiments first: this Mac reports `ko-KR`, and the local Vision prototype recognized `AgentSketch OCR 123` and `안녕하세요`; therefore use a separate, killable worker to retain the 45-second limit.

The user requested no independent review, so no cross-judge or reviewer was started. Candidates were compared directly on small diff size, Windows preservation, existing call-site contracts, and evidence from Wails v2 source.
