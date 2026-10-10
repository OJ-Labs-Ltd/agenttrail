// The iframe page: the same options as mountKitchen, read from the query string. A plain static module (not bundled)
// so the page needs no inline script. The token is passed to mountKitchen and nowhere else: never the DOM, a log line or the history.
const EVIDENCE_EVENT='agenttrail-kitchen:evidence';

function httpUrl(value,name){
  let url;
  try{url=new URL(value,globalThis.location?.href);}catch{throw new Error(`${name} must be an http(s) URL.`);}
  if(url.protocol!=='http:'&&url.protocol!=='https:')throw new Error(`${name} must be an http(s) URL.`);
  return url.href;
}

// An origin is exactly scheme://host[:port]: anything else (a path, credentials, "*", "null") would not be a safe postMessage target.
function httpOrigin(value){
  try{
    const url=new URL(value);
    return (url.protocol==='http:'||url.protocol==='https:')&&url.origin===value?value:null;
  }catch{return null;}
}

export function parseEmbedParams(search){
  const params=new URLSearchParams(search),token=params.get('token'),eventsUrl=params.get('eventsUrl'),reducedMotion=params.get('reducedMotion');
  const snapshotUrl=httpUrl(params.get('snapshotUrl'),'snapshotUrl');
  if(!token)throw new Error('token is required.');
  return {
    snapshotUrl,eventsUrl:eventsUrl?httpUrl(eventsUrl,'eventsUrl'):undefined,token,
    theme:params.get('theme')==='dark'?'dark':'light',
    reducedMotion:reducedMotion===null?undefined:reducedMotion==='true',
    parentOrigin:httpOrigin(params.get('parentOrigin')??'')
  };
}

async function main(){
  const page=document.getElementById('kitchen');
  try{
    const {parentOrigin,...options}=parseEmbedParams(location.search);
    const address=new URL(location.href);
    address.searchParams.delete('token');
    history.replaceState(null,'',address);
    const {mountKitchen}=await import('./build/embed.js');
    // Without a valid parentOrigin nothing is posted: the target is never "*".
    if(parentOrigin&&window.parent!==window)page.addEventListener(EVIDENCE_EVENT,event=>window.parent.postMessage({...event.detail,type:EVIDENCE_EVENT},parentOrigin));
    mountKitchen(page,options);
  }catch(error){
    page.textContent=`This kitchen could not start. ${error.message}`;
  }
}

if(typeof document!=='undefined')main();
