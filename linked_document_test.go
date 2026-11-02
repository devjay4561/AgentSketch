package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLinkedDocumentReadsWithoutReplacingActiveDocument(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "보고.agentsketch")
	data := testDocument("상세 보고")
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	app := &App{store: NewStore(filepath.Join(dir, "recovery.agentsketch")), documents: NewDocumentLibrary(filepath.Join(dir, "library"))}
	app.currentPath.Store("parent.agentsketch")
	result, err := app.ReadLinkedDocument(path)
	if err != nil || result.Data != string(data) {
		t.Fatal(result, err)
	}
	if app.currentPath.Load() != "parent.agentsketch" {
		t.Fatal("active path changed")
	}
	for _, bad := range []string{"relative.agentsketch", filepath.Join(dir, "missing.agentsketch"), filepath.Join(dir, "program.exe")} {
		if _, err := app.ReadLinkedDocument(bad); err == nil {
			t.Fatal("accepted", bad)
		}
	}
	if err := os.WriteFile(path, []byte("invalid"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := app.ReadLinkedDocument(path); err == nil {
		t.Fatal("accepted invalid document")
	}
}
