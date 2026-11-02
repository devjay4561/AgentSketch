//go:build windows

package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"image"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unicode/utf16"
	"unicode/utf8"
)

const ocrMaxBytes = 12 << 20
const ocrMaxText = 50_000

var ocrBusy = make(chan struct{}, 1)

// Windows OCR starts only for an explicit request. No resident engine or cloud call.
func (a *App) ExtractImageText(data string) (string, error) {
	select {
	case ocrBusy <- struct{}{}:
		defer func() { <-ocrBusy }()
	default:
		return "", errors.New("이미 글자를 인식하고 있습니다. 완료 후 다시 시도하세요")
	}
	return extractOCR(data, runWindowsOCR)
}

type ocrRunner func(context.Context, string) ([]byte, error)

func extractOCR(data string, run ocrRunner) (string, error) {
	if len(data) > ocrMaxBytes*4/3+100 {
		return "", errors.New("글자 인식 이미지는 12MB 이하여야 합니다")
	}
	raw, _, err := decodeRasterURL(data, false)
	if err != nil {
		return "", errors.New("글자 인식은 PNG 또는 JPG 이미지에서 사용할 수 있습니다")
	}
	if len(raw) > ocrMaxBytes {
		return "", errors.New("글자 인식 이미지는 12MB 이하여야 합니다")
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(raw))
	if err != nil || (format != "png" && format != "jpeg") {
		return "", errors.New("이미지 자료를 읽을 수 없습니다")
	}
	if config.Width < 1 || config.Height < 1 || config.Width > 2600 || config.Height > 2600 || int64(config.Width)*int64(config.Height) > 6_760_000 {
		return "", errors.New("글자 인식 이미지는 한 변 2600픽셀 이하여야 합니다")
	}
	dir, err := os.MkdirTemp("", "AgentSketch-OCR-")
	if err != nil {
		return "", errors.New("글자 인식을 위한 임시 저장 공간을 만들 수 없습니다")
	}
	defer os.RemoveAll(dir)
	file := filepath.Join(dir, "image."+format)
	if err = os.WriteFile(file, raw, 0600); err != nil {
		return "", errors.New("글자 인식 이미지를 준비할 수 없습니다")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	encoded, err := run(ctx, file)
	if ctx.Err() != nil {
		return "", errors.New("글자 인식 시간이 초과되었습니다. 작은 이미지로 다시 시도하세요")
	}
	if err != nil {
		return "", err
	}
	text, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(encoded)))
	if err != nil || !utf8.Valid(text) {
		return "", errors.New("글자 인식 결과를 읽을 수 없습니다")
	}
	if utf8.RuneCount(text) > ocrMaxText {
		return "", errors.New("인식 결과가 5만 글자를 초과합니다. 이미지를 나누어 인식하세요")
	}
	return strings.TrimSpace(string(text)), nil
}

type limitedOCRBuffer struct{ bytes.Buffer }

func (b *limitedOCRBuffer) Write(p []byte) (int, error) {
	if b.Len()+len(p) > 1<<20 {
		return 0, errors.New("OCR output exceeds limit")
	}
	return b.Buffer.Write(p)
}

func runWindowsOCR(ctx context.Context, file string) ([]byte, error) {
	// Use the Windows system host, not a PATH-resolved executable or user profile.
	ps := filepath.Join(os.Getenv("SystemRoot"), "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
	units := utf16.Encode([]rune(ocrPowerShell))
	script := make([]byte, len(units)*2)
	for i, u := range units {
		binary.LittleEndian.PutUint16(script[i*2:], u)
	}
	cmd := exec.CommandContext(ctx, ps, "-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", base64.StdEncoding.EncodeToString(script))
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	cmd.Env = append(os.Environ(), "AGENTSKETCH_OCR_FILE="+file)
	var stdout, stderr limitedOCRBuffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		if strings.Contains(stderr.String(), "AGENTSKETCH_OCR_LANGUAGE_MISSING") {
			return nil, errors.New("Windows OCR 언어가 없습니다. Windows 설정에서 필요한 언어의 광학 문자 인식 기능을 설치하세요")
		}
		return nil, fmt.Errorf("Windows 글자 인식을 실행하지 못했습니다. Windows OCR 언어와 이미지 상태를 확인하세요: %w", err)
	}
	return stdout.Bytes(), nil
}

const ocrPowerShell = `
$ErrorActionPreference = 'Stop'
try {
 Add-Type -AssemblyName System.Runtime.WindowsRuntime
 [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime] | Out-Null
 [Windows.Storage.FileAccessMode, Windows.Storage, ContentType=WindowsRuntime] | Out-Null
 [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType=WindowsRuntime] | Out-Null
 [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime] | Out-Null
 [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType=WindowsRuntime] | Out-Null
 [Windows.Graphics.Imaging.BitmapPixelFormat, Windows.Graphics.Imaging, ContentType=WindowsRuntime] | Out-Null
 [Windows.Graphics.Imaging.BitmapAlphaMode, Windows.Graphics.Imaging, ContentType=WindowsRuntime] | Out-Null
 [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime] | Out-Null
 [Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType=WindowsRuntime] | Out-Null
 $awaitMethod = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation' + [char]96 + '1' } | Select-Object -First 1
 function Await-Operation($operation, $resultType) {
  $task = $awaitMethod.MakeGenericMethod($resultType).Invoke($null, @($operation))
  $task.Wait()
  return $task.Result
 }
 $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
 if ($null -eq $engine) { throw 'AGENTSKETCH_OCR_LANGUAGE_MISSING' }
 $file = Await-Operation ([Windows.Storage.StorageFile]::GetFileFromPathAsync($env:AGENTSKETCH_OCR_FILE)) ([Windows.Storage.StorageFile])
 $stream = Await-Operation ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
 try {
  $decoder = Await-Operation ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap = Await-Operation ($decoder.GetSoftwareBitmapAsync([Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8,[Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied)) ([Windows.Graphics.Imaging.SoftwareBitmap])
  try {
   $result = Await-Operation ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
   $text = ($result.Lines | ForEach-Object { $_.Text }) -join [Environment]::NewLine
   [Console]::Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($text)))
  } finally { if ($null -ne $bitmap) { $bitmap.Dispose() } }
 } finally { if ($null -ne $stream) { $stream.Dispose() } }
} catch {
 [Console]::Error.WriteLine($_.Exception.Message)
 exit 1
}
`
