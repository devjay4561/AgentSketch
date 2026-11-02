package main

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type SourceInfo struct {
	Source       string `json:"source"`
	Kind         string `json:"kind"`
	Exists       bool   `json:"exists"`
	Size         int64  `json:"size"`
	ModifiedAt   string `json:"modifiedAt"`
	Fingerprint  string `json:"fingerprint"`
	HashComplete bool   `json:"hashComplete"`
	Note         string `json:"note"`
}

func sourceTarget(source string) (string, string, error) {
	source = strings.TrimSpace(source)
	if source == "" || len(source) > 8192 || strings.ContainsAny(source, "\x00\r\n") {
		return "", "", errors.New("자료 경로가 올바르지 않습니다")
	}
	if strings.HasPrefix(strings.ToLower(source), "http://") || strings.HasPrefix(strings.ToLower(source), "https://") {
		parsed, err := url.Parse(source)
		if err != nil || parsed.Hostname() == "" || parsed.User != nil {
			return "", "", errors.New("올바른 HTTP 또는 HTTPS 주소를 입력하세요")
		}
		return parsed.String(), "url", nil
	}
	if !filepath.IsAbs(source) || strings.HasPrefix(source, `\\`) || strings.HasPrefix(source, "//") {
		return "", "", errors.New("이 PC의 전체 파일 경로 또는 HTTP/HTTPS 주소를 입력하세요. 네트워크 공유는 자동 접근하지 않습니다")
	}
	return filepath.Clean(source), "file", nil
}
func inspectSource(source string) (SourceInfo, error) {
	target, kind, err := sourceTarget(source)
	result := SourceInfo{Source: target, Kind: kind}
	if err != nil {
		return result, err
	}
	if kind == "url" {
		result.Note = "웹 주소 형식만 확인했습니다. 연결 가능 여부와 자료 내용은 직접 확인하세요."
		return result, nil
	}
	info, err := os.Stat(target)
	if errors.Is(err, os.ErrNotExist) {
		result.Note = "파일 또는 폴더를 찾을 수 없습니다."
		return result, nil
	}
	if err != nil {
		return result, err
	}
	result.Exists = true
	result.Size = info.Size()
	result.ModifiedAt = info.ModTime().UTC().Format(time.RFC3339Nano)
	if info.IsDir() {
		result.Kind = "directory"
		result.Fingerprint = "directory:" + result.ModifiedAt
		result.Note = "폴더 존재를 확인했습니다. 내부 자료의 최신성·내용은 검증하지 않았습니다."
		return result, nil
	}
	if !info.Mode().IsRegular() {
		return result, errors.New("일반 파일이나 폴더만 확인할 수 있습니다")
	}
	result.Fingerprint = fmt.Sprintf("stat:%d:%d", info.Size(), info.ModTime().UnixNano())
	if info.Size() > 32*1024*1024 {
		result.Note = "32MiB 초과 파일은 크기와 수정 시각만 비교합니다. 내용 검증은 별도입니다."
		return result, nil
	}
	f, err := os.Open(target)
	if err != nil {
		return result, err
	}
	defer f.Close()
	hash := sha256.New()
	written, err := io.Copy(hash, io.LimitReader(f, 32*1024*1024+1))
	if err != nil {
		return result, err
	}
	after, err := f.Stat()
	if err != nil {
		return result, err
	}
	if written != info.Size() || after.Size() != info.Size() || !after.ModTime().Equal(info.ModTime()) {
		return result, errors.New("확인 중 원본이 변경되었습니다. 다시 확인하세요")
	}
	result.HashComplete = true
	result.Fingerprint = "sha256:" + hex.EncodeToString(hash.Sum(nil))
	result.Note = "파일의 지문을 확인했습니다. 업무 내용 검증이나 승인을 의미하지 않습니다."
	return result, nil
}
func (a *App) CheckSource(source string) (SourceInfo, error) { return inspectSource(source) }
func (a *App) OpenSource(source string) error {
	target, kind, err := sourceTarget(source)
	if err != nil {
		return err
	}
	if kind != "url" {
		info, err := os.Stat(target)
		if err != nil {
			return err
		}
		if !info.IsDir() {
			allowed := map[string]bool{".pdf": true, ".txt": true, ".md": true, ".csv": true, ".json": true, ".agentsketch": true, ".flowpaper": true, ".png": true, ".jpg": true, ".jpeg": true, ".webp": true, ".gif": true, ".docx": true, ".xlsx": true, ".pptx": true}
			if !info.Mode().IsRegular() || !allowed[strings.ToLower(filepath.Ext(target))] {
				return errors.New("자료 문서·이미지·폴더만 열 수 있습니다. 실행 파일과 바로가기는 지원하지 않습니다")
			}
		}
	}
	return openSourceTarget(target)
}
