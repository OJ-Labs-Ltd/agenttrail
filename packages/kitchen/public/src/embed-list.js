// Plain-list fallback for hosts without WebGL. Reads only fields the snapshot already exposes through the payload allowlist.
import {projectOrders,orderState} from './orders.js';
import {activityText,isCurrent,providerName} from './activity.js';

// A failed probe means "no WebGL", so no renderer is ever constructed on a machine that cannot draw one.
export function webglAvailable(createCanvas){
  try{
    const canvas=createCanvas();
    return !!(canvas.getContext('webgl2')||canvas.getContext('webgl'));
  }catch{return false;}
}

const chefName=c=>c.displayName||c.name||`${providerName[c.provider]||'Agent'} ${String(c.sessionId||c.id).slice(-4)}`;

export function listModel(snapshot,projectId){
  const inProject=row=>projectId===undefined||row.project===projectId;
  const orders=(projectId===undefined?snapshot.orders||[]:projectOrders(snapshot,projectId)).filter(o=>!o.withdrawn);
  return {
    chefs:(snapshot.crew||[]).filter(inProject).map(c=>({id:c.id,name:chefName(c),state:isCurrent(c)?'active':'idle',activity:activityText(c)})),
    tickets:orders.map(o=>({
      id:o.id,number:o.number,title:o.title,status:orderState(o),
      artifacts:(snapshot.artifacts||[]).filter(a=>a.orderId===o.id).map(({id,label,kind,revisionId})=>({id,label,kind,revisionId}))
    }))
  };
}

// textContent and createElement only: snapshot strings can never become markup.
export function renderList(root,model,doc=globalThis.document,onArtifact=()=>{}){
  const el=(tag,text)=>{const node=doc.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
  const section=(heading,rows,empty)=>{const box=el('section'),list=el('ul');box.append(el('h2',heading),rows.length?list:el('p',empty));list.append(...rows);return box;};
  root.setAttribute('role','region');
  root.setAttribute('aria-label','Kitchen activity');
  root.replaceChildren(
    section('Chefs',model.chefs.map(c=>{const row=el('li');row.append(el('strong',c.name),el('span',` · ${c.state} · ${c.activity}`));return row;}),'No chefs yet'),
    section('Tickets',model.tickets.map(t=>{
      const row=el('li');row.append(el('strong',`#${t.number} ${t.title}`),el('span',` · ${t.status}`));
      for(const artifact of t.artifacts){
        const button=el('button',`${artifact.label} (${artifact.kind})`);
        button.setAttribute('type','button');
        button.addEventListener('click',()=>onArtifact(artifact,t));
        row.append(button);
      }
      return row;
    }),'No tickets yet')
  );
}

// The only shape the host page receives when someone follows a plate to its evidence.
export const evidenceDetail=({id,label,kind,revisionId},order)=>({orderId:order.id,artifactId:id,label,kind,revisionId});
