package main

import (
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strconv"
)

const maxSettingsBytes = 64 * 1024

type GraphicsSettings struct {
	Saved       bool `json:"saved"`
	Active      bool `json:"active"`
	EnvOverride bool `json:"envOverride"`
}

func userSettingsPath() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		return ""
	}
	return filepath.Join(dir, "AgentSketch", "settings.json")
}

func loadGPUSetting(path string) bool {
	file, err := os.Open(path)
	if err != nil {
		return true
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxSettingsBytes+1))
	var settings struct {
		GPU *bool `json:"gpu"`
	}
	if err != nil || len(data) > maxSettingsBytes || json.Unmarshal(data, &settings) != nil || settings.GPU == nil {
		return true
	}
	return *settings.GPU
}

func resolveGraphicsSettings(saved bool, override string) GraphicsSettings {
	settings := GraphicsSettings{Saved: saved, Active: saved}
	if override == "0" || override == "1" {
		settings.Active = override == "1"
		settings.EnvOverride = true
	}
	return settings
}

func saveGPUSetting(path string, enabled bool) error {
	if !filepath.IsAbs(path) {
		return errors.New("저장할 파일의 전체 경로가 필요합니다")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	return atomicWrite(path, []byte("{\"gpu\":"+strconv.FormatBool(enabled)+"}\n"))
}
