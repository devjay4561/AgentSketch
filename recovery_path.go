package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

// The recovery file holds the latest edit; this sidecar remembers which saved file
// that edit belongs to, so a reopened app can save straight back to it.
func (s *Store) recoveryPathFile() string {
	if s.recovery == "" {
		return ""
	}
	return s.recovery + ".path"
}

func (s *Store) SetRecoveryPath(path string) error {
	file := s.recoveryPathFile()
	if file == "" {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if path == "" {
		if err := os.Remove(file); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		return nil
	}
	return atomicWrite(file, []byte(path))
}

func (s *Store) RecoveryPath() string {
	file := s.recoveryPathFile()
	if file == "" {
		return ""
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := os.ReadFile(file)
	if err != nil || len(data) > 8000 {
		return ""
	}
	return strings.TrimSpace(string(data))
}

// LoadAutosavePath returns the saved file the recovered work came from, only when
// that file is still in the recent list and still exists.
func (a *App) LoadAutosavePath() string {
	path := a.store.RecoveryPath()
	if path == "" {
		return ""
	}
	recent, err := a.documents.Recent()
	if err != nil {
		return ""
	}
	for _, entry := range recent {
		if pathKey(entry.Path) == pathKey(path) {
			if info, err := os.Stat(entry.Path); err == nil && !info.IsDir() {
				return entry.Path
			}
		}
	}
	return ""
}

// A document dropped on the window opens through the same path as a double-clicked
// file, so the app knows where it came from and Ctrl+S saves back to it.
func (a *App) fileDropped(ctx context.Context, paths []string) {
	if len(paths) != 1 || !isDocumentPath(paths[0]) || !filepath.IsAbs(paths[0]) {
		return
	}
	a.queueLaunchDocument(paths[0])
}
