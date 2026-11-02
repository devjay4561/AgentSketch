import {computeLayout} from './layout-engine.ts';
import type {LayoutOptions} from './layout-engine.ts';
import type {FlowDocument} from './types.ts';
const worker=globalThis as unknown as {onmessage:(event:MessageEvent<{doc:FlowDocument;options:LayoutOptions}>)=>void;postMessage:(value:unknown)=>void};
worker.onmessage=event=>{try{worker.postMessage({plan:computeLayout(event.data.doc,event.data.options)});}catch(error){worker.postMessage({error:String(error)});}};
