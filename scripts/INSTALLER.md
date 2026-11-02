# 사용자별 설치 파일 빌드

먼저 앱과 일반 배포 폴더를 완성합니다. 설치 스크립트는 배포 폴더의 실행 파일이 최신 빌드와 같은 SHA256인지 확인합니다.

```powershell
./scripts/build.ps1 -SkipInstall
./scripts/package.ps1
./scripts/installer.ps1 -DownloadCompiler
python scripts/verify-installer.py
```

결과는 `release/AgentSketch-Setup.exe`와 `release/AgentSketch-Setup-안내.txt`입니다. 검증 원본은 `output/installer-build.json`, `output/installer-check.json`, `output/installer-build.log`입니다.

컴파일러는 [NSIS 공식 배포](https://nsis.sourceforge.io/Download)의 3.11 ZIP을 프로젝트 `.tools`에만 풀어 사용합니다. 재현을 위해 SHA256 `C7D27F780DDB6CFFB4730138CD1591E841F4B7EDB155856901CDF5F214394FA1`을 고정했습니다. 시스템에 NSIS가 이미 있으면 그 경로를 사용할 수 있습니다. ZIP 해시가 다르면 내려받은 도구를 실행하지 않습니다.

설치 파일은 `RequestExecutionLevel user` 및 `SetShellVarContext current`를 사용합니다. 설치 위치는 `%LOCALAPPDATA%\Programs\AgentSketch`로 고정하며 HKCU에만 등록합니다. `.agentsketch` 열기 등록은 Windows의 보호된 UserChoice를 변경하지 않습니다. 다른 기본 앱이 이미 선택되어 있으면 사용자가 Windows 설정에서 변경해야 할 수 있습니다.

프로그램 제거는 명시적으로 설치한 파일과 레지스트리 항목만 지웁니다. 폴더의 재귀 삭제를 사용하지 않으며 `%APPDATA%\AgentSketch`와 사용자 문서는 보존합니다. 업데이트 전 실행 파일 보관은 설치 구성에서 선택해야 합니다. 복귀는 이전 실행 파일과 현재 실행 파일만 바꾸며 문서 형식이나 문서 내용을 되돌리지 않습니다.

`verify-installer.py`는 실행 파일을 실행하지 않고 NSIS의 LZMA payload를 해제해 최종 앱의 정확한 바이트, 문서, 복귀 도구, 제거 프로그램, 한글 파일명, 일반 사용자 manifest를 검사합니다. 실제 설치·제거·복귀 및 다른 PC의 WebView2 상태는 이 검사만으로 검증되지 않습니다.

코드 서명 인증서나 자동 업데이트 배포 주소는 포함하지 않습니다. 서명되지 않은 설치 파일의 게시자를 검증된 게시자로 표시하지 않습니다. 설치 파일은 WebView2나 업데이트를 자동 다운로드하지 않습니다.

NSIS 실행 stub과 System 플러그인의 원본 라이선스는 scripts/NSIS-LICENSE.txt에 보존하며 설치 폴더에도 포함합니다. 변경하지 않은 NSIS 3.11 원본 소스는 https://sourceforge.net/projects/nsis/files/NSIS%203/3.11/ 에서 구할 수 있습니다.
