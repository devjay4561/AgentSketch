//go:build windows

package main

import (
	"context"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"unicode/utf16"
)

const platformOCRAvailable = true

func runPlatformOCR(ctx context.Context, file string) ([]byte, error) {
	return runWindowsOCR(ctx, file)
}

func runPlatformOCRWorker([]string) {}

func runWindowsOCR(ctx context.Context, file string) ([]byte, error) {
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
