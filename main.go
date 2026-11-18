package main

import (
	"context"
	"embed"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/wailsapp/go-webview2/pkg/edge"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
	win "golang.org/x/sys/windows"
)

//go:embed all:dist
var assets embed.FS

const (
	restartWaitPID     = "AGENTSKETCH_WAIT_PID"
	restartDocumentArg = "--agentsketch-restart-document="
)

func main() {
	restarting, err := waitForRestartParent()
	if err != nil {
		fmt.Fprintln(os.Stderr, "AgentSketch를 다시 시작할 수 없습니다:", err)
		return
	}
	var recoveryPath *string
	if restarting && len(os.Args) > 1 {
		if path, ok := strings.CutPrefix(os.Args[1], restartDocumentArg); ok {
			recoveryPath = &path
			os.Args = append(os.Args[:1], os.Args[2:]...)
		}
	}
	// The pinned loader patch passes the mandatory authentication-protection
	// flag as a real loader option; Wails v2 otherwise clears environment args.
	edge.SetAdditionalBrowserArguments(strings.Fields(os.Getenv("AGENTSKETCH_BROWSER_ARGUMENTS")))
	migrateLegacyProfile()
	app := NewApp()
	if recoveryPath != nil {
		// The original arguments can name a document that is no longer active.
		app.launchPath = ""
		app.restartRecoveryPath = recoveryPath
	}
	profile := ""
	if dir, err := os.UserConfigDir(); err == nil {
		profile = filepath.Join(dir, "AgentSketch", "WebView2")
	}
	err = wails.Run(&options.App{
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
		Windows: &windows.Options{
			WebviewGpuIsDisabled: !app.graphics.Active,
			WebviewUserDataPath:  profile,
			Theme:                windows.Light,
			DisablePinchZoom:     true,
			IsZoomControlEnabled: false,
		},
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, "AgentSketch를 시작할 수 없습니다:", err)
		return
	}
	if path := app.restartDocument.Load(); path != nil {
		if err := restartApp(*path); err != nil {
			fmt.Fprintln(os.Stderr, "AgentSketch를 다시 시작할 수 없습니다:", err)
		}
	}
}

func restartApp(path string) error {
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	args := append([]string{restartDocumentArg + path}, os.Args[1:]...)
	cmd := exec.Command(executable, args...)
	cmd.Env = append(os.Environ(), restartWaitPID+"="+strconv.Itoa(os.Getpid()))
	if err := cmd.Start(); err != nil {
		return err
	}
	return cmd.Process.Release()
}

func waitForRestartParent() (bool, error) {
	value, set := os.LookupEnv(restartWaitPID)
	if !set {
		return false, nil
	}
	if err := os.Unsetenv(restartWaitPID); err != nil {
		return false, err
	}
	pid, err := strconv.ParseUint(value, 10, 32)
	if err != nil || pid == 0 || pid == uint64(os.Getpid()) {
		return false, nil
	}
	parent, err := win.OpenProcess(win.SYNCHRONIZE, false, uint32(pid))
	if errors.Is(err, win.ERROR_INVALID_PARAMETER) {
		return true, nil // The parent already exited.
	}
	if err != nil {
		return false, err
	}
	defer win.CloseHandle(parent)
	event, err := win.WaitForSingleObject(parent, 10_000)
	if err != nil {
		return false, err
	}
	if event != win.WAIT_OBJECT_0 {
		return false, errors.New("timed out waiting for the previous AgentSketch process")
	}
	return true, nil
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
