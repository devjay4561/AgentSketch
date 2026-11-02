package main

import (
	"context"
	"embed"
	"fmt"
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:dist
var assets embed.FS

func main() {
	runPlatformOCRWorker(os.Args[1:])
	migrateLegacyProfile()
	app := NewApp()
	profile := ""
	if dir, err := os.UserConfigDir(); err == nil {
		profile = filepath.Join(dir, "AgentSketch", "WebView2")
	}
	appOptions := &options.App{
		Title: "AgentSketch · 흐름을 한 장에",
		Width: 1440, Height: 940, MinWidth: 960, MinHeight: 640,
		BackgroundColour:                 &options.RGBA{R: 246, G: 247, B: 249, A: 255},
		EnableFraudulentWebsiteDetection: true,
		AssetServer:                      &assetserver.Options{Assets: assets},
		OnStartup:                        app.startup, OnBeforeClose: app.beforeClose, OnShutdown: func(ctx context.Context) { _ = app.DisableAutomation() },
		Bind: []interface{}{app},
		SingleInstanceLock: &options.SingleInstanceLock{
			UniqueId:               "AgentSketch-9e5e4fd4-a6f9-49d0-bbfc-f2db92e17041",
			OnSecondInstanceLaunch: app.secondInstance,
		},
	}
	configurePlatform(appOptions, app, profile)
	err := wails.Run(appOptions)
	if err != nil {
		fmt.Fprintln(os.Stderr, "AgentSketch를 시작할 수 없습니다:", err)
	}
}

// Pre-rename builds were called FlowPaper. Move their profile (recovery, library, WebView2 data)
// once; skip silently if the new folder exists or an old instance holds it open.
func migrateLegacyProfile() {
	dir, err := os.UserConfigDir()
	if err != nil {
		return
	}
	next := filepath.Join(dir, "AgentSketch")
	if _, err := os.Stat(next); err == nil {
		return
	}
	if os.Rename(filepath.Join(dir, "FlowPaper"), next) == nil {
		_ = os.Rename(filepath.Join(next, "recovery.flowpaper"), filepath.Join(next, "recovery.agentsketch"))
	}
}
