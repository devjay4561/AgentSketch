import type { FlowDocument } from './types.ts';
import { renderSVG } from './renderer.ts';

const escape = (text: string) => text.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

// Go의 html-viewer 검사는 이 스크립트 한 개만 허용한다. 문서 글자는 renderSVG가 이스케이프한다.
const VIEWER_SCRIPT = `(function(){var v=document.getElementById('view'),s=document.getElementById('stage'),g=s.querySelector('svg'),z=document.getElementById('zoom'),W=g.width.baseVal.value||1,H=g.height.baseVal.value||1,k=1,x=0,y=0,drag=null;
function draw(){s.style.transform='translate('+x+'px,'+y+'px) scale('+k+')';z.textContent=Math.round(k*100)+'%';}
function mid(){var r=v.getBoundingClientRect();return [r.width/2,r.height/2];}
function zoom(f,cx,cy){var n=Math.min(20,Math.max(0.02,k*f));x=cx-(cx-x)*n/k;y=cy-(cy-y)*n/k;k=n;draw();}
function fit(){var r=v.getBoundingClientRect();k=Math.max(0.02,Math.min((r.width-48)/W,(r.height-128)/H));x=(r.width-W*k)/2;y=(r.height-64-H*k)/2;draw();}
function actual(){var c=mid();zoom(1/k,c[0],c[1]);}
v.addEventListener('wheel',function(e){e.preventDefault();var r=v.getBoundingClientRect();zoom(Math.exp(-e.deltaY*(e.deltaMode?0.05:0.0015)),e.clientX-r.left,e.clientY-r.top);},{passive:false});
v.addEventListener('pointerdown',function(e){if(e.button)return;drag=[e.clientX,e.clientY];v.setPointerCapture(e.pointerId);v.classList.add('dragging');});
v.addEventListener('pointermove',function(e){if(!drag)return;x+=e.clientX-drag[0];y+=e.clientY-drag[1];drag=[e.clientX,e.clientY];draw();});
function end(){drag=null;v.classList.remove('dragging');}
v.addEventListener('pointerup',end);v.addEventListener('pointercancel',end);
document.addEventListener('keydown',function(e){var c=mid(),p=60;if(e.key==='+'||e.key==='=')zoom(1.25,c[0],c[1]);else if(e.key==='-')zoom(0.8,c[0],c[1]);else if(e.key==='0')fit();else if(e.key==='1')actual();else if(e.key==='ArrowLeft')x+=p;else if(e.key==='ArrowRight')x-=p;else if(e.key==='ArrowUp')y+=p;else if(e.key==='ArrowDown')y-=p;else return;e.preventDefault();draw();});
document.querySelector('.tools').addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;var c=mid(),a=b.dataset.view;if(a==='in')zoom(1.25,c[0],c[1]);if(a==='out')zoom(0.8,c[0],c[1]);if(a==='fit')fit();if(a==='actual')actual();});
fit();})();`;

/** 확대·축소·이동이 가능한 독립 HTML 뷰어. 외부 자원 없이 열린다. */
export function renderViewerHTML(doc: FlowDocument): string {
  const title = escape(doc.title || '새 보드');
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><title>${title}</title><style>html,body{margin:0;height:100%;overflow:hidden;font:14px 'Pretendard Variable',Pretendard,'Malgun Gothic',sans-serif;color:#1c2024;background:#eef0f3}#view{position:fixed;inset:0;cursor:grab;touch-action:none;user-select:none}#view.dragging{cursor:grabbing}#stage{position:absolute;left:0;top:0;transform-origin:0 0}#stage svg{display:block;box-shadow:0 2px 12px rgba(0,0,0,.12)}.tools{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);display:flex;gap:4px;align-items:center;padding:6px;background:#fff;border:1px solid #dce0e5;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.12)}.tools button{min-width:36px;height:32px;border:0;border-radius:6px;background:transparent;font:inherit;cursor:pointer}.tools button:hover,.tools button:focus-visible{background:#eef0f3}#zoom{min-width:52px;text-align:center;font-variant-numeric:tabular-nums}h1{position:fixed;left:16px;top:12px;margin:0;font-size:15px;font-weight:600;pointer-events:none}@media print{.tools,h1{display:none}}</style></head><body><h1>${title}</h1><div id="view" aria-label="보드 보기. 끌어서 이동, 휠로 확대·축소, 0 키로 화면 맞춤"><div id="stage">${renderSVG(doc)}</div></div><div class="tools" role="toolbar" aria-label="보기 도구"><button data-view="out" aria-label="축소" title="축소 (-)">−</button><span id="zoom" aria-live="polite">100%</span><button data-view="in" aria-label="확대" title="확대 (+)">+</button><button data-view="fit" title="화면에 맞추기 (0)">맞춤</button><button data-view="actual" title="원본 크기 (1)">100%</button></div><script>${VIEWER_SCRIPT}</script></body></html>`;
}
