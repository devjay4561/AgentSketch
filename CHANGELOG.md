# Changelog

이 프로젝트의 주요 변경 사항을 기록합니다. 형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/)를, 버전은 [Semantic Versioning](https://semver.org/lang/ko/)을 따릅니다.

## [Unreleased]

## [0.1.2] - 2026-11-04

### Added

- macOS arm64 및 universal `.app` 빌드와 Windows/macOS CI·통합 릴리스 작업을 추가했습니다. Apple Vision OCR, Finder 문서 연결, macOS용 CLI 래퍼를 제공합니다.
- macOS 앱은 Developer ID 서명과 공증 없이 배포되며, Gatekeeper 첫 실행 안내를 추가했습니다.

## [0.1.1] - 2026-11-02

### Added

- 영어 UI. Windows 언어가 한국어가 아니면 영어로 시작하고, **파일 → English / 한국어**에서 바꿀 수 있습니다(다시 시작하면 적용). 예시 보드, 파일 대화상자, 내보낸 보고서도 함께 바뀝니다.

### Changed

- 도형 안 글자 줄바꿈이 영어 단어를 중간에서 자르지 않습니다. 한글은 지금처럼 글자 단위로 줄을 바꾸고, 상자보다 긴 단어는 잘라서 모든 글자를 표시합니다.
- 배포 zip에는 실행 파일, CLI, MCP 서버, 스킬, 라이선스만 넣습니다.

## [0.1.0] - 2026-11-02

첫 공개 베타입니다. 이전 이름(FlowPaper)으로 만든 `.flowpaper` 파일과 `%APPDATA%\FlowPaper` 복구 데이터도 그대로 이어서 쓸 수 있습니다.

### Added

- 도형·텍스트·메모·이미지·표·체크리스트·자유 그리기를 지원하는 Canvas 2D 편집기
- 장애물을 피하는 직각 연결선, 경유점(최대 32개), 조건부 선행 관계
- 정렬·간격·중첩 그룹·페이지·레이어, 5가지 자동 배치와 미리보기
- 자료 출처·버전·확인 기록, 준비 상태·누락·변경 영향 분석
- 여러 문서 탭, 문서 카드 연결, 첨부 파일, 스냅샷·보관 버전, 댓글·북마크·발표 모드
- PNG·SVG·PDF·PPTX·HTML·CSV·draw.io 내보내기, CSV·draw.io 가져오기
- Windows OCR, LAN 공동 작업, 외부 AI 요청(모두 사용자가 켤 때만 동작)
- 104개 명령의 CLI와 MCP(stdio) 서버, AI 에이전트용 스킬
- 자동 복구, 단일 인스턴스, 사용자별 NSIS 설치 파일
- 설명용 예시 보드: *서비스 출시 준비 지도*, *간단한 업무 흐름*

[Unreleased]: https://github.com/devjay4561/AgentSketch/compare/v0.1.2...HEAD
[0.1.1]: https://github.com/devjay4561/AgentSketch/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/devjay4561/AgentSketch/releases/tag/v0.1.0

[0.1.2]: https://github.com/devjay4561/AgentSketch/compare/v0.1.1...v0.1.2
