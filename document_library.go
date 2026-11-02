package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const libraryBudget = 256 * 1024 * 1024
const libraryVersionsPerFile = 12

type RecentDocument struct {
	Path     string `json:"path"`
	Title    string `json:"title"`
	OpenedAt string `json:"openedAt"`
}
type DocumentVersion struct {
	ID        string `json:"id"`
	Path      string `json:"path"`
	Title     string `json:"title"`
	CreatedAt string `json:"createdAt"`
	Size      int64  `json:"size"`
}
type libraryIndex struct {
	Recent     []RecentDocument  `json:"recent"`
	Versions   []DocumentVersion `json:"versions"`
	Recoveries []DocumentVersion `json:"recoveries"`
}
type DocumentLibrary struct {
	mu       sync.Mutex
	root     string
	observed map[string]string
}

func NewDocumentLibrary(root string) *DocumentLibrary {
	return &DocumentLibrary{root: root, observed: map[string]string{}}
}
func digest(data []byte) string  { value := sha256.Sum256(data); return hex.EncodeToString(value[:]) }
func pathKey(path string) string { return strings.ToLower(filepath.Clean(path)) }
func libraryTitle(data []byte) string {
	var title struct {
		Title string `json:"title"`
	}
	_ = json.Unmarshal(data, &title)
	return safeFilename(title.Title)
}
func versionDigest(path string, data []byte) string {
	hash := sha256.New()
	_, _ = hash.Write([]byte(path))
	_, _ = hash.Write([]byte{0})
	_, _ = hash.Write(data)
	return hex.EncodeToString(hash.Sum(nil))
}
func (l *DocumentLibrary) index() (libraryIndex, error) {
	var index libraryIndex
	if l.root == "" {
		return index, errors.New("문서 보관 폴더를 찾을 수 없습니다")
	}
	file, err := os.Open(filepath.Join(l.root, "index.json"))
	if errors.Is(err, os.ErrNotExist) {
		return index, nil
	}
	if err != nil {
		return index, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, 4*1024*1024+1))
	if err != nil {
		return index, err
	}
	if len(data) > 4*1024*1024 {
		return index, errors.New("문서 보관함 색인이 너무 큽니다")
	}
	if err = json.Unmarshal(data, &index); err != nil {
		return index, errors.New("문서 보관함 색인을 읽을 수 없습니다. 기존 파일은 보존됩니다")
	}
	return index, nil
}
func (l *DocumentLibrary) persist(index libraryIndex) error {
	if l.root == "" {
		return errors.New("문서 보관 폴더를 찾을 수 없습니다")
	}
	if err := os.MkdirAll(l.root, 0700); err != nil {
		return err
	}
	data, err := json.Marshal(index)
	if err != nil {
		return err
	}
	return atomicWrite(filepath.Join(l.root, "index.json"), data)
}
func remember(index *libraryIndex, path string, data []byte) {
	entry := RecentDocument{Path: path, Title: libraryTitle(data), OpenedAt: time.Now().UTC().Format(time.RFC3339Nano)}
	recent := []RecentDocument{entry}
	for _, old := range index.Recent {
		if pathKey(old.Path) != pathKey(path) && len(recent) < 30 {
			recent = append(recent, old)
		}
	}
	index.Recent = recent
}
func (l *DocumentLibrary) Remember(path string, data []byte) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	index, err := l.index()
	if err != nil {
		return err
	}
	remember(&index, path, data)
	if err = l.persist(index); err != nil {
		return err
	}
	l.observed[pathKey(path)] = digest(data)
	return nil
}
func validVersionID(id string) bool {
	if len(id) != 64 {
		return false
	}
	_, err := hex.DecodeString(id)
	return err == nil
}
func (l *DocumentLibrary) versionPath(id string) (string, error) {
	if !validVersionID(id) {
		return "", errors.New("잘못된 버전 식별자입니다")
	}
	return filepath.Join(l.root, id+".agentsketch"), nil
}
func (l *DocumentLibrary) addVersion(index *libraryIndex, path string, data []byte) (DocumentVersion, error) {
	id := versionDigest(path, data)
	for _, old := range index.Versions {
		if old.ID == id {
			return old, nil
		}
	}
	entry := DocumentVersion{ID: id, Path: path, Title: libraryTitle(data), CreatedAt: time.Now().UTC().Format(time.RFC3339Nano), Size: int64(len(data))}
	if err := os.MkdirAll(l.root, 0700); err != nil {
		return entry, err
	}
	target, _ := l.versionPath(id)
	if err := atomicWrite(target, data); err != nil {
		return entry, err
	}
	index.Versions = append([]DocumentVersion{entry}, index.Versions...)
	return entry, nil
}
func (l *DocumentLibrary) retain(index *libraryIndex) error {
	kept := []DocumentVersion{}
	removed := []DocumentVersion{}
	counts := map[string]int{}
	var total int64
	sort.SliceStable(index.Versions, func(i, j int) bool { return index.Versions[i].CreatedAt > index.Versions[j].CreatedAt })
	for _, version := range index.Versions {
		key := pathKey(version.Path)
		if counts[key] >= libraryVersionsPerFile || total+version.Size > libraryBudget {
			removed = append(removed, version)
			continue
		}
		counts[key]++
		total += version.Size
		kept = append(kept, version)
	}
	index.Versions = kept
	if err := l.persist(*index); err != nil {
		return err
	}
	// Only generated, indexed content-addressed snapshots are eligible for retention.
	for _, version := range removed {
		if target, err := l.versionPath(version.ID); err == nil {
			_ = os.Remove(target)
		}
	}
	return nil
}
func (l *DocumentLibrary) Snapshot(path string, data []byte) (DocumentVersion, error) {
	if err := validateDocument(data); err != nil {
		return DocumentVersion{}, err
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	index, err := l.index()
	if err != nil {
		return DocumentVersion{}, err
	}
	entry, err := l.addVersion(&index, path, data)
	if err != nil {
		return entry, err
	}
	return entry, l.retain(&index)
}

// Keep the latest unsaved revision for each recently edited file separately from
// explicit snapshots. Files never inherit another document's recovery payload.
func (l *DocumentLibrary) RecoverForPath(path string, data []byte) error {
	if err := validateDocument(data); err != nil {
		return err
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	index, err := l.index()
	if err != nil {
		return err
	}
	id := digest([]byte("recovery:" + pathKey(path)))
	entry := DocumentVersion{ID: id, Path: path, Title: libraryTitle(data) + " · 자동 복구", CreatedAt: time.Now().UTC().Format(time.RFC3339Nano), Size: int64(len(data))}
	if err = os.MkdirAll(l.root, 0700); err != nil {
		return err
	}
	target, _ := l.versionPath(id)
	if err = atomicWrite(target, data); err != nil {
		return err
	}
	kept := []DocumentVersion{entry}
	removed := []DocumentVersion{}
	total := entry.Size
	for _, old := range index.Recoveries {
		if old.ID == id {
			continue
		}
		if len(kept) >= 30 || total+old.Size > libraryBudget {
			removed = append(removed, old)
			continue
		}
		total += old.Size
		kept = append(kept, old)
	}
	index.Recoveries = kept
	if err = l.persist(index); err != nil {
		return err
	}
	for _, old := range removed {
		if target, err := l.versionPath(old.ID); err == nil {
			_ = os.Remove(target)
		}
	}
	return nil
}
func (l *DocumentLibrary) Save(path string, data []byte, store *Store) error {
	if err := validateDocument(data); err != nil {
		return err
	}
	if !filepath.IsAbs(path) {
		return errors.New("저장할 파일의 전체 경로가 필요합니다")
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	index, err := l.index()
	if err != nil {
		return err
	}
	old, readErr := readLimited(path)
	if readErr != nil && !errors.Is(readErr, os.ErrNotExist) {
		return readErr
	}
	if expected, ok := l.observed[pathKey(path)]; ok && (readErr != nil || digest(old) != expected) {
		return errors.New("파일이 다른 프로그램에서 변경되었거나 이동되었습니다. 다른 이름으로 저장하여 두 작업을 보존하세요")
	}
	if readErr == nil && digest(old) != digest(data) {
		if err := validateDocument(old); err != nil {
			return errors.New("대상 파일이 올바른 문서가 아닙니다. 다른 이름으로 저장하세요")
		}
		if _, err = l.addVersion(&index, path, old); err != nil {
			return fmt.Errorf("이전 버전을 보관하지 못했습니다: %w", err)
		}
		if err = l.persist(index); err != nil {
			return err
		}
	}
	// Check again immediately before writing, including previously unknown destinations.
	current, currentErr := readLimited(path)
	if (readErr == nil) != (currentErr == nil) || (readErr == nil && digest(current) != digest(old)) {
		return errors.New("저장 도중 대상 파일이 변경되었습니다. 다시 열거나 다른 이름으로 저장하세요")
	}
	if err = store.Save(path, data); err != nil {
		return err
	}
	l.observed[pathKey(path)] = digest(data)
	remember(&index, path, data)
	if err = l.retain(&index); err != nil {
		return fmt.Errorf("파일은 저장했지만 문서 목록 갱신에 실패했습니다: %w", err)
	}
	return nil
}
func (l *DocumentLibrary) Recent() ([]RecentDocument, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	index, err := l.index()
	if index.Recent == nil {
		index.Recent = []RecentDocument{}
	}
	return index.Recent, err
}
func (l *DocumentLibrary) Versions(path string) ([]DocumentVersion, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	index, err := l.index()
	result := []DocumentVersion{}
	for _, entry := range append(index.Recoveries, index.Versions...) {
		if pathKey(entry.Path) == pathKey(path) {
			result = append(result, entry)
		}
	}
	return result, err
}
func (l *DocumentLibrary) ReadVersion(id string) (*OpenResult, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	index, err := l.index()
	if err != nil {
		return nil, err
	}
	for _, entry := range append(index.Recoveries, index.Versions...) {
		if entry.ID != id {
			continue
		}
		target, err := l.versionPath(id)
		if err != nil {
			return nil, err
		}
		data, err := readLimited(target)
		if err != nil {
			return nil, err
		}
		if err = validateDocument(data); err != nil {
			return nil, err
		}
		return &OpenResult{Path: "", Data: string(data)}, nil
	}
	return nil, errors.New("보관된 버전을 찾을 수 없습니다")
}

func (a *App) ListRecentDocuments() ([]RecentDocument, error) { return a.documents.Recent() }
func (a *App) ListDocumentVersions(path string) ([]DocumentVersion, error) {
	return a.documents.Versions(path)
}
func (a *App) ReadDocumentVersion(id string) (*OpenResult, error) { return a.documents.ReadVersion(id) }
func (a *App) SaveSnapshot(data string) (DocumentVersion, error) {
	return a.documents.Snapshot("", []byte(data))
}
func (a *App) OpenRecentDocument(path string) (*OpenResult, error) {
	recent, err := a.documents.Recent()
	if err != nil {
		return nil, err
	}
	found := false
	for _, entry := range recent {
		if pathKey(entry.Path) == pathKey(path) {
			found = true
			break
		}
	}
	if !found {
		return nil, errors.New("최근 문서 목록에 없는 파일입니다")
	}
	data, err := a.store.Open(path)
	if err != nil {
		return nil, err
	}
	if err = a.documents.Remember(path, data); err != nil {
		return nil, err
	}
	return &OpenResult{Path: path, Data: string(data)}, nil
}
func (a *App) SetActiveDocumentPath(path string) error {
	if path == "" {
		a.currentPath.Store("")
		return nil
	}
	recent, err := a.documents.Recent()
	if err != nil {
		return err
	}
	for _, entry := range recent {
		if pathKey(entry.Path) == pathKey(path) {
			a.currentPath.Store(entry.Path)
			return nil
		}
	}
	return errors.New("최근 문서 목록에서 확인되지 않은 파일입니다")
}

// The frontend's serialized save queue can pass the path captured with this
// revision so a document switch cannot relabel an in-flight autosave.
func (a *App) AutosaveForDocument(data string, path string) error {
	if err := a.store.Autosave([]byte(data)); err != nil {
		return err
	}
	if path == "" {
		return nil
	}
	recent, err := a.documents.Recent()
	if err != nil {
		return err
	}
	for _, entry := range recent {
		if pathKey(entry.Path) == pathKey(path) {
			return a.documents.RecoverForPath(entry.Path, []byte(data))
		}
	}
	return errors.New("자동 복구 대상 파일을 확인할 수 없습니다")
}
