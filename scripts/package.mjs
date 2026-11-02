import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const platform=process.argv[2]??'windows';
if(!['windows','macos'].includes(platform))throw new Error('Use package.mjs windows|macos');
const release=path.join(root,'release','AgentSketch');
// Ship only what runs the app and lets an agent drive it; start clean so stale files never ship.
const aiRoot=platform==='windows'?path.join(release,'AI'):path.join(root,'build/bin/AgentSketch.app/Contents/Resources/AI');
if(platform==='windows'){
  await fs.rm(release,{recursive:true,force:true});
  await fs.mkdir(release,{recursive:true});
  await fs.copyFile(path.join(root,'build/bin/AgentSketch.exe'),path.join(release,'AgentSketch.exe'));
  await fs.copyFile(path.join(root,'LICENSE'),path.join(release,'LICENSE.txt'));
}else{
  await fs.rm(aiRoot,{recursive:true,force:true});
  await fs.copyFile(path.join(root,'LICENSE'),path.join(root,'build/bin/AgentSketch.app/Contents/Resources/LICENSE.txt'));
}
await fs.mkdir(aiRoot,{recursive:true});
for(const dir of ['ai','dist'])await fs.cp(path.join(root,dir),path.join(aiRoot,dir),{recursive:true});
await fs.cp(path.join(root,'skills/agentsketch'),path.join(aiRoot,'skills/agentsketch'),{recursive:true,filter:file=>path.basename(file)!=='locations.json'});
await fs.cp(path.join(root,'src'),path.join(aiRoot,'src'),{recursive:true,filter:file=>!file.endsWith('.test.ts')});
await fs.cp(path.join(root,'node_modules/playwright-core'),path.join(aiRoot,'node_modules/playwright-core'),{recursive:true});
await fs.writeFile(path.join(aiRoot,'package.json'),JSON.stringify({name:'agentsketch-ai',private:true,type:'module',engines:{node:'>=24'}}));
if(platform==='windows')await fs.writeFile(path.join(release,'agentsketch.cmd'),'@echo off\r\nnode "%~dp0AI\\ai\\cli.mjs" %*\r\n','utf8');
else {
  const wrapper=path.join(root,'build/bin/AgentSketch.app/Contents/Resources/agentsketch');
  await fs.writeFile(wrapper,'#!/bin/sh\nexec node "$(dirname "$0")/AI/ai/cli.mjs" "$@"\n','utf8');
  await fs.chmod(wrapper,0o755);
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
const noticePath=platform==='windows'?path.join(release,'THIRD-PARTY-NOTICES.txt'):path.join(root,'build/bin/AgentSketch.app/Contents/Resources/THIRD-PARTY-NOTICES.txt');
await fs.writeFile(noticePath,notices.join(''),'utf8');
console.log(platform==='windows'?release:aiRoot);
