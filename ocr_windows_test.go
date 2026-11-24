//go:build windows

package main

import (
	"encoding/base64"
	"os"
	"strings"
	"testing"
)

func TestOCRWindowsIntegration(t *testing.T) {
	file := os.Getenv("AGENTSKETCH_OCR_TEST_IMAGE")
	if file == "" {
		t.Skip("set AGENTSKETCH_OCR_TEST_IMAGE for installed Windows OCR")
	}
	raw, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	text, err := extractOCR("data:image/png;base64,"+base64.StdEncoding.EncodeToString(raw), runWindowsOCR)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(text, "월간보고") {
		t.Fatalf("Korean OCR result: %q", text)
	}
	t.Log(text)
}
