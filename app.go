package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type OpenResult struct {
	Path string `json:"path"`
	Data string `json:"data"`
}

type App struct {
	ctx         context.Context
	store       *Store
	documents   *DocumentLibrary
	currentPath atomic.Value
	ready       atomic.Bool
	allowClose  atomic.Bool
	launchMu    sync.Mutex
	launchPath  string
}

func NewApp() *App {
	recovery := ""
	if dir, err := os.UserConfigDir(); err == nil {
		recovery = filepath.Join(dir, "AgentSketch", "recovery.agentsketch")
	}
	library := ""
	if recovery != "" {
		library = filepath.Join(filepath.Dir(recovery), "library")
	}
	workingDirectory, _ := os.Getwd()
	return &App{store: NewStore(recovery), documents: NewDocumentLibrary(library), launchPath: launchDocumentPath(os.Args[1:], workingDirectory)}
}

func (a *App) startup(ctx context.Context) { a.ctx = ctx }

func (a *App) secondInstance(data options.SecondInstanceData) {
	if automationRequested(data.Args) {
		_, _ = a.EnableAutomation()
	}
	path := launchDocumentPath(data.Args, data.WorkingDirectory)
	if path != "" {
		a.launchMu.Lock()
		a.launchPath = path
		a.launchMu.Unlock()
	}
	if a.ctx != nil {
		runtime.WindowUnminimise(a.ctx)
		runtime.WindowShow(a.ctx)
		if path != "" {
			runtime.EventsEmit(a.ctx, "agentsketch:open-file")
		}
	}
}

func (a *App) beforeClose(ctx context.Context) bool {
	if a.allowClose.Load() || !a.ready.Load() {
		return false
	}
	runtime.EventsEmit(ctx, "agentsketch:closing")
	return true
}

// Ready is called after the frontend has installed the closing event listener.
func (a *App) Ready() {
	a.ready.Store(true)
	if automationRequested(os.Args[1:]) {
		_, _ = a.EnableAutomation()
	}
	a.launchMu.Lock()
	pending := a.launchPath != ""
	a.launchMu.Unlock()
	if pending && a.ctx != nil {
		runtime.EventsEmit(a.ctx, "agentsketch:open-file")
	}
}

// CloseWithRecovery saves the very latest state, including a pending text edit,
// before allowing the native close. Any error leaves the window open.
func (a *App) CloseWithRecovery(data string) error {
	if err := a.Autosave(data); err != nil {
		return fmt.Errorf("자동 복구 저장에 실패했습니다. 문서를 파일로 저장한 뒤 다시 닫아 주세요: %w", err)
	}
	a.allowClose.Store(true)
	runtime.Quit(a.ctx)
	return nil
}

func (a *App) CloseWithRecoveryForDocument(data string, path string) error {
	if err := a.AutosaveForDocument(data, path); err != nil {
		return fmt.Errorf("자동 복구 저장에 실패했습니다. 문서를 파일로 저장한 뒤 다시 닫아 주세요: %w", err)
	}
	a.allowClose.Store(true)
	runtime.Quit(a.ctx)
	return nil
}

func (a *App) OpenDocument() (*OpenResult, error) {
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title:   "AgentSketch 문서 열기",
		Filters: []runtime.FileFilter{{DisplayName: "AgentSketch 문서", Pattern: "*.agentsketch;*.flowpaper;*.json"}},
	})
	if err != nil {
		return nil, err
	}
	if path == "" {
		return nil, nil
	}
	data, err := a.store.Open(path)
	if err != nil {
		return nil, fmt.Errorf("문서를 열 수 없습니다: %w", err)
	}
	if err = a.documents.Remember(path, data); err != nil {
		return nil, err
	}
	return &OpenResult{Path: path, Data: string(data)}, nil
}

func documentName(data string) string {
	var v struct {
		Title string `json:"title"`
	}
	_ = json.Unmarshal([]byte(data), &v)
	return safeFilename(v.Title)
}

func safeFilename(name string) string {
	name = strings.Map(func(r rune) rune {
		if r < 32 || strings.ContainsRune("<>:\"/\\|?*", r) {
			return '_'
		}
		return r
	}, name)
	name = strings.Trim(name, " .")
	r := []rune(name)
	if len(r) > 100 {
		name = string(r[:100])
	}
	if name == "" {
		return "새 흐름"
	}
	stem := strings.ToUpper(strings.Split(name, ".")[0])
	if stem == "CON" || stem == "PRN" || stem == "AUX" || stem == "NUL" || (len(stem) == 4 && (strings.HasPrefix(stem, "COM") || strings.HasPrefix(stem, "LPT")) && stem[3] >= '1' && stem[3] <= '9') {
		name = "문서_" + name
	}
	return name
}

func filenameWithExtension(name, extension string) string {
	name = safeFilename(name)
	if strings.EqualFold(filepath.Ext(name), extension) {
		return name
	}
	return name + extension
}

func (a *App) SaveDocument(data string, path string, saveAs bool) (string, error) {
	if err := validateDocument([]byte(data)); err != nil {
		return "", err
	}
	if path == "" || saveAs {
		var err error
		path, err = runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
			Title: "AgentSketch 문서 저장", DefaultFilename: filenameWithExtension(documentName(data), ".agentsketch"),
			Filters: []runtime.FileFilter{{DisplayName: "AgentSketch 문서", Pattern: "*.agentsketch"}},
		})
		if err != nil {
			return "", err
		}
		if path == "" {
			return "", nil
		}
		if filepath.Ext(path) == "" {
			path += ".agentsketch"
		}
	}
	if err := a.documents.Save(path, []byte(data), a.store); err != nil {
		return "", fmt.Errorf("문서를 저장할 수 없습니다: %w", err)
	}
	a.currentPath.Store(path)
	return path, nil
}

func (a *App) Autosave(data string) error {
	if err := a.store.Autosave([]byte(data)); err != nil {
		return err
	}
	if path, ok := a.currentPath.Load().(string); ok && path != "" {
		return a.documents.RecoverForPath(path, []byte(data))
	}
	return nil
}

func (a *App) LoadAutosave() (string, error) {
	data, err := a.store.LoadAutosave()
	if err != nil {
		return "", fmt.Errorf("이전 작업을 복구할 수 없습니다: %w", err)
	}
	return string(data), nil
}

func (a *App) ExportFile(name string, kind string, data string) (string, error) {
	kind = strings.ToLower(kind)
	if kind == "jpeg" {
		kind = "jpg"
	}
	if kind != "png" && kind != "jpg" && kind != "svg" && kind != "pdf" {
		return "", errors.New("지원하지 않는 내보내기 형식입니다")
	}
	bytes, err := decodeExport(kind, data)
	if err != nil {
		return "", err
	}
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title: strings.ToUpper(kind) + "로 내보내기", DefaultFilename: filenameWithExtension(name, "."+kind),
		Filters: []runtime.FileFilter{{DisplayName: strings.ToUpper(kind) + " 파일", Pattern: "*." + kind}},
	})
	if err != nil {
		return "", err
	}
	if path == "" {
		return "", nil
	}
	if filepath.Ext(path) == "" {
		path += "." + kind
	}
	if err = atomicWrite(path, bytes); err != nil {
		return "", fmt.Errorf("내보내기 파일을 저장할 수 없습니다: %w", err)
	}
	return path, nil
}
