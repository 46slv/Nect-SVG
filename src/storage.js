import {invoke, isTauri} from '@tauri-apps/api/core';
export const desktop=isTauri();
export async function saveFile(contents,name,kind){
 if(desktop)return invoke('save_document',{contents,suggestedName:name,kind});
 const a=document.createElement('a'),url=URL.createObjectURL(new Blob([contents],{type:kind==='svg'?'image/svg+xml':'application/json'}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return true;
}
export async function openFile(){return desktop?invoke('open_document'):null;}
