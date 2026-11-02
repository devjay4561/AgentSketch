package main

import (
	"errors"
	"fmt"
	"path/filepath"
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
