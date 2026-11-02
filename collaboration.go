package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

const shareLimit = 20 * 1024 * 1024

type ShareState struct {
	Version  uint64 `json:"version"`
	Document string `json:"document,omitempty"`
}
type ShareInfo struct {
	URL       string   `json:"url"`
	Token     string   `json:"token"`
	Version   uint64   `json:"version"`
	LAN       bool     `json:"lan"`
	Addresses []string `json:"addresses"`
}
type shareRoom struct {
	mu       sync.RWMutex
	document string
	version  uint64
	token    string
	server   *http.Server
	listener net.Listener
	lan      bool
}

var shareRooms sync.Map // Only explicit StartShare creates a room; StopShare releases it.
var shareStartMu sync.Mutex

func validSharedDocument(document string) error {
	if len(document) == 0 || len(document) > shareLimit {
		return errors.New("공유 보드는 이미지 포함 20MB 이하여야 합니다")
	}
	return validateDocument([]byte(document))
}
func (r *shareRoom) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if req.URL.Path != "/v1/state" {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	token := strings.TrimPrefix(req.Header.Get("Authorization"), "Bearer ")
	if subtle.ConstantTimeCompare([]byte(token), []byte(r.token)) != 1 {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	switch req.Method {
	case http.MethodGet:
		since, _ := strconv.ParseUint(req.URL.Query().Get("since"), 10, 64)
		r.mu.RLock()
		state := ShareState{Version: r.version}
		if since != r.version {
			state.Document = r.document
		}
		r.mu.RUnlock()
		_ = json.NewEncoder(w).Encode(state)
	case http.MethodPut:
		req.Body = http.MaxBytesReader(w, req.Body, shareLimit*2+4096)
		var incoming ShareState
		decoder := json.NewDecoder(req.Body)
		decoder.DisallowUnknownFields()
		if decoder.Decode(&incoming) != nil {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}
		if decoder.Decode(new(any)) != io.EOF {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}
		if validSharedDocument(incoming.Document) != nil {
			http.Error(w, "invalid document", http.StatusBadRequest)
			return
		}
		r.mu.Lock()
		if incoming.Version != r.version {
			version := r.version
			r.mu.Unlock()
			w.WriteHeader(http.StatusConflict)
			_ = json.NewEncoder(w).Encode(ShareState{Version: version})
			return
		}
		r.document = incoming.Document
		r.version++
		version := r.version
		r.mu.Unlock()
		_ = json.NewEncoder(w).Encode(ShareState{Version: version})
	default:
		w.Header().Set("Allow", "GET, PUT")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}
func (a *App) StartShare(document string, port int) (ShareInfo, error) {
	return a.startShare(document, port, false)
}
func (a *App) StartLANShare(document string, port int, allowLAN bool) (ShareInfo, error) {
	return a.startShare(document, port, allowLAN)
}
func (a *App) startShare(document string, port int, lan bool) (ShareInfo, error) {
	if err := validSharedDocument(document); err != nil {
		return ShareInfo{}, err
	}
	if port < 0 || port > 65535 {
		return ShareInfo{}, errors.New("포트는 0~65535 범위여야 합니다")
	}
	shareStartMu.Lock()
	defer shareStartMu.Unlock()
	if _, exists := shareRooms.Load(a); exists {
		return ShareInfo{}, errors.New("이미 공유 중입니다. 먼저 공유를 종료하세요")
	}
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return ShareInfo{}, err
	}
	host := "127.0.0.1"
	if lan {
		host = "0.0.0.0"
	}
	listener, err := net.Listen("tcp", net.JoinHostPort(host, strconv.Itoa(port)))
	if err != nil {
		return ShareInfo{}, fmt.Errorf("공유 포트를 열 수 없습니다: %w", err)
	}
	room := &shareRoom{document: document, version: 1, token: hex.EncodeToString(secret), listener: listener, lan: lan}
	room.server = &http.Server{Handler: room, ReadHeaderTimeout: 3 * time.Second, ReadTimeout: 20 * time.Second, WriteTimeout: 20 * time.Second, IdleTimeout: 15 * time.Second, MaxHeaderBytes: 8192}
	shareRooms.Store(a, room)
	go func() { _ = room.server.Serve(listener) }()
	port = listener.Addr().(*net.TCPAddr).Port
	local := "http://127.0.0.1:" + strconv.Itoa(port)
	info := ShareInfo{URL: local, Token: room.token, Version: 1, LAN: lan, Addresses: []string{local}}
	if lan {
		if addresses, err := net.InterfaceAddrs(); err == nil {
			for _, address := range addresses {
				if ipnet, ok := address.(*net.IPNet); ok && ipnet.IP.To4() != nil && ipnet.IP.IsPrivate() {
					info.Addresses = append(info.Addresses, "http://"+net.JoinHostPort(ipnet.IP.String(), strconv.Itoa(port)))
				}
			}
		}
	}
	return info, nil
}
func (a *App) StopShare() error {
	value, exists := shareRooms.LoadAndDelete(a)
	if !exists {
		return nil
	}
	room := value.(*shareRoom)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	err := room.server.Shutdown(ctx)
	if err != nil {
		_ = room.server.Close()
	}
	room.mu.Lock()
	room.document = ""

	room.mu.Unlock()
	return err
}
func shareEndpoint(address string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(address))
	if err != nil || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return "", errors.New("공유 주소는 http(s)://호스트:포트 형식이어야 합니다")
	}
	if u.Scheme != "https" {
		ip := net.ParseIP(u.Hostname())
		local := strings.EqualFold(u.Hostname(), "localhost") || ip != nil && (ip.IsLoopback() || ip.IsPrivate())
		if u.Scheme != "http" || !local {
			return "", errors.New("HTTP 연결은 localhost 또는 사설 IP만 허용합니다. 외부 서버는 HTTPS를 사용하세요")
		}
	}
	u.Path = "/v1/state"
	return u.String(), nil
}
func shareRequest(method, address, token string, version uint64, document string) (ShareState, error) {
	if len(token) < 32 || len(token) > 128 {
		return ShareState{}, errors.New("공유 키 형식이 올바르지 않습니다")
	}
	endpoint, err := shareEndpoint(address)
	if err != nil {
		return ShareState{}, err
	}
	var body io.Reader
	if method == http.MethodPut {
		if err := validSharedDocument(document); err != nil {
			return ShareState{}, err
		}
		encoded, err := json.Marshal(ShareState{Version: version, Document: document})
		if err != nil {
			return ShareState{}, err
		}
		body = bytes.NewReader(encoded)
	} else {
		endpoint += "?since=" + strconv.FormatUint(version, 10)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return ShareState{}, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 12 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(req)
	if err != nil {
		return ShareState{}, errors.New("공유 서버에 연결하지 못했습니다. 주소·공유 키·방화벽을 확인하세요")
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusConflict {
		return ShareState{}, errors.New("다른 사용자가 먼저 수정했습니다. 내 작업을 보존한 뒤 최신 보드를 가져오세요")
	}
	if response.StatusCode != http.StatusOK {
		return ShareState{}, fmt.Errorf("공유 요청이 거부되었습니다 (HTTP %d)", response.StatusCode)
	}
	var result ShareState
	decoder := json.NewDecoder(io.LimitReader(response.Body, shareLimit*2+4096))
	if err := decoder.Decode(&result); err != nil {
		return ShareState{}, errors.New("공유 응답이 올바르지 않습니다")
	}
	if result.Document != "" {
		if err := validSharedDocument(result.Document); err != nil {
			return ShareState{}, err
		}
	}
	return result, nil
}
func (a *App) PollShare(address, token string, since uint64) (ShareState, error) {
	return shareRequest(http.MethodGet, address, token, since, "")
}
func (a *App) PushShare(address, token string, version uint64, document string) (ShareState, error) {
	return shareRequest(http.MethodPut, address, token, version, document)
}
