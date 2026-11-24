package main

import (
	"github.com/wailsapp/wails/v2/pkg/options"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestLaunchDocumentOnlyReadsFirstExistingAgentSketch(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "한글 자료.agentsketch")
	if err := os.WriteFile(path, testDocument("선행 자료"), 0600); err != nil {
		t.Fatal(err)
	}
	selected := launchDocumentPath([]string{"--debug", filepath.Join(dir, "missing.agentsketch"), "a.exe", "한글 자료.agentsketch"}, dir)
	if selected != path {
		t.Fatal(selected)
	}
	app := &App{store: NewStore(filepath.Join(dir, "recovery.agentsketch")), documents: NewDocumentLibrary(filepath.Join(dir, "library")), launchPaths: []string{selected}}
	result, err := app.TakeLaunchDocument()
	if err != nil || result.Path != path || result.Data != string(testDocument("선행 자료")) {
		t.Fatal(result, err)
	}
	if app.currentPath.Load() != nil {
		t.Fatal("file association assigned active document before frontend acceptance")
	}
	result, err = app.TakeLaunchDocument()
	if err != nil || result != nil {
		t.Fatal("launch request was not consumed", result, err)
	}
}

func TestFinderOpenQueuesDocumentsInOrder(t *testing.T) {
	dir := t.TempDir()
	paths := []string{filepath.Join(dir, "first.agentsketch"), filepath.Join(dir, "second.flowpaper")}
	for i, path := range paths {
		if err := os.WriteFile(path, testDocument(string(rune('A'+i))), 0600); err != nil {
			t.Fatal(err)
		}
	}
	app := &App{store: NewStore(filepath.Join(dir, "recovery.agentsketch")), documents: NewDocumentLibrary(filepath.Join(dir, "library"))}
	for _, path := range paths {
		app.openFinderDocument(path)
	}
	for _, path := range paths {
		result, err := app.TakeLaunchDocument()
		if err != nil || result == nil || result.Path != path {
			t.Fatalf("result=%+v err=%v, want %s", result, err, path)
		}
	}
	if result, err := app.TakeLaunchDocument(); err != nil || result != nil {
		t.Fatalf("queue should be empty: result=%+v err=%v", result, err)
	}
}
func TestSecondInstanceQueuesWithoutChangingRecoveryAndRejectsBadFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "request.agentsketch")
	if err := os.WriteFile(path, []byte("invalid"), 0600); err != nil {
		t.Fatal(err)
	}
	app := &App{store: NewStore(filepath.Join(dir, "recovery.agentsketch")), documents: NewDocumentLibrary(filepath.Join(dir, "library"))}
	app.secondInstance(options.SecondInstanceData{Args: []string{path}, WorkingDirectory: dir})
	if _, err := app.TakeLaunchDocument(); err == nil {
		t.Fatal("invalid association document accepted")
	}
	if _, err := os.Stat(app.store.recovery); !os.IsNotExist(err) {
		t.Fatal("launch mutated recovery", err)
	}
	for _, arg := range []string{"https://example.com/a.agentsketch", `\\server\a.agentsketch`, "a.exe", "--unsafe.agentsketch"} {
		if launchDocumentPath([]string{arg}, dir) != "" {
			t.Fatalf("accepted %q", arg)
		}
	}
}

// Files saved by pre-rename FlowPaper builds keep opening.
func TestLegacyFlowPaperDocumentStillOpens(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "예전 보드.flowpaper")
	legacy := []byte(`{"format":"flowpaper","version":1,"title":"예전","nodes":[],"edges":[],"assets":{},"viewport":{"x":0,"y":0,"zoom":1}}`)
	if err := os.WriteFile(path, legacy, 0600); err != nil {
		t.Fatal(err)
	}
	if got := launchDocumentPath([]string{"예전 보드.flowpaper"}, dir); got != path {
		t.Fatal(got)
	}
	if got, err := NewStore(filepath.Join(dir, "recovery.agentsketch")).Open(path); err != nil || string(got) != string(legacy) {
		t.Fatal(string(got), err)
	}
}

func TestLegacyProfileMovesOnceAndKeepsRecovery(t *testing.T) {
	dir := t.TempDir()
	profileRoot := dir
	switch runtime.GOOS {
	case "windows":
		t.Setenv("AppData", dir)
	case "darwin":
		t.Setenv("HOME", dir)
		profileRoot = filepath.Join(dir, "Library", "Application Support")
	default:
		t.Setenv("XDG_CONFIG_HOME", dir)
	}
	old := filepath.Join(profileRoot, "FlowPaper")
	if err := os.MkdirAll(filepath.Join(old, "library"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(old, "recovery.flowpaper"), testDocument("복구"), 0600); err != nil {
		t.Fatal(err)
	}
	migrateLegacyProfile()
	if got, err := os.ReadFile(filepath.Join(profileRoot, "AgentSketch", "recovery.agentsketch")); err != nil || string(got) != string(testDocument("복구")) {
		t.Fatal(string(got), err)
	}
	if _, err := os.Stat(filepath.Join(profileRoot, "AgentSketch", "library")); err != nil {
		t.Fatal(err)
	}
	// A second old folder appearing later must not overwrite the migrated profile.
	_ = os.MkdirAll(old, 0700)
	migrateLegacyProfile()
	if _, err := os.Stat(old); err != nil {
		t.Fatal("existing AgentSketch profile was replaced", err)
	}
}
