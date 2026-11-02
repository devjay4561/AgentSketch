package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"testing"
)

func TestAutomationLoopbackAuthenticationAndRoundTrip(t *testing.T) {
	var b *automationBridge
	var err error
	received := make(chan string, 1)
	b, err = startAutomation(filepath.Join(t.TempDir(), "automation.json"), func(id, request string) {
		received <- request
		b.mu.Lock()
		reply := b.pending[id]
		b.mu.Unlock()
		reply <- `{"ok":true,"result":{"valid":true}}`
	})
	if err != nil {
		t.Fatal(err)
	}
	defer b.close()
	for _, tc := range []struct {
		token, origin string
		status        int
	}{{"", "", 401}, {b.info.Token, "https://evil.example", 403}, {b.info.Token, "", 200}} {
		req, _ := http.NewRequest("POST", b.info.URL+"/execute", bytes.NewBufferString(`{"command":"session.read"}`))
		req.Header.Set("Authorization", "Bearer "+tc.token)
		if tc.origin != "" {
			req.Header.Set("Origin", tc.origin)
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		data, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if res.StatusCode != tc.status {
			t.Fatal(res.StatusCode, string(data))
		}
		if tc.status == 200 && !json.Valid(data) {
			t.Fatal(string(data))
		}
	}
	if <-received != `{"command":"session.read"}` {
		t.Fatal("request changed")
	}
	b.close()
	if _, err := os.Stat(b.descriptor); !os.IsNotExist(err) {
		t.Fatal("descriptor retained")
	}
}

func TestAutomationBusyAllowsOnlyStandaloneCancellation(t *testing.T) {
	var b *automationBridge
	b, err := startAutomation(filepath.Join(t.TempDir(), "automation.json"), func(id, request string) {
		b.mu.Lock()
		reply := b.pending[id]
		b.mu.Unlock()
		reply <- `{"ok":true}`
	})
	if err != nil {
		t.Fatal(err)
	}
	defer b.close()
	b.busy <- struct{}{}
	for _, tc := range []struct {
		body   string
		status int
	}{
		{`{"command":"session.read"}`, 409},
		{`{"command":"assistant.cancel","commands":[{"command":"node.delete"}]}`, 409},
		{`{"command":"assistant.cancel","args":{"requestId":"test"}}`, 200},
	} {
		req, _ := http.NewRequest("POST", b.info.URL+"/execute", bytes.NewBufferString(tc.body))
		req.Header.Set("Authorization", "Bearer "+b.info.Token)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != tc.status {
			t.Fatal(tc.body, res.StatusCode)
		}
	}
	<-b.busy
}
