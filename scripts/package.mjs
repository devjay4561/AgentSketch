import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSample } from '../src/sample.ts';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const release=path.join(root,'release','AgentSketch');
await fs.rm(path.join(release,'예시'),{recursive:true,force:true});
await fs.mkdir(path.join(release,'예시'),{recursive:true});
await fs.copyFile(path.join(root,'build/bin/AgentSketch.exe'),path.join(release,'AgentSketch.exe'));
await fs.copyFile(path.join(root,'LICENSE'),path.join(release,'LICENSE.txt'));
await fs.copyFile(path.join(root,'docs/사용안내.md'),path.join(release,'사용안내.md'));
await fs.copyFile(path.join(root,'docs/검증결과.md'),path.join(release,'검증결과.md'));
await fs.copyFile(path.join(root,'docs/업그레이드범위.md'),path.join(release,'업그레이드범위.md'));
await fs.copyFile(path.join(root,'DESIGN.md'),path.join(release,'디자인.md'));
await fs.copyFile(path.join(root,'docs/AI-사용안내.md'),path.join(release,'AI-사용안내.md'));
const aiRoot=path.join(release,'AI');
await fs.mkdir(aiRoot,{recursive:true});
// Clear copied trees first; fs.cp only overwrites, so stale hashed bundles and removed sources would otherwise ship.
for(const dir of ['ai','dist','skills','src'])await fs.rm(path.join(aiRoot,dir),{recursive:true,force:true});
for(const dir of ['ai','dist','skills'])await fs.cp(path.join(root,dir),path.join(aiRoot,dir),{recursive:true});
await fs.cp(path.join(root,'src'),path.join(aiRoot,'src'),{recursive:true,filter:file=>!file.endsWith('.test.ts')});
await fs.cp(path.join(root,'node_modules/playwright-core'),path.join(aiRoot,'node_modules/playwright-core'),{recursive:true});
await fs.writeFile(path.join(aiRoot,'package.json'),JSON.stringify({name:'agentsketch-ai',private:true,type:'module',engines:{node:'>=24'}}));
await fs.writeFile(path.join(release,'agentsketch.cmd'),'@echo off\r\nnode "%~dp0AI\\ai\\cli.mjs" %*\r\n','utf8');
const workspaceRoot=path.join(root,'documents');await fs.mkdir(workspaceRoot,{recursive:true});
await fs.writeFile(path.join(aiRoot,'mcp-config.json'),JSON.stringify({mcpServers:{agentsketch:{command:'node',args:[path.join(aiRoot,'ai/cli.mjs'),'mcp','--root',workspaceRoot]}}},null,2));
await fs.writeFile(path.join(aiRoot,'skills/agentsketch/locations.json'),JSON.stringify({cli:path.join(aiRoot,'ai/cli.mjs'),executable:path.join(release,'AgentSketch.exe'),root:workspaceRoot},null,2));
for(const [key,name] of [['launch','서비스 출시 준비 지도'],['simple','간단한 업무 흐름']]){
  await fs.writeFile(path.join(release,'예시',name+'.agentsketch'),JSON.stringify(createSample(key),null,2),'utf8');
}
const modules=execFileSync('go',['list','-m','-f','{{.Path}}|{{.Version}}|{{.Dir}}','all'],{cwd:root,encoding:'utf8'}).trim().split(/\r?\n/);
const notices=['AgentSketch third-party notices\n\nAll original notices and license terms below apply to their respective dependencies.\n'];
notices.push('\nAgentSketch Export Sans Regular and Semibold: derived static PDF fonts (AgentSketchExport-Regular.ttf, AgentSketchExport-Semibold.ttf), renamed from Pretendard to respect the Reserved Font Name. Licensed under SIL Open Font License 1.1. See original OFL below.\n');
notices.push('\nPretendard Variable v1.3.9\nhttps://github.com/orioncactus/pretendard\n\n' + await fs.readFile(path.join(root,'public/fonts/OFL.txt'),'utf8'));
for(const line of modules){
  const [name,version,dir]=line.split('|');if(name==='agentsketch'||!dir)continue;
  const entries=await fs.readdir(dir).catch(()=>[]);
  const files=entries.filter(name=>/^(LICENSE|LICENCE|COPYING|NOTICE)(\..*)?$/i.test(name));
  notices.push(`\n${'='.repeat(72)}\n${name} ${version}\n`);
  for(const file of files){if((await fs.stat(path.join(dir,file))).isFile())notices.push(`\n${file}\n${await fs.readFile(path.join(dir,file),'utf8')}\n`);}
  if(!files.length) notices.push('See the upstream module repository for its license.\n');
}
const packageDirs=execFileSync(process.platform==='win32'?'npm.cmd':'npm',['ls','--omit=dev','--parseable','--all'],{cwd:root,encoding:'utf8',shell:process.platform==='win32'}).trim().split(/\r?\n/);
for(const dir of new Set(packageDirs)){if(dir===root)continue;const pkg=JSON.parse(await fs.readFile(path.join(dir,'package.json'),'utf8'));notices.push(`\n${pkg.name} ${pkg.version} (${pkg.license||'see license'})\n`);for(const file of await fs.readdir(dir)){if(/^(license|licence|copying|notice)(\..*)?$/i.test(file)&&(await fs.stat(path.join(dir,file))).isFile())notices.push(await fs.readFile(path.join(dir,file),'utf8'));}}
await fs.writeFile(path.join(release,'THIRD-PARTY-NOTICES.txt'),notices.join(''),'utf8');
await fs.writeFile(path.join(release,'시작하기.txt'),'AgentSketch.exe를 실행하세요.\r\n\r\nCtrl+S: 문서 저장 / Ctrl+O: 문서 열기 / Ctrl+V: 이미지 붙여넣기\r\n? 키: 단축키 도움말\r\n예시 폴더의 .agentsketch 파일은 앱의 파일 → 열기로 열 수 있습니다.\r\n\r\n업무 도구에서 자료 추적·고급 배치·문서 보관함·보고 기능을 사용할 수 있습니다. 보관할 작업은 파일로 저장하세요.\r\nPPT는 슬라이드를 그림으로 복사하거나 캡처해서 붙여넣습니다.\r\nWindows 10/11 및 Microsoft Edge WebView2 Runtime이 필요합니다.\r\n','utf8');
console.log(release);
