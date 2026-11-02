# AgentSketch 개발 계약

- 이 폴더는 독립 Windows 앱이며 공개 오픈소스(MIT)다. 앱은 외부 DB나 업무 서버에 접속하지 않는다.
- 예시·테스트 픽스처·문서·스크린샷에 회사 내부 시스템명, 업무 절차, 내부 경로, 실제 업무 화면 캡처를 넣지 않는다. 일반적인 가상 예시만 사용한다.
- Go + Wails v2.17.0, TypeScript + Canvas 2D. Node 서버는 개발용이며 배포는 임베드된 단일 실행 파일이다.
- 빌드: `powershell` 또는 `pwsh`에서 `./scripts/build.ps1`. 코드 검사: `npm run build`, `npm test`, `go test ./...`, `go test github.com/wailsapp/go-webview2/pkg/edge -run AgentSketch`.
- Windows에서 새 브라우저/WebView 프로필은 반드시 `--disable-features=AutofillAiWalletPrivatePasses`를 실제 브라우저 인자로 전달한다. Wails가 환경변수를 지우므로 `third_party/go-webview2/AGENTSKETCH-PATCH.md`의 로컬 패치를 유지한다. 공유 모듈 캐시는 수정하지 않는다.
- 기본 GPU 비활성화는 이 PC의 같은 보드 비교 측정을 근거로 한다. 성능을 바꿀 때는 프로세스 트리 메모리와 렌더 비용을 같은 조건에서 확인한다. 실행 시 디버그 포트를 기본 활성화하지 않는다.
- 문서 포맷은 `src/types.ts`와 `validateDocument`가 계약이다. `.agentsketch`는 이미지가 포함된 JSON이며 변경 시 기존 파일 열기와 저장 후 재열기를 확인한다.
- 이미지 문자열은 이력에서 공유하며 디코딩 캐시는 제한한다. 지속적인 requestAnimationFrame 루프를 추가하지 않는다. 최적화는 내보내기의 원본 내용과 글자를 누락시키면 안 된다.
- 새 문서를 열 때 이력을 초기화한다. 다른 파일의 내용이 Undo로 현재 파일에 덮어써지는 문제를 재도입하지 않는다.
- 정상 종료 전 최신 편집을 복구 파일에 쓰는 `agentsketch:closing` → `CloseWithRecovery` 경로를 유지한다. 자동 복구와 수동 파일 저장을 구분해 안내한다.
- 주요 UI 회귀 검사: 개발 서버 18440에서 `node scripts/e2e-check.mjs`, `node scripts/editor-regressions.mjs`. Edge와 설치된 Playwright를 쓰며 모든 새 실행에 위 보호 인자가 필요하다.
- 샘플 보드는 설명용이다. 실제 원천 연결, 수량 계산, 법정 기한 또는 운영 검증을 주장하지 않는다.

- 직각 경로·손잡이·그룹 UI 회귀 검사: 개발/미리보기 서버 18440에서 `node --experimental-strip-types scripts/routing-group-check.mjs`. 경유점은 최대 32개이며 파일·Undo·그룹 이동에서 보존한다. 변경된 장애물에 닿는 경로 캐시를 무효화하고, 경로 없음 알림을 유지한다.
