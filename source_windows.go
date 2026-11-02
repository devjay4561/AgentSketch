//go:build windows

package main

import (
	"fmt"
	"syscall"
	"unsafe"
)

var sourceShellExecute = syscall.NewLazyDLL("shell32.dll").NewProc("ShellExecuteW")

func openSourceTarget(target string) error {
	operation, _ := syscall.UTF16PtrFromString("open")
	filename, err := syscall.UTF16PtrFromString(target)
	if err != nil {
		return err
	}
	result, _, _ := sourceShellExecute.Call(0, uintptr(unsafe.Pointer(operation)), uintptr(unsafe.Pointer(filename)), 0, 0, 1)
	if result <= 32 {
		return fmt.Errorf("기본 앱으로 자료를 열 수 없습니다 (Windows 코드 %d)", result)
	}
	return nil
}
