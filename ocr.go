package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"image"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"
)

const ocrMaxBytes = 12 << 20
const ocrMaxText = 50_000

var ocrBusy = make(chan struct{}, 1)

type ocrRunner func(context.Context, string) ([]byte, error)

// OCR is an explicit local operation; each native implementation lives behind a platform build tag.
func (a *App) ExtractImageText(data string) (string, error) {
	select {
	case ocrBusy <- struct{}{}:
		defer func() { <-ocrBusy }()
	default:
		return "", errors.New("이미 글자를 인식하고 있습니다. 완료 후 다시 시도하세요")
	}
	return extractOCR(data, runPlatformOCR)
}

func (a *App) OCRAvailable() bool { return platformOCRAvailable }

func extractOCR(data string, run ocrRunner) (string, error) {
	if len(data) > ocrMaxBytes*4/3+100 {
		return "", errors.New("글자 인식 이미지는 12MB 이하여야 합니다")
	}
	raw, mime, err := decodeRasterURL(data, false)
	if err != nil {
		return "", errors.New("글자 인식은 PNG 또는 JPG 이미지에서 사용할 수 있습니다")
	}
	if err = validateOCRRaster(raw); err != nil {
		return "", err
	}
	format := strings.TrimPrefix(mime, "image/")
	dir, err := os.MkdirTemp("", "AgentSketch-OCR-")
	if err != nil {
		return "", errors.New("글자 인식을 위한 임시 저장 공간을 만들 수 없습니다")
	}
	defer os.RemoveAll(dir)
	ext := format
	if format == "jpeg" {
		ext = "jpg"
	}
	file := filepath.Join(dir, "image."+ext)
	if err = os.WriteFile(file, raw, 0600); err != nil {
		return "", errors.New("글자 인식 이미지를 준비할 수 없습니다")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	encoded, err := run(ctx, file)
	if ctx.Err() != nil {
		return "", errors.New("글자 인식 시간이 초과되었습니다. 작은 이미지로 다시 시도하세요")
	}
	if err != nil {
		return "", err
	}
	text, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(encoded)))
	if err != nil || !utf8.Valid(text) {
		return "", errors.New("글자 인식 결과를 읽을 수 없습니다")
	}
	if utf8.RuneCount(text) > ocrMaxText {
		return "", errors.New("인식 결과가 5만 글자를 초과합니다. 이미지를 나누어 인식하세요")
	}
	return strings.TrimSpace(string(text)), nil
}

func validateOCRRaster(raw []byte) error {
	if len(raw) > ocrMaxBytes {
		return errors.New("글자 인식 이미지는 12MB 이하여야 합니다")
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(raw))
	if err != nil || (format != "png" && format != "jpeg") {
		return errors.New("이미지 자료를 읽을 수 없습니다")
	}
	if config.Width < 1 || config.Height < 1 || config.Width > 2600 || config.Height > 2600 || int64(config.Width)*int64(config.Height) > 6_760_000 {
		return errors.New("글자 인식 이미지는 한 변 2600픽셀 이하여야 합니다")
	}
	return nil
}

func validateOCRWorkerFile(file string) error {
	if filepath.Base(filepath.Dir(file)) == "." || !strings.HasPrefix(filepath.Base(filepath.Dir(file)), "AgentSketch-OCR-") {
		return errors.New("OCR worker accepts only private temporary images")
	}
	if filepath.Base(file) != "image.png" && filepath.Base(file) != "image.jpg" {
		return errors.New("OCR worker image name is invalid")
	}
	info, err := os.Lstat(file)
	if err != nil || !info.Mode().IsRegular() {
		return errors.New("OCR worker image is unavailable")
	}
	raw, err := os.ReadFile(file)
	if err != nil {
		return errors.New("OCR worker image is unavailable")
	}
	return validateOCRRaster(raw)
}

type limitedOCRBuffer struct{ bytes.Buffer }

func (b *limitedOCRBuffer) Write(p []byte) (int, error) {
	if b.Len()+len(p) > 1<<20 {
		return 0, errors.New("OCR output exceeds limit")
	}
	return b.Buffer.Write(p)
}
