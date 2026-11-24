//go:build darwin && !cgo

package main

import (
	"context"
	"errors"
	"fmt"
	"os"
)

const platformOCRAvailable = false

func runPlatformOCR(context.Context, string) ([]byte, error) {
	return nil, errors.New("이 빌드는 cgo가 꺼져 있어 macOS 글자 읽기를 사용할 수 없습니다")
}

func runPlatformOCRWorker(args []string) {
	if len(args) > 0 && args[0] == "--agentsketch-ocr-worker" {
		fmt.Fprintln(os.Stderr, "This AgentSketch build has OCR disabled because cgo is unavailable")
		os.Exit(1)
	}
}
