package main

import (
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"sync"
)

const maxDocumentBytes = 80 * 1024 * 1024

// Store serializes writes and keeps only one recovery document. A sibling
// temporary file is flushed before replacing the destination on the same volume.
type Store struct {
	mu       sync.Mutex
	recovery string
}

func NewStore(recoveryPath string) *Store { return &Store{recovery: recoveryPath} }

// These markers check container shape without retaining/copying the embedded
// raster strings during every autosave. The frontend validates their contents.
type arrayMarker bool

func (m *arrayMarker) UnmarshalJSON(data []byte) error {
	if len(data) == 0 || data[0] != '[' {
		return errors.New("목록 정보가 올바르지 않습니다")
	}
	*m = true
	return nil
}

type objectMarker bool

func (m *objectMarker) UnmarshalJSON(data []byte) error {
	if len(data) == 0 || data[0] != '{' {
		return errors.New("이미지 정보가 올바르지 않습니다")
	}
	*m = true
	return nil
}

func validateDocument(data []byte) error {
	if len(data) == 0 || len(data) > maxDocumentBytes {
		return errors.New("문서 크기는 0바이트보다 크고 80MB 이하여야 합니다")
	}
	var root struct {
		Format  string       `json:"format"`
		Version int          `json:"version"`
		Title   string       `json:"title"`
		Nodes   arrayMarker  `json:"nodes"`
		Edges   arrayMarker  `json:"edges"`
		Assets  objectMarker `json:"assets"`
	}
	if err := json.Unmarshal(data, &root); err != nil {
		return errors.New("문서 내용이 올바른 JSON 형식이 아닙니다")
	}
	if (root.Format != "agentsketch" && root.Format != "flowpaper") || root.Version != 1 {
		return errors.New("지원하는 AgentSketch 문서가 아닙니다. 버전 1 문서를 선택하세요")
	}
	if len(root.Title) > 16384 {
		return errors.New("문서 제목이 너무 깁니다")
	}
	if !bool(root.Nodes) || !bool(root.Edges) || !bool(root.Assets) {
		return errors.New("문서의 요소·연결·이미지 정보가 누락되었습니다")
	}
	return nil
}

func readLimited(path string) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, errors.New("일반 파일을 선택하세요")
	}
	if info.Size() > maxDocumentBytes {
		return nil, errors.New("문서가 80MB를 초과합니다")
	}
	data, err := io.ReadAll(io.LimitReader(f, maxDocumentBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) > maxDocumentBytes {
		return nil, errors.New("문서가 80MB를 초과합니다")
	}
	return data, nil
}

func (s *Store) Open(path string) ([]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := readLimited(path)
	if err != nil {
		return nil, err
	}
	if err = validateDocument(data); err != nil {
		return nil, err
	}
	return data, nil
}

func (s *Store) Save(path string, data []byte) error {
	if err := validateDocument(data); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return atomicWrite(path, data)
}

func (s *Store) Autosave(data []byte) error {
	if err := validateDocument(data); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.recovery == "" {
		return errors.New("자동 복구 폴더를 찾지 못했습니다. 파일로 저장해 주세요")
	}
	if err := os.MkdirAll(filepath.Dir(s.recovery), 0700); err != nil {
		return err
	}
	return atomicWrite(s.recovery, data)
}

func (s *Store) LoadAutosave() ([]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.recovery == "" {
		return nil, nil
	}
	data, err := readLimited(s.recovery)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if err = validateDocument(data); err != nil {
		return nil, err
	}
	return data, nil
}

func atomicWrite(path string, data []byte) error {
	if !filepath.IsAbs(path) {
		return errors.New("저장할 파일의 전체 경로가 필요합니다")
	}
	if info, err := os.Lstat(path); err == nil && (!info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0) {
		return errors.New("일반 파일 경로에만 저장할 수 있습니다")
	} else if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".agentsketch-*.tmp")
	if err != nil {
		return err
	}
	tmp := f.Name()
	defer os.Remove(tmp)
	if _, err = f.Write(data); err != nil {
		f.Close()
		return err
	}
	if err = f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	// os.Rename uses MoveFileEx with REPLACE_EXISTING on Windows.
	return os.Rename(tmp, path)
}
