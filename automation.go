package main

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type AutomationInfo struct {
	URL      string `json:"url"`
	Token    string `json:"token"`
	PID      int    `json:"pid"`
	Protocol int    `json:"protocol"`
}
type automationBridge struct {
	mu         sync.Mutex
	server     *http.Server
	info       AutomationInfo
	descriptor string
	pending    map[string]chan string
	busy       chan struct{}
	emit       func(string, string)
}

var automationMu sync.Mutex
var automationCurrent *automationBridge
var openDocumentsMu sync.Mutex
var openDocumentsLast string

func (a *App) RecordOpenDocuments(paths []string) error {
	if len(paths) > 6 {
		return errors.New("문서 탭 한도 초과")
	}
	for _, path := range paths {
		if !filepath.IsAbs(path) {
			return errors.New("절대 문서 경로 필요")
		}
	}
	bytes, _ := json.Marshal(struct {
		PID   int      `json:"pid"`
		Paths []string `json:"paths"`
	}{os.Getpid(), paths})
	openDocumentsMu.Lock()
	defer openDocumentsMu.Unlock()
	if string(bytes) == openDocumentsLast {
		return nil
	}
	dir, err := os.UserConfigDir()
	if err != nil {
		return err
	}
	dir = filepath.Join(dir, "AgentSketch")
	if err = os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	if err = atomicWrite(filepath.Join(dir, "open-documents.json"), bytes); err == nil {
		openDocumentsLast = string(bytes)
	}
	return err
}

func automationRequested(args []string) bool {
	for _, a := range args {
		if a == "--automation" {
			return true
		}
	}
	return false
}
func randomAutomationToken() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}
func (a *App) EnableAutomation() (*AutomationInfo, error) {
	automationMu.Lock()
	defer automationMu.Unlock()
	if automationCurrent != nil {
		return &automationCurrent.info, nil
	}
	if !a.ready.Load() {
		return nil, errors.New("앱 초기화가 끝나지 않았습니다")
	}
	dir, err := os.UserConfigDir()
	if err != nil {
		return nil, err
	}
	dir = filepath.Join(dir, "AgentSketch")
	if err = os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	b, err := startAutomation(filepath.Join(dir, "automation.json"), func(id, request string) { runtime.EventsEmit(a.ctx, "agentsketch:automation", id, request) })
	if err != nil {
		return nil, err
	}
	automationCurrent = b
	runtime.EventsEmit(a.ctx, "agentsketch:automation-state", true)
	return &b.info, nil
}
func startAutomation(descriptor string, emit func(string, string)) (*automationBridge, error) {
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	b := &automationBridge{info: AutomationInfo{URL: "http://" + listener.Addr().String(), Token: randomAutomationToken(), PID: os.Getpid(), Protocol: 1}, descriptor: descriptor, pending: map[string]chan string{}, busy: make(chan struct{}, 1), emit: emit}
	b.server = &http.Server{Handler: http.HandlerFunc(b.handle), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 100 * time.Second, IdleTimeout: 10 * time.Second, MaxHeaderBytes: 8192}
	bytes, _ := json.Marshal(b.info)
	if err = os.WriteFile(descriptor, bytes, 0600); err != nil {
		listener.Close()
		return nil, err
	}
	go b.server.Serve(listener)
	return b, nil
}
func (b *automationBridge) handle(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	if r.Header.Get("Origin") != "" {
		http.Error(w, "browser origins are not accepted", 403)
		return
	}
	if subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+b.info.Token)) != 1 {
		http.Error(w, "unauthorized", 401)
		return
	}
	if r.Method != "POST" || r.URL.Path != "/execute" {
		http.Error(w, "not found", 404)
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 80*1024*1024))
	if err != nil || !json.Valid(body) {
		http.Error(w, "invalid or oversized JSON", 400)
		return
	}
	var header struct {
		Command  string          `json:"command"`
		Commands json.RawMessage `json:"commands"`
	}
	_ = json.Unmarshal(body, &header)
	if header.Command != "assistant.cancel" || len(header.Commands) != 0 {
		select {
		case b.busy <- struct{}{}:
			defer func() { <-b.busy }()
		default:
			http.Error(w, "another automation operation is running", 409)
			return
		}
	}
	id := randomAutomationToken()
	reply := make(chan string, 1)
	b.mu.Lock()
	b.pending[id] = reply
	b.mu.Unlock()
	defer func() { b.mu.Lock(); delete(b.pending, id); b.mu.Unlock() }()
	b.emit(id, string(body))
	timer := time.NewTimer(90 * time.Second)
	defer timer.Stop()
	select {
	case response := <-reply:
		if response == "" {
			http.Error(w, "automation stopped", 503)
			return
		}
		io.WriteString(w, response)
	case <-timer.C:
		http.Error(w, "request timed out; inspect before retrying a change", 504)
	case <-r.Context().Done():
	}
}
func (a *App) AutomationReply(id, response string) error {
	automationMu.Lock()
	b := automationCurrent
	automationMu.Unlock()
	if b == nil {
		return errors.New("AI 제어가 꺼져 있습니다")
	}
	if len(response) > 100*1024*1024 || !json.Valid([]byte(response)) {
		return errors.New("응답 크기 또는 형식 오류")
	}
	b.mu.Lock()
	reply := b.pending[id]
	b.mu.Unlock()
	if reply != nil {
		select {
		case reply <- response:
		default:
		}
	}
	return nil
}
func (a *App) AutomationStatus() *AutomationInfo {
	automationMu.Lock()
	defer automationMu.Unlock()
	if automationCurrent == nil {
		return nil
	}
	copy := automationCurrent.info
	copy.Token = ""
	return &copy
}
func (a *App) DisableAutomation() error {
	automationMu.Lock()
	b := automationCurrent
	automationCurrent = nil
	automationMu.Unlock()
	if b != nil {
		b.close()
	}
	if a.ctx != nil {
		runtime.EventsEmit(a.ctx, "agentsketch:automation-state", false)
	}
	return nil
}
func (b *automationBridge) close() {
	b.mu.Lock()
	for _, ch := range b.pending {
		select {
		case ch <- "":
		default:
		}
	}
	b.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_ = b.server.Shutdown(ctx)
	bytes, err := os.ReadFile(b.descriptor)
	if err == nil && strings.Contains(string(bytes), b.info.Token) {
		_ = os.Remove(b.descriptor)
	}
}
