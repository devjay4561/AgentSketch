//go:build !windows

package main

import "os"

func waitForRestartParent() (bool, error) {
	_, set := os.LookupEnv(restartWaitPID)
	if set {
		_ = os.Unsetenv(restartWaitPID)
	}
	return set, nil
}
