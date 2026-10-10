import test from 'node:test';
import assert from 'node:assert/strict';
import {webglAvailable,listModel,renderList,evidenceDetail} from '../public/src/embed-list.js';

// Invented fixture: one project, two chefs, one live order, one withdrawn order, one artifact.
const snapshot={
 crew:[
  {id:'role:demo:writer',project:'demo',name:'Writer',provider:'codex',sessionId:'s-0001',state:'writing',freshness:'recent',currentFile:'drafts/post.md'},
  {id:'role:demo:checker',project:'demo',name:'Checker',provider:'claude',sessionId:'s-0002',state:'idle',freshness:'quiet'},
  {id:'role:other:cook',project:'other',name:'Elsewhere',provider:'codex',sessionId:'s-0003',state:'writing',freshness:'recent'}
 ],
 orders:[
  {id:'o1',number:1,title:'Draft the post',project:'demo',status:'in_progress',withdrawn:false,activeChefIds:['role:demo:writer'],contributors:[]},
  {id:'o2',number:2,title:'Dropped idea',project:'demo',status:'pending',withdrawn:true,activeChefIds:[],contributors:[]},
  {id:'o3',number:3,title:'Not ours',project:'other',status:'pending',withdrawn:false,activeChefIds:[],contributors:[]}
 ],
 artifacts:[
  {id:'a1',orderId:'o1',label:'Draft v1',kind:'document',revisionId:'rev-1',producer:'role:demo:writer',secretNote:'must not leak'},
  {id:'a2',orderId:'o3',label:'Other',kind:'document',revisionId:'rev-9'}
 ]
};

const canvasWith=getContext=>()=>({getContext});

test('webglAvailable is false when the canvas gives no context',()=>{
 assert.equal(webglAvailable(canvasWith(()=>null)),false);
});
test('webglAvailable is false when getContext throws',()=>{
 assert.equal(webglAvailable(canvasWith(()=>{throw new Error('blocked');})),false);
});
test('webglAvailable is false when creating the canvas throws',()=>{
 assert.equal(webglAvailable(()=>{throw new Error('no document');}),false);
});
test('webglAvailable is true when webgl2 gives a context',()=>{
 const asked=[];
 assert.equal(webglAvailable(canvasWith(kind=>{asked.push(kind);return kind==='webgl2'?{}:null;})),true);
 assert.deepEqual(asked,['webgl2']);
});
test('webglAvailable falls back to webgl when webgl2 is missing',()=>{
 assert.equal(webglAvailable(canvasWith(kind=>kind==='webgl'?{}:null)),true);
});

test('listModel gives a chef row per observed chef and a ticket row per unwithdrawn order',()=>{
 const model=listModel(snapshot,'demo');
 assert.deepEqual(model.chefs.map(c=>c.id),['role:demo:writer','role:demo:checker']);
 assert.equal(model.chefs[0].name,'Writer');
 assert.equal(model.chefs[0].state,'active');
 assert.equal(model.chefs[0].activity,'Editing post.md');
 assert.equal(model.chefs[1].state,'idle');
 assert.equal(model.tickets.length,1);
 const [ticket]=model.tickets;
 assert.deepEqual({id:ticket.id,number:ticket.number,title:ticket.title,status:ticket.status},{id:'o1',number:1,title:'Draft the post',status:'Cooking'});
 assert.deepEqual(ticket.artifacts,[{id:'a1',label:'Draft v1',kind:'document',revisionId:'rev-1'}]);
});
test('listModel without a project id lists every project',()=>{
 assert.equal(listModel(snapshot).chefs.length,3);
 assert.equal(listModel(snapshot).tickets.length,2);
});
test('listModel on an empty snapshot gives empty arrays',()=>{
 assert.deepEqual(listModel({}),{chefs:[],tickets:[]});
 assert.deepEqual(listModel({},'demo'),{chefs:[],tickets:[]});
});

// The smallest element renderList needs; it has no innerHTML so any use of it would show as a missing property.
function fakeDocument(){
 const make=tag=>({tag,children:[],attrs:{},listeners:{},textContent:'',append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=nodes;},setAttribute(key,value){this.attrs[key]=value;},addEventListener(type,fn){this.listeners[type]=fn;}});
 return {createElement:make};
}
const walk=(node,visit)=>{visit(node);node.children.forEach(child=>walk(child,visit));};

test('renderList shows snapshot strings as text, never markup',()=>{
 const doc=fakeDocument(),root=doc.createElement('div');
 const hostile={chefs:[{id:'c',name:'<b>chef</b>',state:'idle',activity:'<script>x</script>'}],tickets:[{id:'t',number:1,title:'<img onerror=x>',status:'Queued',artifacts:[{id:'a',label:'<u>plate</u>',kind:'k',revisionId:'r'}]}]};
 renderList(root,hostile,doc);
 const texts=[];walk(root,n=>{assert.ok(!('innerHTML' in n),'no innerHTML used');if(n.textContent)texts.push(n.textContent);});
 assert.ok(texts.some(t=>t.includes('<img onerror=x>')));
 assert.ok(texts.some(t=>t.includes('<b>chef</b>')));
});
test('renderList says so when there are no chefs or tickets',()=>{
 const doc=fakeDocument(),root=doc.createElement('div'),texts=[];
 renderList(root,{chefs:[],tickets:[]},doc);
 walk(root,n=>{if(n.textContent)texts.push(n.textContent);});
 assert.ok(texts.includes('No chefs yet'));assert.ok(texts.includes('No tickets yet'));
});
test('renderList labels the region and gives each artifact a real button that reports it',()=>{
 const doc=fakeDocument(),root=doc.createElement('div'),picked=[];
 renderList(root,{chefs:[],tickets:[{id:'t',number:1,title:'Draft',status:'Queued',artifacts:[{id:'a',label:'Plate',kind:'k',revisionId:'r'}]}]},doc,artifact=>picked.push(artifact.id));
 assert.equal(root.attrs.role,'region');assert.ok(root.attrs['aria-label']);
 const buttons=[];walk(root,n=>{if(n.tag==='button')buttons.push(n);});
 assert.equal(buttons.length,1);assert.equal(buttons[0].attrs.type,'button');
 buttons[0].listeners.click();assert.deepEqual(picked,['a']);
});

test('evidenceDetail returns only the five named keys',()=>{
 const detail=evidenceDetail({id:'a1',label:'Draft v1',kind:'document',revisionId:'rev-1',producer:'x',secretNote:'leak'},{id:'o1',title:'Draft the post'});
 assert.deepEqual(detail,{orderId:'o1',artifactId:'a1',label:'Draft v1',kind:'document',revisionId:'rev-1'});
});
