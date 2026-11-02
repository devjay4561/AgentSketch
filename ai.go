package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

var assistantRequests sync.Map
var assistantSlot = make(chan struct{}, 1)

func assistantURL(value string) (*url.URL, error) {
	u, err := url.Parse(strings.TrimSpace(value))
	if err != nil || u.Hostname() == "" || u.User != nil || u.Fragment != "" {
		return nil, errors.New("API 주소가 올바르지 않습니다")
	}
	local := u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1" || u.Hostname() == "::1"
	if u.Scheme != "https" && !(u.Scheme == "http" && local) {
		return nil, errors.New("HTTPS 또는 이 PC의 HTTP 주소를 입력하세요")
	}
	return u, nil
}

func requestAssistantHTTP(ctx context.Context, endpoint, key, payload string) (string, error) {
	u, err := assistantURL(endpoint)
	if err != nil {
		return "", err
	}
	if len(payload) > 250000 || len(key) > 4096 {
		return "", errors.New("요청 크기가 허용 범위를 넘었습니다")
	}
	var body struct {
		Model    string            `json:"model"`
		Messages []json.RawMessage `json:"messages"`
		Stream   bool              `json:"stream"`
	}
	if json.Unmarshal([]byte(payload), &body) != nil || body.Model == "" || len(body.Messages) == 0 || body.Stream {
		return "", errors.New("모델과 요청 내용을 확인하세요")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u.String(), strings.NewReader(payload))
	if err != nil {
		return "", errors.New("API 요청을 만들지 못했습니다")
	}
	req.Header.Set("Content-Type", "application/json")
	if strings.TrimSpace(key) != "" {
		req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(key))
	}
	client := &http.Client{Timeout: 75 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return "", errors.New("API 요청이 취소되었거나 대기 시간이 지났습니다")
		}
		return "", errors.New("API에 연결하지 못했습니다. 주소와 네트워크를 확인하세요")
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return "", fmt.Errorf("API 요청 실패 (%d). 주소·모델·키와 서비스 권한을 확인하세요", res.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(res.Body, 2000001))
	if err != nil || len(raw) > 2000000 {
		return "", errors.New("API 응답을 읽을 수 없거나 크기가 너무 큽니다")
	}
	var result struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if json.Unmarshal(raw, &result) != nil || len(result.Choices) == 0 || strings.TrimSpace(result.Choices[0].Message.Content) == "" {
		return "", errors.New("Chat Completions 형식의 텍스트 응답이 없습니다")
	}
	content := result.Choices[0].Message.Content
	if len([]rune(content)) > 100000 {
		return "", errors.New("API 응답 텍스트가 너무 큽니다")
	}
	return content, nil
}

// Called only after the UI displays the exact payload and the user explicitly sends it.
// Credentials are never written to disk; redirects and ambient cookies are not used.
func (a *App) RequestAssistant(requestID, endpoint, key, payload string) (string, error) {
	if len(requestID) < 1 || len(requestID) > 80 {
		return "", errors.New("요청 식별자가 올바르지 않습니다")
	}
	select {
	case assistantSlot <- struct{}{}:
		defer func() { <-assistantSlot }()
	default:
		return "", errors.New("진행 중인 AI 요청을 먼저 마치거나 취소하세요")
	}
	parent := a.ctx
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithTimeout(parent, 75*time.Second)
	defer cancel()
	assistantRequests.Store(requestID, cancel)
	defer assistantRequests.Delete(requestID)
	return requestAssistantHTTP(ctx, endpoint, key, payload)
}
func (a *App) CancelAssistant(requestID string) {
	if value, ok := assistantRequests.Load(requestID); ok {
		value.(context.CancelFunc)()
	}
}
