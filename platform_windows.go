//go:build windows

package main

import (
	"os"
	"strings"

	"github.com/wailsapp/go-webview2/pkg/edge"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

func configurePlatform(appOptions *options.App, app *App, profile string) {
	// The local loader patch forwards this protection flag as a real WebView2
	// argument because Wails clears environment-derived browser arguments.
	edge.SetAdditionalBrowserArguments(strings.Fields(os.Getenv("AGENTSKETCH_BROWSER_ARGUMENTS")))
	appOptions.Windows = &windows.Options{
		// File menu setting (default on); AGENTSKETCH_ENABLE_GPU=0/1 overrides it.
		WebviewGpuIsDisabled: !app.graphics.Active,
		WebviewUserDataPath:  profile,
		Theme:                windows.Light,
		DisablePinchZoom:     true,
		IsZoomControlEnabled: false,
	}
}
