//go:build windows

package main

import (
	"os"
	"strings"

	"github.com/wailsapp/go-webview2/pkg/edge"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

func configurePlatform(appOptions *options.App, _ *App, profile string) {
	// The local loader patch forwards this protection flag as a real WebView2
	// argument because Wails clears environment-derived browser arguments.
	edge.SetAdditionalBrowserArguments(strings.Fields(os.Getenv("AGENTSKETCH_BROWSER_ARGUMENTS")))
	appOptions.Windows = &windows.Options{
		// Keep the measured Canvas 2D default; users can opt in to GPU rendering.
		WebviewGpuIsDisabled: os.Getenv("AGENTSKETCH_ENABLE_GPU") != "1",
		WebviewUserDataPath:  profile,
		Theme:                windows.Light,
		DisablePinchZoom:     true,
		IsZoomControlEnabled: false,
	}
}
