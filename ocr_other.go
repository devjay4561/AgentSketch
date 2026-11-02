//go:build !windows && !darwin

package main

import (
	"context"
	"errors"
)

const platformOCRAvailable = false

func runPlatformOCR(context.Context, string) ([]byte, error) {
	return nil, errors.New("이 운영체제에서는 글자 읽기를 사용할 수 없습니다")
}

func runPlatformOCRWorker([]string) {}
