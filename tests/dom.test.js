import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Window} from 'happy-dom';
// Load geometry before a synthetic browser global exists: geometry remains headless.
import '../src/core.js';
test('real editor DOM: typed socket, parameter, undo, layers and safe import',async()=>{
 const win=new Window({url:'http://localhost:5173'});win.document.body.innerHTML='<div id="app"></div>';
 for(const key of ['window','document','HTMLElement','DOMPoint','requestAnimationFrame'])globalThis[key]=key==='requestAnimationFrame'?()=>0:win[key];
 globalThis.fetch=async()=>({ok:true,arrayBuffer:async()=>{let b=await fs.readFile(new URL('../public/fonts/DejaVuSans.ttf',import.meta.url));return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);}});
 let source=await fs.readFile(new URL('../src/main.js',import.meta.url),'utf8');source=source.replace("import './style.css';",'').replace("from './core.js'",`from '${new URL('../src/core.js',import.meta.url)}'`).replace("from './storage.js'",`from '${new URL('../src/storage.js',import.meta.url)}'`).replace("from 'opentype.js'",`from '${import.meta.resolve('opentype.js')}'`);
 await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));await new Promise(r=>setTimeout(r,100));
 let doc=win.nect.document,circle=doc.layers[0].nodes[0];assert.equal(document.querySelectorAll('.node').length,5);assert.ok(document.querySelector('.shape').getAttribute('d'));
 let radius=document.querySelector(`.graph [data-node="${circle.id}"][data-key="radius"] [data-value]`);radius.value='60';radius.dispatchEvent(new win.Event('change',{bubbles:true}));assert.equal(win.nect.document.layers[0].nodes[0].params.radius.value,60);
 document.querySelector('[data-action="undo"]').click();assert.equal(win.nect.document.layers[0].nodes[0].params.radius.value,120);
 let add=document.querySelector('#add-node');add.value='Value';add.dispatchEvent(new win.Event('change',{bubbles:true}));let value=win.nect.document.layers[0].nodes.at(-1);
 document.querySelector(`[data-source="${value.id}"]`).dispatchEvent(new win.PointerEvent('pointerdown',{bubbles:true}));
 document.querySelector(`.graph [data-node="${circle.id}"][data-key="radius"]`).dispatchEvent(new win.PointerEvent('pointerup',{bubbles:true}));
 assert.equal(win.nect.document.layers[0].nodes[0].params.radius.source,value.id);assert.equal(document.querySelectorAll(`.graph [data-node="${circle.id}"][data-key="radius"] .input`).length,1);
 document.querySelector(`.graph [data-node="${circle.id}"][data-key="radius"] .input`).dispatchEvent(new win.MouseEvent('contextmenu',{bubbles:true}));assert.equal(win.nect.document.layers[0].nodes[0].params.radius.source,undefined);
 let old=win.nect.export(),serialized=JSON.stringify(win.nect.document);win.nect.load(serialized);assert.equal(win.nect.export(),old);assert.throws(()=>win.nect.load('{"schemaVersion":99}'));assert.equal(win.nect.export(),old);
 document.querySelector('[data-action="add-layer"]').click();assert.equal(win.nect.document.layers.length,2);assert.equal(document.querySelectorAll('.layer').length,2);
 await win.happyDOM.close();
});
