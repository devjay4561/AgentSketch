#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$project_root"
app="$project_root/build/bin/AgentSketch.app"
[[ -d "$app" ]] || { echo 'Build AgentSketch.app first with scripts/build.sh.' >&2; exit 2; }
command -v ditto >/dev/null || { echo 'ditto is required to preserve macOS bundle metadata.' >&2; exit 2; }
command -v hdiutil >/dev/null || { echo 'hdiutil is required to make the DMG.' >&2; exit 2; }
command -v codesign >/dev/null || { echo 'codesign is required to validate the completed app bundle.' >&2; exit 2; }

node scripts/package.mjs macos
codesign --force --deep --sign - "$app"
codesign --verify --deep --strict "$app"
arches="$(lipo -archs "$app/Contents/MacOS/AgentSketch")"
if [[ "$arches" == *arm64* && "$arches" == *x86_64* ]]; then suffix=universal
elif [[ "$arches" == *arm64* ]]; then suffix=arm64
else echo "Unexpected app architectures: $arches" >&2; exit 1; fi
mkdir -p release
zip="release/AgentSketch-macOS-$suffix.zip"
dmg="release/AgentSketch-macOS-$suffix.dmg"
rm -f "$zip" "$dmg"
ditto -c -k --sequesterRsrc --keepParent "$app" "$zip"
hdiutil create -volname AgentSketch -srcfolder "$app" -ov -format UDZO "$dmg" >/dev/null
printf 'Created %s\nCreated %s\nArchitectures: %s\n' "$zip" "$dmg" "$arches"
