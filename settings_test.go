package main

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func TestLoadGPUSettingDefaults(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	if !loadGPUSetting(path) {
		t.Fatal("absent settings should enable the GPU")
	}
	for _, data := range []string{
		`{"gpu":false`,
		`{"gpu":null}`,
		`{"gpu":"false"}`,
		`{}`,
		`{"gpu":false}` + strings.Repeat(" ", maxSettingsBytes),
	} {
		if err := os.WriteFile(path, []byte(data), 0600); err != nil {
			t.Fatal(err)
		}
		if !loadGPUSetting(path) {
			t.Fatalf("invalid settings should enable the GPU (file length %d)", len(data))
		}
	}
}

func TestGraphicsSettingsSaveAndOverride(t *testing.T) {
	path := filepath.Join(t.TempDir(), "AgentSketch", "settings.json")
	app := &App{settingsPath: path, graphics: resolveGraphicsSettings(true, "")}
	if err := app.SetGPUEnabled(false); err != nil {
		t.Fatal(err)
	}
	if got := app.GetGraphicsSettings(); got != (GraphicsSettings{Saved: false, Active: true}) {
		t.Fatalf("changing the saved setting should leave the active mode alone: %+v", got)
	}
	for _, tc := range []struct {
		saved    bool
		override string
		active   bool
		forced   bool
	}{
		{false, "", false, false},
		{false, "1", true, true},
		{true, "0", false, true},
		{true, "yes", true, false},
	} {
		if err := saveGPUSetting(path, tc.saved); err != nil {
			t.Fatal(err)
		}
		settings := resolveGraphicsSettings(loadGPUSetting(path), tc.override)
		if settings != (GraphicsSettings{Saved: tc.saved, Active: tc.active, EnvOverride: tc.forced}) {
			t.Fatalf("saved %t with override %q produced %+v", tc.saved, tc.override, settings)
		}
		app.graphics = settings
		if tc.forced && (app.SetGPUEnabled(!tc.saved) == nil || loadGPUSetting(path) != tc.saved) {
			t.Fatal("a forced setting must leave the saved preference alone")
		}
	}
}

func TestRecoveryFailureCancelsRestart(t *testing.T) {
	app := &App{store: NewStore(filepath.Join(t.TempDir(), "recovery.agentsketch"))}
	app.restartRequested.Store(true)
	if err := app.CloseWithRecoveryForDocument("invalid", ""); err == nil {
		t.Fatal("invalid recovery data should block closing")
	}
	if app.restartRequested.Load() || app.restartDocument.Load() != nil || app.allowClose.Load() {
		t.Fatal("failed recovery must not close or relaunch the app")
	}
}

func TestWaitForRestartParentRejectsInvalidPID(t *testing.T) {
	for _, value := range []string{"", "invalid", "0", strconv.Itoa(os.Getpid())} {
		t.Setenv(restartWaitPID, value)
		restarted, err := waitForRestartParent()
		if restarted || err != nil {
			t.Fatalf("invalid wait PID %q returned (%v, %v)", value, restarted, err)
		}
		if _, set := os.LookupEnv(restartWaitPID); set {
			t.Fatal("the restart PID must not leak to child processes")
		}
	}
}
