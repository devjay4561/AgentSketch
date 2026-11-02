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
