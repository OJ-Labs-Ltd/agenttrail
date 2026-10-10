import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

// Invented fixture: one project with two kitchens; the second kitchen's chef must not reach the first scene.
const snapshot={
 projects:[{id:'demo',name:'Demo',components:[{id:'c1',title:'Drafts'},{id:'c2',title:'Checks'}],kitchens:[{id:'k1',title:'Writing',components:['c1']},{id:'k2',title:'Review',components:['c2']}]}],
 crew:[
  {id:'role:demo:writer',project:'demo',name:'Writer',provider:'codex',sessionId:'s-0001',state:'writing',freshness:'recent',component:{id:'c1'}},
  {id:'role:demo:checker',project:'demo',name:'Checker',provider:'claude',sessionId:'s-0002',state:'idle',freshness:'quiet',component:{id:'c2'}}
 ],
 orders:[{id:'o1',number:1,title:'Draft the post',project:'demo',status:'in_progress',withdrawn:false,activeChefIds:['role:demo:writer'],contributors:[]}],
 artifacts:[{id:'a1',orderId:'o1',label:'Draft v1',kind:'document',revisionId:'rev-1',producer:'role:demo:writer',componentId:'c1'}],
 transfers:[],tables:[]
};

// Just enough DOM for mountKitchen: nodes with children and text, a shadow root and a document that makes them.
class FakeNode{
 constructor(tag,getContext){this.tag=tag;this.children=[];this.attributes={};this.listeners={};this.className='';this.textContent='';this.getContext=getContext;}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){this.children=[...nodes];}
 setAttribute(name,value){this.attributes[name]=String(value);}
 addEventListener(type,fn){this.listeners[type]=fn;}
 get text(){return this.textContent+this.children.map(child=>child.text).join(' ');}
 find(match){return match(this)?this:this.children.map(child=>child.find(match)).find(Boolean);}
}
function fakeHost({webgl}){
 const doc={createElement:tag=>new FakeNode(tag,()=>webgl?{}:null)};
 const root=new FakeNode('shadow-root');root.adoptedStyleSheets=[];
 const events=[];
 const host={ownerDocument:doc,attachShadow:()=>root,dispatchEvent:event=>{events.push(event);return true;}};
 return {host,root,events};
}
class FakeSheet{replaceSync(css){this.css=css;}}
function fakeWorld(){
 const world={setDataCalls:[],destroyed:false,setData(data){this.setDataCalls.push(data);},select(){},destroy(){this.destroyed=true;}};
 return world;
}
const settled=()=>new Promise(resolve=>setImmediate(resolve));
function withFeed(t,body=snapshot){
 let signal;
 t.mock.method(globalThis,'fetch',async(url,init)=>{signal=init.signal;return {status:200,json:async()=>body};});
 globalThis.CSSStyleSheet=FakeSheet;
 t.after(()=>{delete globalThis.CSSStyleSheet;});
 return {aborted:()=>signal?.aborted};
}
const css='.kitchen{color:red}';
const options={snapshotUrl:'http://127.0.0.1:1/snapshot',token:'t0ken'};

test('importing the module touches no window, storage or location',async()=>{
 const trap=name=>Object.defineProperty(globalThis,name,{configurable:true,get(){throw new Error(`import read ${name}`);}});
 const names=['localStorage','sessionStorage','location','history'];
 for(const name of names)trap(name);
 try{
  const module=await import('../public/src/embed.js?fresh-import');
  assert.equal(typeof module.mountKitchen,'function');
 }finally{for(const name of names)delete globalThis[name];}
 // three.js probes `window` itself, so the runtime trap cannot cover it; the module's own source is checked instead.
 const source=(await fs.readFile(new URL('../public/src/embed.js',import.meta.url),'utf8')).replace(/\/\/.*$/gm,'');
 assert.doesNotMatch(source,/\b(window|localStorage|sessionStorage|location|history)\b/);
});

test('without WebGL the renderer is never built and the list is shown with a notice',async t=>{
 withFeed(t);
 const {mountKitchen}=await import('../public/src/embed.js');
 const {host,root}=fakeHost({webgl:false});
 let constructed=0;
 const mount=mountKitchen(host,options,{css,createWorld:()=>{constructed++;return fakeWorld();}});
 await settled();
 assert.equal(constructed,0);
 assert.match(root.text,/Draft the post/);
 assert.match(root.text,/3D view is unavailable/);
 assert.equal(root.find(node=>node.tag==='canvas'),undefined);
 assert.equal(root.adoptedStyleSheets[0].css,css);
 mount.destroy();
});

