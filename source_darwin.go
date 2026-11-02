//go:build darwin

package main

import (
	"fmt"
	"os/exec"
)

func openSourceTarget(target string) error {
	if err := exec.Command("/usr/bin/open", target).Run(); err != nil {
		return fmt.Errorf("기본 앱으로 자료를 열 수 없습니다: %w", err)
	}
	return nil
}
