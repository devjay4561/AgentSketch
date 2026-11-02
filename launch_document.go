package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// An association or second-instance request may select a local document, never
// execute a command or interpret a URI passed in the command line.
func launchDocumentPath(args []string, workingDirectory string) string {
	for _, arg := range args {
		if arg == "" || strings.HasPrefix(arg, "-") || strings.ContainsAny(arg, "\x00\r\n") || !isDocumentPath(arg) {
			continue
		}
		if strings.HasPrefix(arg, `\\`) || strings.HasPrefix(arg, "//") || strings.Contains(arg, "://") {
			continue
		}
		candidate := arg
		if !filepath.IsAbs(candidate) {
			if workingDirectory == "" {
				continue
			}
			candidate = filepath.Join(workingDirectory, candidate)
		}
		candidate = filepath.Clean(candidate)
		if info, err := os.Stat(candidate); err == nil && info.Mode().IsRegular() {
			return candidate
		}
	}
	return ""
}

// Consumes one queued request. This only reads and validates the selected file.
// The frontend owns unsaved-change confirmation and active-document assignment.
func (a *App) TakeLaunchDocument() (*OpenResult, error) {
	a.launchMu.Lock()
	var path string
	if len(a.launchPaths) > 0 {
		path = a.launchPaths[0]
		copy(a.launchPaths, a.launchPaths[1:])
		a.launchPaths[len(a.launchPaths)-1] = ""
		a.launchPaths = a.launchPaths[:len(a.launchPaths)-1]
	}
	a.launchMu.Unlock()
	if path == "" {
		return nil, nil
	}
	data, err := a.store.Open(path)
	if err != nil {
		return nil, fmt.Errorf("선택한 AgentSketch 문서를 열 수 없습니다: %w", err)
	}
	if err = a.documents.Remember(path, data); err != nil {
		return nil, err
	}
	return &OpenResult{Path: path, Data: string(data)}, nil
}

// .flowpaper is the extension of pre-rename FlowPaper builds; keep opening those files.
func isDocumentPath(path string) bool {
	ext := filepath.Ext(path)
	return strings.EqualFold(ext, ".agentsketch") || strings.EqualFold(ext, ".flowpaper")
}
