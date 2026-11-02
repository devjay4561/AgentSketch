package main

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

func decodeArtifact(kind, data string) ([]byte, string, error) {
	if len(data) == 0 || len(data) > exportMaxInput {
		return nil, "", errors.New("내보낼 자료가 비어 있거나 80MB를 초과합니다")
	}
	if strings.HasPrefix(kind, "attachment:") {
		return decodeAttachmentArtifact(strings.TrimPrefix(kind, "attachment:"), data)
	}
	switch kind {
	case "csv", "drawio", "html", "agentsketch":
		if !utf8.ValidString(data) {
			return nil, "", errors.New("UTF-8 자료가 아닙니다")
		}
		lower := strings.ToLower(data)
		if kind == "html" && (strings.Contains(lower, "<script") || strings.Contains(lower, "<iframe") || strings.Contains(lower, "<object") || strings.Contains(lower, "javascript:")) {
			return nil, "", errors.New("실행 콘텐츠는 보고서에 포함할 수 없습니다")
		}
		if kind == "drawio" && (strings.Contains(lower, "<!doctype") || strings.Contains(lower, "<!entity")) {
			return nil, "", errors.New("외부 XML 선언은 지원하지 않습니다")
		}
		if kind == "agentsketch" {
			if err := validateDocument([]byte(data)); err != nil {
				return nil, "", err
			}
		}
		return []byte(data), kind, nil
	case "html-viewer":
		// 뷰어는 renderViewerHTML이 넣은 스크립트 한 개만 허용한다. 문서 글자는 이스케이프되어 <script가 될 수 없다.
		lower := strings.ToLower(data)
		if !utf8.ValidString(data) || strings.Count(lower, "<script") != 1 || strings.Contains(lower, "<iframe") || strings.Contains(lower, "<object") || strings.Contains(lower, "javascript:") {
			return nil, "", errors.New("HTML 뷰어 형식이 올바르지 않습니다")
		}
		return []byte(data), "html", nil
	case "pptx", "pdf-vector":
		raw, err := base64.StdEncoding.Strict().DecodeString(data)
		if err != nil {
			return nil, "", errors.New("내보내기 바이너리 형식이 올바르지 않습니다")
		}
		if kind == "pdf-vector" {
			if !bytes.HasPrefix(raw, []byte("%PDF-")) {
				return nil, "", errors.New("PDF 자료가 아닙니다")
			}
			return raw, "pdf", nil
		}
		archive, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
		if err != nil {
			return nil, "", errors.New("PowerPoint 자료가 아닙니다")
		}
		found := false
		for _, entry := range archive.File {
			if entry.Name == "ppt/presentation.xml" {
				found = true
			}
		}
		if !found {
			return nil, "", errors.New("PowerPoint 본문이 없습니다")
		}
		return raw, "pptx", nil
	default:
		return nil, "", errors.New("지원하지 않는 자료 형식입니다")
	}
}

func decodeAttachmentArtifact(extension, data string) ([]byte, string, error) {
	allowed := map[string]bool{"pdf": true, "xlsx": true, "docx": true, "pptx": true, "txt": true, "csv": true, "png": true, "jpg": true, "jpeg": true, "webp": true, "gif": true}
	if !allowed[extension] {
		return nil, "", errors.New("지원하지 않는 첨부 형식입니다")
	}
	raw, err := base64.StdEncoding.Strict().DecodeString(data)
	if err != nil || len(raw) == 0 || len(raw) > 5<<20 {
		return nil, "", errors.New("첨부 파일이 손상되었거나 5MB를 초과합니다")
	}
	if extension == "pdf" && !bytes.HasPrefix(raw, []byte("%PDF-")) {
		return nil, "", errors.New("PDF 첨부 내용이 올바르지 않습니다")
	}
	if extension == "docx" || extension == "xlsx" || extension == "pptx" {
		archive, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
		if err != nil {
			return nil, "", errors.New("Office 첨부 내용이 올바르지 않습니다")
		}
		expected := map[string]string{"docx": "word/document.xml", "xlsx": "xl/workbook.xml", "pptx": "ppt/presentation.xml"}[extension]
		found := false
		for _, entry := range archive.File {
			if entry.Name == expected {
				found = true
			}
		}
		if !found {
			return nil, "", errors.New("Office 첨부 본문이 없습니다")
		}
	}
	mime := map[string]string{"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp", "gif": "image/gif"}[extension]
	if mime != "" {
		if _, _, err := decodeRasterURL("data:"+mime+";base64,"+data, true); err != nil {
			return nil, "", err
		}
	}
	return raw, extension, nil
}

// SaveArtifact writes locally generated reports/interchange files after a native save dialog.
func (a *App) SaveArtifact(name, kind, data string) (string, error) {
	raw, extension, err := decodeArtifact(kind, data)
	if err != nil {
		return "", err
	}
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{Title: "자료 내보내기", DefaultFilename: filenameWithExtension(name, "."+extension), Filters: []runtime.FileFilter{{DisplayName: strings.ToUpper(extension) + " 파일", Pattern: "*." + extension}}})
	if err != nil || path == "" {
		return "", err
	}
	if filepath.Ext(path) == "" {
		path += "." + extension
	}
	if err = atomicWrite(path, raw); err != nil {
		return "", fmt.Errorf("자료 저장 실패: %w", err)
	}
	return path, nil
}