test('a renderer that throws on construction falls back to the list',async t=>{
 withFeed(t);
 const {mountKitchen}=await import('../public/src/embed.js');
 const {host,root}=fakeHost({webgl:true});
 const mount=mountKitchen(host,options,{css,createWorld:()=>{throw new Error('context lost');}});
 await settled();
 assert.match(root.text,/Draft the post/);
 assert.match(root.text,/3D view is unavailable/);
 mount.destroy();
});

test('with WebGL the scene gets only the first kitchen and the list stays beside it',async t=>{
 withFeed(t);
 const {mountKitchen}=await import('../public/src/embed.js');
 const {host,root}=fakeHost({webgl:true});
 const world=fakeWorld(),built=[];
 const mount=mountKitchen(host,{...options,reducedMotion:true},{css,createWorld:(...args)=>{built.push(args);return world;}});
 await settled();
 assert.equal(built.length,1);
 assert.equal(built[0][0].tag,'canvas');
 assert.deepEqual(built[0][3],{reducedMotion:true});
 assert.deepEqual(world.setDataCalls.at(-1).crew.map(chef=>chef.name),['Writer']);
 assert.equal(world.setDataCalls.at(-1).kitchenId,'k1');
 assert.match(root.text,/Draft the post/);
 mount.destroy();
});

test('an unknown theme falls back to light',async t=>{
 withFeed(t);
 const {mountKitchen}=await import('../public/src/embed.js');
 for(const [theme,expected] of [[undefined,'light'],['dark','dark'],['neon','light']]){
  const {host,root}=fakeHost({webgl:false});
  const mount=mountKitchen(host,{...options,theme},{css});
  assert.match(root.find(node=>node.className.startsWith('kitchen '))?.className,new RegExp(`\\b${expected}\\b`),String(theme));
  mount.destroy();
 }
});

test('following an artifact tells the host page, across the shadow boundary',async t=>{
 withFeed(t);
 const {mountKitchen}=await import('../public/src/embed.js');
 const {host,root,events}=fakeHost({webgl:false});
 const mount=mountKitchen(host,options,{css});
 await settled();
 root.find(node=>node.tag==='button').listeners.click();
 assert.equal(events.length,1);
 assert.equal(events[0].type,'agenttrail-kitchen:evidence');
 assert.equal(events[0].bubbles,true);
 assert.equal(events[0].composed,true);
 assert.deepEqual(events[0].detail,{orderId:'o1',artifactId:'a1',label:'Draft v1',kind:'document',revisionId:'rev-1'});
 mount.destroy();
});

test('clicking a plate in the scene raises the same evidence event',async t=>{
 withFeed(t);
 const {mountKitchen}=await import('../public/src/embed.js');
 const {host,events}=fakeHost({webgl:true});
 let onSelect;
 const mount=mountKitchen(host,options,{css,createWorld:(canvas,select)=>{onSelect=select;return fakeWorld();}});
 await settled();
 onSelect({kind:'plate',id:'a1'});
 onSelect({kind:'plate',id:'missing'});
 onSelect({kind:'table',id:'all'});
 assert.deepEqual(events.map(event=>event.detail.artifactId),['a1']);
 mount.destroy();
});

test('destroy stops the feed, destroys the scene and empties the shadow root',async t=>{
 const feed=withFeed(t);
 const {mountKitchen}=await import('../public/src/embed.js');
 const {host,root}=fakeHost({webgl:true});
 const world=fakeWorld();
 const mount=mountKitchen(host,options,{css,createWorld:()=>world});
 await settled();
 mount.destroy();
 assert.equal(feed.aborted(),true);
 assert.equal(world.destroyed,true);
 assert.equal(root.children.length,0);
});

test('two mounts keep their own state',async t=>{
 withFeed(t);
 const {mountKitchen}=await import('../public/src/embed.js');
 const first=fakeHost({webgl:false}),second=fakeHost({webgl:false});
 const one=mountKitchen(first.host,options,{css}),two=mountKitchen(second.host,options,{css});
 await settled();
 one.destroy();
 assert.equal(first.root.children.length,0);
 assert.match(second.root.text,/Draft the post/);
 two.destroy();
});
