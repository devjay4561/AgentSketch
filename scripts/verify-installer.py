"""Verify the pinned NSIS solid-LZMA payload without executing an installer."""
from pathlib import Path
import hashlib
import json
import lzma
import struct
import sys

sys.stdout.reconfigure(encoding='utf-8')

root = Path(__file__).resolve().parent.parent
source = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else root / 'release/AgentSketch'
setup = root / 'release' / 'AgentSketch-Setup.exe'
data = setup.read_bytes()
marker = b'\xef\xbe\xad\xdeNullsoftInst'
header_at = data.index(marker) - 4
flags, _, _, _, _, header_size, archive_size = struct.unpack_from('<7I', data, header_at)
assert header_at >= 1024 and archive_size <= len(data) - header_at
assert b'asInvoker' in data[:header_at], 'Installer must request normal user privileges'
assert b'requireAdministrator' not in data[:header_at], 'Unexpected elevation manifest'
start = header_at + 28
props = data[start:start + 5]
lc = props[0] % 9
lp = props[0] // 9 % 5
pb = props[0] // 45
dictionary = int.from_bytes(props[1:], 'little')
assert dictionary <= 64 * 1024 * 1024, 'Unexpected dictionary memory budget'
payload = lzma.decompress(data[start + 5:-4], format=lzma.FORMAT_RAW, filters=[{
    'id': lzma.FILTER_LZMA1, 'dict_size': dictionary, 'lc': lc, 'lp': lp, 'pb': pb,
}])
assert header_size < len(payload)
application = (root / 'build/bin/AgentSketch.exe').read_bytes()
assert application in payload, 'Installer does not contain the exact final application bytes'
assert (root / '.tools/AgentSketch-Rollback.exe').read_bytes() in payload
assert (root / 'scripts/NSIS-LICENSE.txt').read_bytes() in payload
included = ['AgentSketch.exe', 'AgentSketch-Rollback.exe', 'Uninstall.exe']
included.append('NSIS-LICENSE.txt')
for name in ['THIRD-PARTY-NOTICES.txt', 'agentsketch.cmd']:
    expected = (source / name).read_bytes()
    assert expected in payload, f'Bundled {name} differs from final package'
    assert name.encode('utf-16-le') in payload, f'Unicode filename missing: {name}'
    included.append(name)
for name in ['AI/ai/cli.mjs', 'AI/ai/runtime.mjs', 'AI/dist/render.html', 'AI/src/commands.ts', 'AI/skills/agentsketch/SKILL.md', 'AI/node_modules/playwright-core/package.json']:
    assert (source / name).read_bytes() in payload, f'AI payload missing: {name}'
    included.append(name)
fragment = (root / '.tools/ai-uninstall.nsh').read_text(encoding='utf-8-sig')
assert 'RMDir /r' not in fragment and '..' not in fragment
assert all(line.startswith(('Delete "$INSTDIR\\AI\\', 'RMDir "$INSTDIR\\AI')) for line in fragment.splitlines() if line)
assert 'Uninstall.exe'.encode('utf-16-le') in payload
assert 'AgentSketch managed installation v1'.encode('utf-16-le') in payload
source = (root / 'scripts/installer.nsi').read_text(encoding='utf-8')
assert 'HKLM' not in source and 'RMDir /r' not in source
assert 'Delete "$APPDATA' not in source and 'RMDir "$APPDATA' not in source
report = {
    'installer': str(setup),
    'installerSHA256': hashlib.sha256(data).hexdigest().upper(),
    'applicationSHA256': hashlib.sha256(application).hexdigest().upper(),
    'installerBytes': len(data), 'payloadBytes': len(payload),
    'normalUserManifest': True, 'exactApplicationPayload': True,
    'unicodeFilenames': True, 'files': included,
    'sourceHasOnlyHKCUAndNoRecursiveRemoval': True,
    'installedOnHost': False,
    'uninstallAndRollbackExecuted': False,
}
(root / 'output/installer-check.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False, indent=2))
