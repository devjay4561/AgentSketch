package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const sharedFixture = `{"format":"agentsketch","version":1,"title":"shared","nodes":[],"edges":[],"assets":{},"viewport":{"x":0,"y":0,"zoom":1}}`

func TestShareRoundTripAndConflicts(t *testing.T) {
	app := &App{}
	info, err := app.StartShare(sharedFixture, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer app.StopShare()
	if !strings.HasPrefix(info.URL, "http://127.0.0.1:") || info.LAN || len(info.Token) != 64 {
		t.Fatalf("unsafe defaults: %+v", info)
	}
	latest, err := app.PollShare(info.URL, info.Token, 0)
	if err != nil || latest.Document != sharedFixture || latest.Version != 1 {
		t.Fatalf("initial state: %+v %v", latest, err)
	}
	unchanged, err := app.PollShare(info.URL, info.Token, 1)
	if err != nil || unchanged.Document != "" {
		t.Fatal("unchanged polling sent document", err)
	}
	revised := strings.Replace(sharedFixture, "shared", "revised", 1)
	pushed, err := app.PushShare(info.URL, info.Token, 1, revised)
	if err != nil || pushed.Version != 2 {
		t.Fatal("push failed", err)
	}
	if _, err = app.PushShare(info.URL, info.Token, 1, sharedFixture); err == nil {
		t.Fatal("stale write overwrote remote change")
	}
	latest, err = app.PollShare(info.URL, info.Token, 1)
	if err != nil || latest.Document != revised {
		t.Fatal("conflict did not preserve server state")
	}
	if _, err = app.PollShare(info.URL, strings.Repeat("x", 64), 0); err == nil {
		t.Fatal("wrong token accepted")
	}
	if _, err = app.StartShare(sharedFixture, 0); err == nil {
		t.Fatal("duplicate room accepted")
	}
	if err = app.StopShare(); err != nil {
		t.Fatal(err)
	}
	if _, err = app.PollShare(info.URL, info.Token, 0); err == nil {
		t.Fatal("server still responds after stop")
	}
}
func TestShareInputBoundaries(t *testing.T) {
	for _, address := range []string{"file:///C:/test", "http://example.com", "http://127.0.0.1/x", "http://u:p@127.0.0.1", "http://127.0.0.1?token=hi"} {
		if _, err := shareEndpoint(address); err == nil {
			t.Fatalf("accepted %s", address)
		}
	}
	for _, address := range []string{"http://localhost:1234", "http://192.168.0.4:1234", "https://example.com"} {
		if _, err := shareEndpoint(address); err != nil {
			t.Fatalf("rejected %s", address)
		}
	}
	if validSharedDocument(strings.Repeat("x", shareLimit+1)) == nil {
		t.Fatal("oversized document accepted")
	}
	if validSharedDocument(`{"format":"unknown"}`) == nil {
		t.Fatal("wrong format accepted")
	}
}
func TestShareHTTPAuthenticationAndMethods(t *testing.T) {
	room := &shareRoom{document: sharedFixture, version: 1, token: strings.Repeat("a", 64)}
	for _, tc := range []struct {
		method, path, token, body string
		code                      int
	}{
		{"GET", "/v1/state", "", "", 401}, {"GET", "/files", room.token, "", 404}, {"DELETE", "/v1/state", room.token, "", 405},
		{"PUT", "/v1/state", room.token, `{"version":1,"document":"bad"}`, 400},
		{"PUT", "/v1/state", room.token, `{"version":1,"document":"bad","extra":true}`, 400},
	} {
		req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
		req.Header.Set("Authorization", "Bearer "+tc.token)
		w := httptest.NewRecorder()
		room.ServeHTTP(w, req)
		if w.Code != tc.code {
			t.Fatalf("%s %s got %d", tc.method, tc.path, w.Code)
		}
	}
	req := httptest.NewRequest("GET", "/v1/state?since=1", nil)
	req.Header.Set("Authorization", "Bearer "+room.token)
	w := httptest.NewRecorder()
	room.ServeHTTP(w, req)
	var state ShareState
	if err := json.Unmarshal(w.Body.Bytes(), &state); err != nil || state.Document != "" || state.Version != 1 {
		t.Fatal("compact polling response", err)
	}
}
func TestShareDoesNotForwardTokenToRedirect(t *testing.T) {
	reached := false
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { reached = true; _, _ = io.WriteString(w, "{}") }))
	defer target.Close()
	redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, target.URL, http.StatusFound) }))
	defer redirect.Close()
	if _, err := shareRequest("GET", redirect.URL, strings.Repeat("s", 64), 0, ""); err == nil {
		t.Fatal("redirect was accepted")
	}
	if reached {
		t.Fatal("token could be forwarded to redirect target")
	}
}
