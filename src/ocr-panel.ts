import './ocr-panel.css';
import { createNode, DOCUMENT_LIMITS } from './model.ts';
import type { FlowDocument, FlowNode } from './types.ts';
import type { WorkbenchHost } from './workspace-types.ts';
import {t} from './i18n.ts';

type OCRAPI = { ExtractImageText(data:string):Promise<string>; OCRAvailable?():Promise<boolean> };
const native = () => (window as Window & {go?:{main?:{App?:OCRAPI}}}).go?.main?.App;

/** OCR is explicit and local. Recognized text is only added after review. */
export function mountOcrPanel(host:WorkbenchHost, container:HTMLElement) {
  container.classList.add('ocr-panel');
  container.innerHTML = `
    <div class="ocr-source"><span class="ocr-field-label">선택한 이미지</span><strong data-ocr-source></strong><p data-ocr-availability></p></div>
    <div class="ocr-actions"><button class="primary-button" type="button" data-ocr-extract>글자 읽기</button><span class="ocr-local">외부 전송 없음</span></div>
    <p class="ocr-status" data-ocr-status role="status" aria-live="polite"></p>
    <label class="ocr-result"><span>읽어 온 글자</span><textarea data-ocr-result aria-label="OCR 결과 편집" rows="12" maxlength="50000" placeholder="이미지를 선택하고 글자 읽기를 누르세요. 결과를 확인한 뒤 내용을 수정할 수 있습니다."></textarea></label>
    <p class="ocr-help">작은 글자, 흐릿한 캡처, 표는 잘못 읽힐 수 있습니다. 숫자와 단위를 원본과 확인하세요. 이미지 자르기와 회전 전의 저장된 원본을 읽습니다.</p>
    <div class="ocr-actions"><button class="secondary-button" type="button" data-ocr-add>텍스트 요소로 추가</button><button class="subtle-button" type="button" data-ocr-clear>결과 지우기</button></div>`;
  const $ = <T extends HTMLElement>(selector:string) => container.querySelector<T>(selector)!;
  const extract=$<HTMLButtonElement>('[data-ocr-extract]'), add=$<HTMLButtonElement>('[data-ocr-add]'), clear=$<HTMLButtonElement>('[data-ocr-clear]');
  const result=$<HTMLTextAreaElement>('[data-ocr-result]'), status=$<HTMLParagraphElement>('[data-ocr-status]');
  const abort=new AbortController();
  let destroyed=false, busy=false, token=0;
  let ocrAvailable=typeof native()?.ExtractImageText==='function'&&typeof native()?.OCRAvailable!=='function';
  let currentDoc:FlowDocument|undefined, currentId='', currentData='';
  let recognizedDoc:FlowDocument|undefined, recognizedId='';
  const macOS=/Mac|iPhone|iPad/.test(navigator.platform);

  const selectedImage=():FlowNode|undefined => {
    const ids=host.getSelection();
    return ids.size===1 ? host.getDocument().nodes.find(n=>ids.has(n.id)&&n.kind==='image') : undefined;
  };
  const message=(text:string,error=false)=>{status.textContent=text;status.classList.toggle('ocr-error',error);};
  const buttons=()=>{
    extract.disabled=busy||!currentData||!ocrAvailable;
    extract.textContent=busy?'글자를 읽는 중…':'글자 읽기';
    add.disabled=busy||!result.value.trim()||recognizedDoc!==host.getDocument()||recognizedId!==currentId||!currentId;
    clear.disabled=busy||!result.value;
    container.setAttribute('aria-busy',String(busy));
  };
  function update() {
    if(destroyed)return;
    const doc=host.getDocument(), node=selectedImage(), asset=node?.assetId?doc.assets[node.assetId]:undefined;
    const id=node?.id??'', data=asset?.data??'';
    if(currentDoc!==doc||currentId!==id||currentData!==data){
      token++;currentDoc=doc;currentId=id;currentData=data;
      recognizedDoc=undefined;recognizedId='';result.value='';
      message(busy?'이전 이미지의 처리가 끝나면 새 이미지를 읽을 수 있습니다.':'');
    }
    {const source=$<HTMLElement>('[data-ocr-source]');source.dataset.noI18n='';source.textContent=node?(asset?.name||node.text||t('이름 없는 이미지')):t('이미지 하나를 선택하세요');}
    $<HTMLElement>('[data-ocr-availability]').textContent=ocrAvailable
      ? macOS?'Apple Vision을 이 Mac에서 로컬로 사용합니다. 결과를 자동으로 보드에 넣지 않습니다.':'PC에 설치된 Windows 인식 언어를 사용합니다. 결과를 자동으로 보드에 넣지 않습니다.'
      : macOS?'이 빌드에서는 글자 읽기를 사용할 수 없습니다.':'글자 읽기는 Windows 실행 파일에서 사용할 수 있습니다.';
    buttons();
  }
  extract.addEventListener('click',async()=>{
    update();if(extract.disabled)return;
    const doc=currentDoc!,id=currentId,data=currentData,request=++token;
    busy=true;buttons();message('선택한 이미지의 글자를 읽고 있습니다.');
    try{
      const text=await native()!.ExtractImageText(data);
      if(destroyed)return;
      update();
      if(request!==token||host.getDocument()!==doc||currentId!==id||currentData!==data){message('선택 또는 문서가 변경되어 이전 인식 결과를 적용하지 않았습니다.');return;}
      recognizedDoc=doc;recognizedId=id;result.value=text.slice(0,50_000);
      message(text.trim()?`${result.value.length.toLocaleString()}자를 읽었습니다. 내용을 확인하고 텍스트로 추가하세요.${text.length>50_000?' 50,000자까지 표시합니다.':''}`:'읽을 수 있는 글자가 없습니다. 더 선명한 이미지로 다시 시도하세요.');
    }catch(error){if(!destroyed&&request===token)message(`글자를 읽지 못했습니다. ${error instanceof Error?error.message:String(error)}`,true);}
    finally{busy=false;if(!destroyed)buttons();}
  },{signal:abort.signal});
  result.addEventListener('input',buttons,{signal:abort.signal});
  clear.addEventListener('click',()=>{result.value='';recognizedDoc=undefined;recognizedId='';message('결과를 지웠습니다.');buttons();},{signal:abort.signal});
  add.addEventListener('click',()=>{
    update();if(add.disabled)return;
    const image=selectedImage();if(!image)return;
    const text=result.value.trim(), doc=host.getDocument();
    if(doc.nodes.length>=DOCUMENT_LIMITS.nodes){message('요소 수가 최대 한도에 도달했습니다. 일부 요소를 정리한 뒤 추가하세요.',true);return;}
    const node=createNode('text',image.x,image.y+image.h+24);
    node.text=text;node.w=Math.max(300,Math.min(800,image.w));node.align='left';
    const charsPerLine=Math.max(12,Math.floor((node.w-28)/node.fontSize));
    const lines=text.split('\n').reduce((total,line)=>total+Math.max(1,Math.ceil(line.length/charsPerLine)),0);
    node.h=Math.max(64,Math.min(100_000,Math.ceil(lines*node.fontSize*1.45+20)));
    if(image.details?.pageId)node.details={pageId:image.details.pageId};
    host.mutate(()=>doc.nodes.push(node),'인식한 글자를 텍스트 요소로 추가했습니다.');
    host.select([node.id]);host.fit([image,node]);update();
  },{signal:abort.signal});
  update();
  void native()?.OCRAvailable?.().then(available=>{if(!destroyed){ocrAvailable=available;update();}});
  return {update,destroy(){destroyed=true;token++;abort.abort();currentDoc=undefined;currentData='';recognizedDoc=undefined;container.replaceChildren();}};
}
