package main

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAssistantEndpointProtection(t *testing.T) {
	for _, v := range []string{"http://example.com/api", "https://user:key@example.com/api", "file:///etc/passwd", "javascript:alert(1)"} {
		if _, e := assistantURL(v); e == nil {
			t.Fatalf("accepted %s", v)
		}
	}
	if _, e := assistantURL("http://127.0.0.1:1234/v1/chat/completions"); e != nil {
		t.Fatal(e)
	}
}
func TestAssistantNativeRequest(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer ephemeral" {
			t.Error("missing auth")
		}
		if r.Header.Get("Cookie") != "" {
			t.Error("unexpected cookie")
		}
		b, _ := io.ReadAll(r.Body)
		if !strings.Contains(string(b), `"model":"test"`) {
			t.Error("wrong payload")
		}
		io.WriteString(w, `{"choices":[{"message":{"content":"검토 결과"}}]}`)
	}))
	defer s.Close()
	got, err := requestAssistantHTTP(context.Background(), s.URL, "ephemeral", `{"model":"test","messages":[{"role":"user","content":"test"}]}`)
	if err != nil || got != "검토 결과" {
		t.Fatalf("%s %v", got, err)
	}
}
func TestAssistantRejectsRedirectAndOversize(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, "https://example.com", 302) }))
	defer s.Close()
	_, err := requestAssistantHTTP(context.Background(), s.URL, "secret", `{"model":"test","messages":[{}]}`)
	if err == nil {
		t.Fatal("redirect accepted")
	}
	_, err = requestAssistantHTTP(context.Background(), s.URL, "", strings.Repeat("x", 250001))
	if err == nil {
		t.Fatal("oversize accepted")
	}
}

func TestEnvironmentKeyOnlyForOpenAI(t *testing.T) {
	env := func(name string) string {
		if name == "OPENAI_API_KEY" {
			return "env-key"
		}
		return ""
	}
	if got := environmentKey("https://api.openai.com/v1/chat/completions", "", env); got != "env-key" {
		t.Fatalf("openai got %q", got)
	}
	for _, endpoint := range []string{"https://example.com/v1/chat/completions", "https://api.openai.com.evil.test/v1", "http://localhost:1/v1"} {
		if got := environmentKey(endpoint, "", env); got != "" {
			t.Fatalf("%s leaked key", endpoint)
		}
	}
	if got := environmentKey("https://api.openai.com/v1/chat/completions", "typed", env); got != "typed" {
		t.Fatalf("typed key replaced: %q", got)
	}
	if s := aiMemoSettings(env); s.Model != defaultAIMemoModel || !s.HasKey {
		t.Fatalf("settings %+v", s)
	}
}
