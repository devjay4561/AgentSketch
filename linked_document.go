package main

import (
	"errors"
	"fmt"
	"path/filepath"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// A linked card reads only on explicit open; it never starts a watcher or shell.
func (a *App) ReadLinkedDocument(path string) (*OpenResult, error) {
	if !filepath.IsAbs(path) || !isDocumentPath(path) {
		return nil, errors.New("절대 경로의 .agentsketch 문서만 열 수 있습니다")
	}
	path = filepath.Clean(path)
	data, err := a.store.Open(path)
	if err != nil {
		return nil, fmt.Errorf("연결 문서를 열 수 없습니다. 파일을 옮겼다면 문서 카드를 다시 연결하세요: %w", err)
	}
	if err = a.documents.Remember(path, data); err != nil {
		return nil, err
	}
	return &OpenResult{Path: path, Data: string(data)}, nil
}

// CreateLinkedDocument saves a new empty board for a document card. The save
// dialog starts next to the parent file; the active document path is unchanged.
func (a *App) CreateLinkedDocument(data string, parentPath string) (string, error) {
	if err := validateDocument([]byte(data)); err != nil {
		return "", err
	}
	options := runtime.SaveDialogOptions{
		Title:           a.tr("새 연결 문서 만들기", "Create linked document"),
		DefaultFilename: filenameWithExtension(documentName(data), ".agentsketch"),
		Filters:         []runtime.FileFilter{{DisplayName: a.tr("AgentSketch 문서", "AgentSketch document"), Pattern: "*.agentsketch"}},
	}
	if filepath.IsAbs(parentPath) {
		options.DefaultDirectory = filepath.Dir(parentPath)
	}
	path, err := runtime.SaveFileDialog(a.ctx, options)
	if err != nil || path == "" {
		return "", err
	}
	if filepath.Ext(path) == "" {
		path += ".agentsketch"
	}
	if err := a.documents.Save(path, []byte(data), a.store); err != nil {
		return "", fmt.Errorf("새 문서를 저장할 수 없습니다: %w", err)
	}
	return filepath.Clean(path), nil
}
