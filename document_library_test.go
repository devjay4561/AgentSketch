package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLibraryVersionRoundtripAndConflictPreservesBothDocuments(t *testing.T) {
	dir := t.TempDir()
	store := NewStore(filepath.Join(dir, "recovery.agentsketch"))
	library := NewDocumentLibrary(filepath.Join(dir, "library"))
	path := filepath.Join(dir, "report.agentsketch")
	if err := library.Save(path, testDocument("first"), store); err != nil {
		t.Fatal(err)
	}
	if err := library.Save(path, testDocument("second"), store); err != nil {
		t.Fatal(err)
	}
	versions, err := library.Versions(path)
	if err != nil || len(versions) != 1 {
		t.Fatal(versions, err)
	}
	old, err := library.ReadVersion(versions[0].ID)
	if err != nil || old.Path != "" || old.Data != string(testDocument("first")) {
		t.Fatal(old, err)
	}
	external := testDocument("external edit")
	if err := os.WriteFile(path, external, 0600); err != nil {
		t.Fatal(err)
	}
	if err := library.Save(path, testDocument("app edit"), store); err == nil {
		t.Fatal("external conflict overwritten")
	}
	got, _ := os.ReadFile(path)
	if string(got) != string(external) {
		t.Fatal("external edit lost")
	}
	recent, err := library.Recent()
	if err != nil || len(recent) != 1 || recent[0].Path != path {
		t.Fatal(recent, err)
	}
}
func TestLibraryRetentionAndVersionPathCannotEscape(t *testing.T) {
	dir := t.TempDir()
	library := NewDocumentLibrary(filepath.Join(dir, "library"))
	for i := 0; i < 20; i++ {
		if _, err := library.Snapshot("", testDocument(fmt.Sprint(i))); err != nil {
			t.Fatal(err)
		}
	}
	versions, err := library.Versions("")
	if err != nil || len(versions) != libraryVersionsPerFile {
		t.Fatal(len(versions), err)
	}
	files, _ := os.ReadDir(library.root)
	if len(files) != libraryVersionsPerFile+1 {
		t.Fatal("unbounded snapshots", len(files))
	}
	if _, err = library.ReadVersion("../../outside"); err == nil {
		t.Fatal("path traversal accepted")
	}
	if _, err = library.ReadVersion(strings.Repeat("f", 64)); err == nil {
		t.Fatal("unknown version accepted")
	}
}
func TestRecoveryPerFileAndDocumentBoundary(t *testing.T) {
	dir := t.TempDir()
	library := NewDocumentLibrary(filepath.Join(dir, "library"))
	store := NewStore(filepath.Join(dir, "recovery.agentsketch"))
	app := &App{documents: library, store: store}
	first := filepath.Join(dir, "a.agentsketch")
	second := filepath.Join(dir, "b.agentsketch")
	for _, path := range []string{first, second} {
		if err := library.Save(path, testDocument(path), store); err != nil {
			t.Fatal(err)
		}
	}
	if err := app.SetActiveDocumentPath(first); err != nil {
		t.Fatal(err)
	}
	if err := app.Autosave(string(testDocument("unsaved a"))); err != nil {
		t.Fatal(err)
	}
	if err := app.SetActiveDocumentPath(second); err != nil {
		t.Fatal(err)
	}
	if err := app.Autosave(string(testDocument("unsaved b"))); err != nil {
		t.Fatal(err)
	}
	if err := app.SetActiveDocumentPath(""); err != nil {
		t.Fatal(err)
	}
	if err := app.Autosave(string(testDocument("new document"))); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ path, title string }{{first, "unsaved a"}, {second, "unsaved b"}} {
		versions, err := library.Versions(tc.path)
		if err != nil || len(versions) != 1 {
			t.Fatal(versions, err)
		}
		got, err := library.ReadVersion(versions[0].ID)
		if err != nil || got.Data != string(testDocument(tc.title)) {
			t.Fatal(got, err)
		}
	}
	got, err := store.LoadAutosave()
	if err != nil || string(got) != string(testDocument("new document")) {
		t.Fatal(string(got), err)
	}
}
func TestSourceInspectionDetectsContentChangesAndDoesNotVerifyURL(t *testing.T) {
	path := filepath.Join(t.TempDir(), "source.txt")
	if err := os.WriteFile(path, []byte("before"), 0600); err != nil {
		t.Fatal(err)
	}
	first, err := inspectSource(path)
	if err != nil || !first.Exists || !first.HashComplete || first.Kind != "file" {
		t.Fatal(first, err)
	}
	if err := os.WriteFile(path, []byte("after!"), 0600); err != nil {
		t.Fatal(err)
	}
	second, err := inspectSource(path)
	if err != nil || first.Fingerprint == second.Fingerprint {
		t.Fatal(second, err)
	}
	remote, err := inspectSource("https://example.com/report")
	if err != nil || remote.Exists || remote.HashComplete || remote.Note == "" {
		t.Fatal(remote, err)
	}
	for _, bad := range []string{"javascript:alert(1)", "file:///C:/windows/a.exe", "https://user:password@example.com", "relative.txt", `\\server\share\data.txt`} {
		if _, _, err := sourceTarget(bad); err == nil {
			t.Errorf("unsafe target %q", bad)
		}
	}
}

func TestCapturedRecoveryPathSurvivesCurrentDocumentSwitch(t *testing.T) {
	dir := t.TempDir()
	library := NewDocumentLibrary(filepath.Join(dir, "library"))
	store := NewStore(filepath.Join(dir, "recovery.agentsketch"))
	app := &App{documents: library, store: store}
	first, second := filepath.Join(dir, "a.agentsketch"), filepath.Join(dir, "b.agentsketch")
	for _, path := range []string{first, second} {
		if err := library.Save(path, testDocument(path), store); err != nil {
			t.Fatal(err)
		}
	}
	if err := app.SetActiveDocumentPath(second); err != nil {
		t.Fatal(err)
	}
	if err := app.AutosaveForDocument(string(testDocument("queued a")), first); err != nil {
		t.Fatal(err)
	}
	a, _ := library.Versions(first)
	b, _ := library.Versions(second)
	if len(a) != 1 || len(b) != 0 {
		t.Fatal("queued revision assigned to current document", a, b)
	}
}
