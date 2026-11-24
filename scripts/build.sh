#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$project_root"

arch=arm64
skip_install=0
skip_tests=0
while (($#)); do
  case "$1" in
    --arch) arch="${2:?--arch requires arm64 or universal}"; shift 2 ;;
    --skip-install) skip_install=1; shift ;;
    --skip-tests) skip_tests=1; shift ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
done
case "$arch" in arm64|universal) ;; *) printf 'Use --arch arm64 or --arch universal\n' >&2; exit 2 ;; esac
[[ "$(uname -s)" == Darwin ]] || { echo 'Build macOS apps on a Mac runner.' >&2; exit 2; }
command -v go >/dev/null || { echo 'Install Go 1.26 or newer.' >&2; exit 2; }
command -v npm >/dev/null || { echo 'Install Node.js 24 or newer with npm.' >&2; exit 2; }
command -v clang >/dev/null || { echo 'Install Xcode Command Line Tools for cgo and Apple Vision.' >&2; exit 2; }
go_version="$(go env GOVERSION | sed 's/^go//')"
go_major="${go_version%%.*}"
go_minor="${go_version#*.}"
go_minor="${go_minor%%.*}"
node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
(( go_major > 1 || (go_major == 1 && go_minor >= 26) )) || { echo "Go 1.26+ required, found $go_version" >&2; exit 2; }
(( node_major >= 24 )) || { echo "Node.js 24+ required, found $(node --version)" >&2; exit 2; }
[[ "$(go env CGO_ENABLED)" == 1 ]] || { echo 'Apple Vision requires CGO_ENABLED=1.' >&2; exit 2; }

if (( skip_install == 0 )); then npm ci; fi
npm run build
if (( skip_tests == 0 )); then
  npm test
  go test ./...
  go vet ./...
fi

tool_dir="$project_root/.tools/bin"
wails="$tool_dir/wails"
if [[ ! -x "$wails" ]]; then
  mkdir -p "$tool_dir"
  GOBIN="$tool_dir" go install github.com/wailsapp/wails/v2/cmd/wails@v2.17.0
fi
"$wails" build -platform "darwin/$arch" -s -skipbindings -trimpath
printf 'Built app: %s\n' "$project_root/build/bin/AgentSketch.app"
