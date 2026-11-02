# AgentSketch에 기여하기

관심 가져 주셔서 고맙습니다. 버그 제보, 문서 개선, 번역, 기능 PR 모두 환영합니다. (English contributions are welcome too.)

## 시작 전에

- 큰 변경은 먼저 [이슈](https://github.com/devjay4561/AgentSketch/issues)로 방향을 맞춰 주세요.
- 보안 문제는 공개 이슈 대신 [SECURITY.md](SECURITY.md)의 절차를 따릅니다.
- 모든 참여자는 [행동 강령](CODE_OF_CONDUCT.md)을 따릅니다.

## 개발 환경

Go 1.26+, Node.js 24 LTS, npm이 필요합니다. Windows 빌드는 Windows 10/11, Edge와 PowerShell이 필요하고, macOS 빌드는 macOS 12+와 Xcode Command Line Tools가 필요합니다.

```powershell
npm ci
npm run dev -- --port 18440   # 브라우저 개발 모드
./scripts/build.ps1           # 전체 빌드 + 테스트 → build/bin/AgentSketch.exe
```

macOS에서는 다음 명령으로 `.app`을 빌드합니다.

```sh
./scripts/build.sh --arch arm64
./scripts/build.sh --arch universal   # arm64와 Intel 빌드를 모두 지원할 때
./scripts/package-macos.sh            # .app ZIP과 DMG
```

## PR 전에 확인할 것

```powershell
npm run build
npm test
go vet ./...
go test ./...
go test github.com/wailsapp/go-webview2/pkg/edge -run AgentSketch
```

WebView2 패치 검사는 Windows에서만 실행합니다. macOS 검증은 `go test ./...` 및 `./scripts/build.sh`를 사용합니다.

편집 화면을 바꿨다면 개발 서버(18440)를 띄운 상태에서 UI 회귀 검사도 실행해 주세요.

```powershell
node scripts/e2e-check.mjs
node scripts/editor-regressions.mjs
node --experimental-strip-types scripts/routing-group-check.mjs   # 경로·그룹 변경 시
```

## 지켜야 할 계약

[AGENTS.md](AGENTS.md)에 프로젝트 규칙이 정리되어 있습니다. 특히 다음은 리뷰에서 확인합니다.

- **문서 형식**: `src/types.ts`와 `validateDocument`가 계약입니다. 형식을 바꾸면 기존 `.agentsketch` 파일 열기와 저장 후 재열기를 확인하고 테스트를 추가하세요.
- **이력**: 새 문서를 열면 실행 취소 이력을 초기화합니다. 다른 파일의 내용이 Undo로 덮어써지는 문제를 다시 만들지 않습니다.
- **성능**: 지속적인 `requestAnimationFrame` 루프를 추가하지 않습니다. 이미지 문자열은 이력에서 공유하고 디코딩 캐시는 제한합니다. 성능 변경은 같은 조건의 측정 결과를 함께 올려 주세요.
- **브라우저 보호 인자**: 새 Edge/WebView2 실행에는 `--disable-features=AutofillAiWalletPrivatePasses`를 실제 인자로 전달합니다. `third_party/go-webview2` 패치를 제거하지 마세요.
- **복구 경로**: 정상 종료 전 최신 편집을 복구 파일에 쓰는 `agentsketch:closing` → `CloseWithRecovery` 경로를 유지합니다.
- **예시·테스트 데이터**: 회사 내부 시스템명, 실제 업무 절차, 개인 정보, 업무 화면 캡처를 넣지 말고 가상의 일반 예시만 사용합니다.

## 커밋과 PR

- 커밋 메시지는 [Conventional Commits](https://www.conventionalcommits.org/ko/) 형식을 권장합니다. 예: `fix(routing): 겹친 장애물에서 경로 캐시 무효화`
- PR 하나에는 한 가지 목적만 담아 주세요. 사용자에게 보이는 변경은 [CHANGELOG.md](CHANGELOG.md)의 `Unreleased`에 적습니다.
- UI 변경은 전후 스크린샷을 첨부해 주세요.

기여한 코드는 [MIT 라이선스](LICENSE)로 배포되는 데 동의한 것으로 간주합니다.
