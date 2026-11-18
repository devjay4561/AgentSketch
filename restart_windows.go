//go:build windows

package main

import (
	"errors"
	"os"
	"strconv"

	win "golang.org/x/sys/windows"
)

// waitForRestartParent blocks a relaunched instance until the previous process
// exits, so the single-instance lock is free.
func waitForRestartParent() (bool, error) {
	value, set := os.LookupEnv(restartWaitPID)
	if !set {
		return false, nil
	}
	if err := os.Unsetenv(restartWaitPID); err != nil {
		return false, err
	}
	pid, err := strconv.ParseUint(value, 10, 32)
	if err != nil || pid == 0 || pid == uint64(os.Getpid()) {
		return false, nil
	}
	parent, err := win.OpenProcess(win.SYNCHRONIZE, false, uint32(pid))
	if errors.Is(err, win.ERROR_INVALID_PARAMETER) {
		return true, nil // The parent already exited.
	}
	if err != nil {
		return false, err
	}
	defer win.CloseHandle(parent)
	event, err := win.WaitForSingleObject(parent, 10_000)
	if err != nil {
		return false, err
	}
	if event != win.WAIT_OBJECT_0 {
		return false, errors.New("timed out waiting for the previous AgentSketch process")
	}
	return true, nil
}
