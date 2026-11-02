# 요청 예시

CLI는 표준 입력 JSON 또는 `--request request.json`을 읽고 stdout에 JSON 한 줄을 출력한다. 성공 exit 0, 실패 exit 1이다. PowerShell은 JSON을 UTF-8 파일로 저장해서 넘기면 인용부호 문제를 피할 수 있다.

```json
{
  "target": {"file": "월간보고.agentsketch"},
  "commands": [
    {"command": "document.new", "args": {"title": "월간보고 준비"}},
    {"command": "node.add", "args": {"id": "material", "kind": "round", "x": 0, "y": 0, "props": {"text": "선행 자료", "details": {"role": "resource", "status": "missing", "notes": "실제 원본 확인 필요"}}}},
    {"command": "node.add", "args": {"id": "report", "kind": "round", "x": 380, "y": 0, "props": {"text": "월간보고", "fill": "#FFF1E8", "stroke": "#D66536"}}},
    {"command": "edge.add", "args": {"from": "material", "to": "report", "props": {"style": "elbow", "relation": "required", "label": "선행 조건"}}}
  ]
}
```

```powershell
node '<cli 경로>' execute --request request.json --root 'C:\work'
node '<cli 경로>' read --file '월간보고.agentsketch' --root 'C:\work'
node '<cli 경로>' connect --exe '<AgentSketch.exe 경로>'
```

live 변경은 target을 `{"live":true}`로 바꾸고 직전 읽기의 `revision`을 `expectedRevision`에 지정한다. 결과는 `results[].result`, 현재 revision은 최상위 `revision`이다. live 서비스 결과는 `result`와 `revision`으로 반환한다.

```json
{"target":{"live":true},"command":"document.open","args":{"path":"C:\\work\\월간보고.agentsketch"}}
```

```json
{"target":{"file":"월간보고.agentsketch"},"command":"document.export","args":{"format":"png"},"output":"월간보고.png"}
```

출력 파일이 이미 있으면 `overwrite:true`를 명시한다. 파일 수정은 교체 직전 원본 해시 재확인·임시 파일·백업을 사용한다. dryRun은 문서 명령에서만 쓰며 파일 저장은 하지 않는다.

MCP 등록은 저장소의 `docs/agent-install.md`를 따른다. `args`에는 실제 설치 위치의 `AI/ai/cli.mjs`와 사용자가 정한 `--root`를 넣는다. `agentsketch_preview`는 모델이 직접 볼 수 있는 PNG 이미지 블록을 반환한다. MCP 서버는 호스트가 필요할 때 실행하고, CLI 일반 명령은 작업 후 종료한다.
