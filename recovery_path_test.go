package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRecoveredWorkRemembersItsSavedFile(t *testing.T) {
	dir := t.TempDir()
	library := NewDocumentLibrary(filepath.Join(dir, "library"))
	store := NewStore(filepath.Join(dir, "recovery.agentsketch"))
	app := &App{documents: library, store: store}
	file := filepath.Join(dir, "board.agentsketch")
	if err := library.Save(file, testDocument(file), store); err != nil {
		t.Fatal(err)
	}
	if err := app.AutosaveForDocument(string(testDocument("edit")), file); err != nil {
		t.Fatal(err)
	}
	// A fresh app instance over the same folders finds the file again.
	reopened := &App{documents: NewDocumentLibrary(filepath.Join(dir, "library")), store: NewStore(filepath.Join(dir, "recovery.agentsketch"))}
	if got := reopened.LoadAutosavePath(); pathKey(got) != pathKey(file) {
		t.Fatalf("recovery path = %q, want %q", got, file)
	}
	// Unsaved work clears it, and a deleted file is never offered.
	if err := app.AutosaveForDocument(string(testDocument("new")), ""); err != nil {
		t.Fatal(err)
	}
	if got := reopened.LoadAutosavePath(); got != "" {
		t.Fatalf("cleared recovery path = %q", got)
	}
	if err := app.AutosaveForDocument(string(testDocument("edit")), file); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(file); err != nil {
		t.Fatal(err)
	}
	if got := reopened.LoadAutosavePath(); got != "" {
		t.Fatalf("missing file offered: %q", got)
	}
}

func TestDroppedDocumentOpensWithItsPath(t *testing.T) {
	app := &App{}
	app.fileDropped(nil, []string{`C:\boards\a.agentsketch`, `C:\boards\b.agentsketch`})
	if len(app.launchPaths) != 0 {
		t.Fatal("multiple dropped files must not open")
	}
	app.fileDropped(nil, []string{`C:\pictures\a.png`})
	if len(app.launchPaths) != 0 {
		t.Fatal("images are not documents")
	}
}
