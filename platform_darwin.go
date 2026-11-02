//go:build darwin

package main

import (
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
)

func configurePlatform(appOptions *options.App, app *App, _ string) {
	appOptions.Mac = &mac.Options{
		DisableZoom: true,
		OnFileOpen:  app.openFinderDocument,
	}
}
