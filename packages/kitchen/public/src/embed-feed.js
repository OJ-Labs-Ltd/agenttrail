// Token-bearing feed for an embedded Kitchen. The host's token goes out in an Authorization header on the two
// requests below and nowhere else: never a URL, a log line, an error message or a status.
// ponytail: fixed retry delay, no backoff or jitter. A host that is down for long gets one probe every 5 s per kitchen; add exponential backoff if many embeds share one host.
const RETRY_MS=5000;

function httpUrl(value,name){
  let url;
  // Without this, a missing value becomes "<origin>/null" in a browser, where a page location exists to resolve against.
  if(typeof value!=='string'||!value.trim())throw new Error(`${name} must be an http(s) URL.`);
  try{url=new URL(value,globalThis.location?.href);}catch{throw new Error(`${name} must be an http(s) URL.`);}
  if(url.protocol!=='http:'&&url.protocol!=='https:')throw new Error(`${name} must be an http(s) URL.`);
  return url.href;
}

// Events arrive as `data:` lines closed by a blank line; comment lines (":") are keep-alives. EventSource cannot send headers, hence fetch.
async function readFrames(body,onFrame){
  const reader=body.getReader(),decoder=new TextDecoder();
  let pending='',frame=[];
  for(;;){
    const {done,value}=await reader.read();
    if(done)return;
    pending+=decoder.decode(value,{stream:true});
    const lines=pending.split('\n');
    pending=lines.pop();
    for(const raw of lines){
      const line=raw.endsWith('\r')?raw.slice(0,-1):raw;
      if(line===''){if(frame.length)onFrame(frame.join('\n'));frame=[];}
      else if(line.startsWith('data:'))frame.push(line.slice(line.startsWith('data: ')?6:5));
    }
  }
}

export function connectFeed({snapshotUrl,eventsUrl,token,onSnapshot,onStatus}){
  const snapshot=httpUrl(snapshotUrl,'snapshotUrl');
  const events=eventsUrl?httpUrl(eventsUrl,'eventsUrl'):null;
  if(!token)throw new Error('token is required.');
  const headers={authorization:`Bearer ${token}`};
  const controller=new AbortController();
  let retryTimer;

  async function get(url){
    const response=await fetch(url,{headers,signal:controller.signal});
    if(response.status!==200)throw new Error(`Feed answered ${response.status}.`);
    return response;
  }
  // A throwing onSnapshot is a rendering fault, not a dropped connection: it gets its own status and no reconnect.
  function deliver(next){
    try{onSnapshot(next);return true;}catch{onStatus('error');return false;}
  }
  async function cycle(){
    try{
      if(deliver(await (await get(snapshot)).json()))onStatus('live');
      if(!events)return;
      await readFrames((await get(events)).body,text=>{
        let next;
        try{next=JSON.parse(text);}catch{onStatus('malformed');return;}
        deliver(next);
      });
    }catch{
      // The caught error is dropped on purpose: fetch rejections can quote request headers.
    }
    if(controller.signal.aborted)return;
    onStatus('offline');
    retryTimer=setTimeout(cycle,RETRY_MS);
  }
  cycle();
  return {close(){controller.abort();clearTimeout(retryTimer);}};
}
