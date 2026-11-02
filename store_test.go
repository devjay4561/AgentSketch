package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func testDocument(title string) []byte {
	return []byte(fmt.Sprintf(`{"format":"agentsketch","version":1,"title":%q,"nodes":[],"edges":[],"assets":{},"viewport":{"x":0,"y":0,"zoom":1}}`, title))
}

func TestDocumentRoundtripAndOverwrite(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "한글 문서.agentsketch")
	s := NewStore(filepath.Join(dir, "recovery.agentsketch"))
	first := testDocument("월간보고")
	if err := s.Save(path, first); err != nil {
		t.Fatal(err)
	}
	got, err := s.Open(path)
	if err != nil || string(got) != string(first) {
		t.Fatalf("roundtrip: %s %v", got, err)
	}
	second := testDocument("월간보고 수정")
	if err = s.Save(path, second); err != nil {
		t.Fatal(err)
	}
	got, err = s.Open(path)
	if err != nil || string(got) != string(second) {
		t.Fatalf("overwrite: %s %v", got, err)
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 1 {
		t.Fatalf("temporary files left: %v", entries)
	}
}

func TestInvalidInputCannotOverwriteExistingDocument(t *testing.T) {
	path := filepath.Join(t.TempDir(), "existing.agentsketch")
	s := NewStore("")
	good := testDocument("작업 보존")
	if err := s.Save(path, good); err != nil {
		t.Fatal(err)
	}
	bad := []string{"", `null`, `{}`, `{"format":"agentsketch","version":2}`, `{"format":"agentsketch","version":1,"nodes":null,"edges":[],"assets":{}}`, string(good) + ` {}`}
	for _, input := range bad {
		if err := s.Save(path, []byte(input)); err == nil {
			t.Errorf("accepted invalid input %q", input)
		}
		got, err := os.ReadFile(path)
		if err != nil || string(got) != string(good) {
			t.Fatal("existing document changed", err)
		}
	}
}

func TestRecoveryLatestAndMissing(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested", "recovery.agentsketch")
	s := NewStore(path)
	got, err := s.LoadAutosave()
	if err != nil || len(got) != 0 {
		t.Fatalf("missing: %q %v", got, err)
	}
	if err = s.Autosave(testDocument("첫 작업")); err != nil {
		t.Fatal(err)
	}
	want := testDocument("최신 작업")
	if err = s.Autosave(want); err != nil {
		t.Fatal(err)
	}
	got, err = s.LoadAutosave()
	if err != nil || string(got) != string(want) {
		t.Fatalf("restore: %q %v", got, err)
	}
	if err = s.Autosave([]byte("broken")); err == nil {
		t.Fatal("invalid recovery accepted")
	}
	got, _ = s.LoadAutosave()
	if string(got) != string(want) {
		t.Fatal("valid recovery overwritten")
	}
}

func TestConcurrentWritesRemainComplete(t *testing.T) {
	path := filepath.Join(t.TempDir(), "concurrent.agentsketch")
	s := NewStore(path)
	var wg sync.WaitGroup
	for i := range 12 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := s.Autosave(testDocument(fmt.Sprint(i))); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	got, err := s.LoadAutosave()
	if err != nil {
		t.Fatal(err)
	}
	if err = validateDocument(got); err != nil {
		t.Fatal(err)
	}
}

func TestLimitsAndUnsafePaths(t *testing.T) {
	if err := validateDocument(make([]byte, maxDocumentBytes+1)); err == nil {
		t.Fatal("oversized accepted")
	}
	if err := atomicWrite("relative.agentsketch", testDocument("x")); err == nil {
		t.Fatal("relative accepted")
	}
	dir := t.TempDir()
	if err := atomicWrite(dir, []byte("x")); err == nil {
		t.Fatal("directory accepted")
	}
	path := filepath.Join(dir, "missing", "x.agentsketch")
	if err := atomicWrite(path, testDocument("x")); err == nil {
		t.Fatal("missing parent silently created")
	}
	if _, err := readLimited(dir); err == nil {
		t.Fatal("directory read accepted")
	}
}

func TestSafeFilename(t *testing.T) {
	for input, want := range map[string]string{"CON": "문서_CON", "nul.txt": "문서_nul.txt", "abc/def": "abc_def", " . ": "새 흐름", "월간 보고": "월간 보고"} {
		if got := safeFilename(input); got != want {
			t.Errorf("%q => %q, want %q", input, got, want)
		}
	}
	if len([]rune(safeFilename(strings.Repeat("가", 200)))) != 100 {
		t.Fatal("filename cap failed")
	}
}

func TestExportFilenameExtensionIsIdempotent(t *testing.T) {
	for _, tc := range []struct{ name, extension, want string }{
		{"월간보고.png", ".png", "월간보고.png"},
		{"월간보고.PNG", ".png", "월간보고.PNG"},
		{"월간보고", ".pdf", "월간보고.pdf"},
		{"자료.agentsketch", ".agentsketch", "자료.agentsketch"},
	} {
		if got := filenameWithExtension(tc.name, tc.extension); got != tc.want {
			t.Errorf("%q + %q => %q, want %q", tc.name, tc.extension, got, tc.want)
		}
	}
}
