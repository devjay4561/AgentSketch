//go:build windows

package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"image"
	"image/png"
	"os"
	"strings"
	"testing"
)

func ocrFixture(t *testing.T) string {
	t.Helper()
	var b bytes.Buffer
	if err := png.Encode(&b, image.NewRGBA(image.Rect(0, 0, 20, 20))); err != nil {
		t.Fatal(err)
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(b.Bytes())
}
func TestOCRRejectsUnsafeInputsBeforeRunning(t *testing.T) {
	for _, data := range []string{"https://example.com/image.png", "data:image/svg+xml;base64,PHN2Zy8+", "data:image/png;base64,YmFk"} {
		_, err := extractOCR(data, func(context.Context, string) ([]byte, error) { t.Fatal("invalid image reached OCR"); return nil, nil })
		if err == nil {
			t.Fatal("accepted invalid image")
		}
	}
}
func TestOCRTemporaryImageAndUnicodeResult(t *testing.T) {
	var temp string
	text, err := extractOCR(ocrFixture(t), func(ctx context.Context, file string) ([]byte, error) {
		temp = file
		if _, err := os.ReadFile(file); err != nil {
			t.Fatal(err)
		}
		if _, ok := ctx.Deadline(); !ok {
			t.Fatal("missing timeout")
		}
		return []byte(base64.StdEncoding.EncodeToString([]byte("월간보고\n자료 확인"))), nil
	})
	if err != nil || text != "월간보고\n자료 확인" {
		t.Fatalf("text=%q err=%v", text, err)
	}
	if _, err := os.Stat(temp); !os.IsNotExist(err) {
		t.Fatal("temporary OCR image survived")
	}
}
func TestOCROutputLimit(t *testing.T) {
	_, err := extractOCR(ocrFixture(t), func(context.Context, string) ([]byte, error) {
		return []byte(base64.StdEncoding.EncodeToString([]byte(strings.Repeat("가", ocrMaxText+1)))), nil
	})
	if err == nil {
		t.Fatal("accepted excessive text")
	}
}
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
