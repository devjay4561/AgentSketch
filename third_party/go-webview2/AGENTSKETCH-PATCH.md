# AgentSketch local patch

Upstream: github.com/wailsapp/go-webview2 v1.0.22, unmodified license retained.

Wails v2.17.0 has no public additional-browser-arguments option. This loader clears
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS in preventEnvAndRegistryOverrides(), so
setting that environment variable alone does not apply the required protection
against the Windows blank-password probe.

Changes are limited to pkg/edge/chromium.go (one call) and the added
agentsketch_browser_args.go/test.go. The merge always includes
--disable-features=AutofillAiWalletPrivatePasses in the explicit loader options.
Existing disabled features share one switch to avoid last-switch replacement.
The rest of the loader's environment and registry protections remain intact.

AgentSketch main passes AGENTSKETCH_BROWSER_ARGUMENTS into this function before
creating a window. This app-specific variable survives the upstream loader's
package init, which clears the standard WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS.
Remote debugging is absent unless a developer passes it through the app-specific
process environment for a test launch. Production has no port.

Test: go test github.com/wailsapp/go-webview2/pkg/edge -run AgentSketch
Verify actual msedgewebview2.exe command line after upgrades. Do not remove the
protection until Windows authentication failures have been checked against a
vendor fix.
