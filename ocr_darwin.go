//go:build darwin && cgo

package main

/*
#cgo LDFLAGS: -framework Foundation -framework Vision
#include <stdlib.h>
char *agentsketch_vision_recognize(const char *path, int *result_code);
*/
import "C"

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"unsafe"
)

const platformOCRAvailable = true

func runPlatformOCR(ctx context.Context, file string) ([]byte, error) {
	return extractOCRFromDarwin(ctx, file)
}

func extractOCRFromDarwin(ctx context.Context, file string) ([]byte, error) {
	executable, err := os.Executable()
	if err != nil {
		return nil, errors.New("AgentSketch OCR worker를 찾을 수 없습니다")
	}
	cmd := exec.CommandContext(ctx, executable, "--agentsketch-ocr-worker", file)
	var stdout, stderr limitedOCRBuffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err = cmd.Run(); err != nil {
		message := strings.TrimSpace(stderr.String())
		if message == "" {
			return nil, fmt.Errorf("Apple Vision 글자 인식을 실행하지 못했습니다: %w", err)
		}
		return nil, errors.New(message)
	}
	return stdout.Bytes(), nil
}

func recognizeVision(file string) (string, error) {
	if err := validateOCRWorkerFile(file); err != nil {
		return "", err
	}
	path := C.CString(file)
	defer C.free(unsafe.Pointer(path))
	var code C.int
	result := C.agentsketch_vision_recognize(path, &code)
	if result == nil {
		return "", errors.New("Apple Vision 응답을 읽지 못했습니다")
	}
	defer C.free(unsafe.Pointer(result))
	switch int(code) {
	case 1:
		return "", errors.New("이 macOS 버전에서 Apple Vision 글자 인식을 사용할 수 없습니다")
	case 2:
		return "", errors.New("Apple Vision에서 사용할 수 있는 한국어 또는 영어 인식 언어가 없습니다")
	case 3:
		return "", errors.New("Apple Vision이 이미지를 읽지 못했습니다. PNG 또는 JPG 파일을 확인하세요")
	}
	return C.GoString(result), nil
}

func runPlatformOCRWorker(args []string) {
	if len(args) == 0 || args[0] != "--agentsketch-ocr-worker" {
		return
	}
	if len(args) != 2 {
		fmt.Fprintln(os.Stderr, "OCR worker arguments are invalid")
		os.Exit(2)
	}
	text, err := recognizeVision(args[1])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if len(text) > 1<<20 {
		fmt.Fprintln(os.Stderr, "OCR output exceeds limit")
		os.Exit(1)
	}
	fmt.Fprint(os.Stdout, base64.StdEncoding.EncodeToString([]byte(text)))
	os.Exit(0)
}
