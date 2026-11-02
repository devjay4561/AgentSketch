//go:build !windows

package main

import "errors"

func openSourceTarget(target string) error {
	return errors.New("자료 열기는 Windows 실행 파일에서 지원합니다")
}
