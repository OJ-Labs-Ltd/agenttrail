// Mountable Kitchen for a host page. Everything a mount owns lives in its closure and its shadow root: no module state,
// no window globals, no storage and no location or history reads, so two mounts on one page never see each other.
import {KitchenWorld} from './world.js';
import {connectFeed} from './embed-feed.js';
import {webglAvailable,listModel,renderList,evidenceDetail} from './embed-list.js';
import {IdentityBook,isCurrent,projectKitchens,crewForKitchen,kitchenArtifacts} from './activity.js';
import {projectOrders,sharedStations} from './orders.js';

const EVIDENCE_EVENT='agenttrail-kitchen:evidence';

// css arrives from the caller because Node, where the tests import this file, cannot load a .css module.
export function mountKitchen(element,{snapshotUrl,eventsUrl,token,theme='light',reducedMotion},{css,createWorld=(...args)=>new KitchenWorld(...args)}){
  const doc=element.ownerDocument;
  const make=(tag,className,text)=>{const node=doc.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
  const identities=new IdentityBook();
  let world=null,latest={};

  // The same plate can be followed from the list or from the scene; the host page decides what evidence opens.
  function follow(artifact,order){
    element.dispatchEvent(new CustomEvent(EVIDENCE_EVENT,{bubbles:true,composed:true,detail:evidenceDetail(artifact,order)}));
  }
  function selectInScene({kind,id}){
    if(kind!=='plate')return;
    const artifact=(latest.artifacts||[]).find(a=>a.id===id),order=(latest.orders||[]).find(o=>o.id===artifact?.orderId);
    if(artifact&&order)follow(artifact,order);
  }

  const status=make('p','status'),notice=make('p','notice'),scene=make('div','scene'),list=make('div','list');
  status.setAttribute('role','status');
  function apply(next){
    if(!next||typeof next!=='object')return;
    latest=next;
    const project=next.projects?.[0];
    renderList(list,listModel(next,project?.id),doc,follow);
    if(!world||!project)return;
    // Same filtering as the full-page Kitchen, for the project's first kitchen.
    const data={...next,crew:identities.assign(next.crew||[]),artifacts:next.artifacts||[],transfers:next.transfers||[]};
    const owner={...project,kitchens:projectKitchens(project)},kitchen=owner.kitchens[0];
    const crew=crewForKitchen(data.crew,owner,kitchen);
    const visibleCrew=[...crew].sort((a,b)=>Number(isCurrent(b))-Number(isCurrent(a))).slice(0,12).sort((a,b)=>a.id.localeCompare(b.id));
    world.setData({
      components:sharedStations(visibleCrew.length),crew:visibleCrew,artifacts:kitchenArtifacts(data,owner,kitchen,new Set(crew.map(s=>s.id))),
      transfers:data.transfers.filter(t=>t.project===owner.id),demo:false,kitchenId:kitchen.id,projectId:owner.id,connected:true,
      orders:projectOrders(data,owner.id),tables:(data.tables||[]).filter(t=>t.project===owner.id)
    });
  }

  // Started first: a bad URL or a missing token throws here, before anything is built that would need tearing down.
  const feed=connectFeed({snapshotUrl,eventsUrl,token,onSnapshot:apply,onStatus:state=>{status.textContent=state==='offline'?'Reconnecting…':'';}});

  if(webglAvailable(()=>doc.createElement('canvas'))){
    try{
      const canvas=make('canvas');
      canvas.setAttribute('aria-hidden','true');
      scene.append(canvas);
      world=createWorld(canvas,selectInScene,()=>{},{reducedMotion});
    }catch{
      // A renderer that cannot start is the same case as no WebGL: the notice below tells the viewer, and the list carries on.
      world=null;
    }
  }
  if(!world)notice.textContent='The 3D view is unavailable here, so this is a plain list of chefs and tickets.';

  const sheet=new CSSStyleSheet();
  sheet.replaceSync(css);
  const root=element.shadowRoot??element.attachShadow({mode:'open'});
  root.adoptedStyleSheets=[sheet];
  const frame=make('div',`kitchen ${theme==='dark'?'dark':'light'}`);
  frame.append(...(world?[scene]:[notice]),status,list);
  root.replaceChildren(frame);
  apply({});

  return {
    destroy(){
      feed.close();
      world?.destroy();
      root.replaceChildren();
      root.adoptedStyleSheets=[];
    }
  };
}
