import fs from 'node:fs/promises';
import path from 'node:path';
import { codexEvents, claudeEvents } from './events.mjs';

const LIMIT=2*1024*1024,DAY=86400_000;
async function entries(dir){try{return await fs.readdir(dir,{withFileTypes:true});}catch{return [];}}
export class LogObserver {
  constructor(home,store,{codexHome=path.join(home,'.codex'),claudeHome=path.join(home,'.claude'),discovery=true,aliases=[]}={}){
    this.home=home;this.aliases=aliases;this.discovery=discovery;this.headers=new Map();this.codexHome=codexHome;this.claudeHome=claudeHome;this.store=store;this.files=new Map();this.available={codex:false,claude:false};this.lastDiscovery=0;this.recentProjects=[];this.limited=false;
  }
  async metadata(file,provider){
    let handle;try{
      handle=await fs.open(file,'r');const buffer=Buffer.alloc(65536),{bytesRead}=await handle.read(buffer,0,buffer.length,0);
      for(const line of buffer.toString('utf8',0,bytesRead).split('\n')){
        let row;try{row=JSON.parse(line);}catch{continue;}
        const m=provider==='codex'&&row.type==='session_meta'?row.payload:provider==='claude'&&typeof row.cwd==='string'?row:null;
        if(!m||typeof m.cwd!=='string')continue;
        const canonical=await fs.realpath(m.cwd).catch(()=>null);if(!canonical)return null;const cwd=this.store.rootFor(m.cwd)?m.cwd:canonical;
        return {id:m.session_id||m.sessionId||m.id,cwd,parentId:m.source?.subagent?.thread_spawn?.parent_thread_id};
      }
    }catch{}finally{await handle?.close();}return null;
  }
  async discover(){
    const candidates=[];this.limited=false;
    // Resumed sessions remain in the directory of their original creation date.
    const base=path.join(this.codexHome,'sessions');
    for(const y of (await entries(base)).filter(e=>e.isDirectory()&&/^\d{4}$/.test(e.name)))for(const m of (await entries(path.join(base,y.name))).filter(e=>e.isDirectory()&&/^\d{2}$/.test(e.name)))for(const d of (await entries(path.join(base,y.name,m.name))).filter(e=>e.isDirectory()&&/^\d{2}$/.test(e.name))){
      for(const f of await entries(path.join(base,y.name,m.name,d.name)))if(f.isFile()&&f.name.endsWith('.jsonl')){if(candidates.length>=10000){this.limited=true;break;}candidates.push({file:path.join(base,y.name,m.name,d.name,f.name),provider:'codex'});}
    }
    const claude=path.join(this.claudeHome,'projects');
    // Claude names each directory after its cwd, so directories outside the watched roots are never listed or opened.
    // Roots are real paths but Claude names a directory after the cwd as launched, so the paths the user gave (aliases) count too.
    // ponytail: assumes Claude's non-alphanumeric-to-dash naming and 200-character cut-off. The encoding cannot tell /a/foo/bar from /a/foo-bar, so a sibling such as /a/foo-bar has its header opened and then discarded by the cwd check; read each file's cwd instead if that ever matters.
    const prefixes=[...this.store.roots,...this.aliases].map(r=>r.replace(/[^a-zA-Z0-9]/g,'-').slice(0,200));
    for(const dir of (await entries(claude)).filter(e=>e.isDirectory()&&prefixes.some(p=>e.name.startsWith(p))).slice(0,1000))for(const f of await entries(path.join(claude,dir.name)))if(f.isFile()&&f.name.endsWith('.jsonl')){if(candidates.length>=12000){this.limited=true;break;}candidates.push({file:path.join(claude,dir.name,f.name),provider:'claude'});}
    const recent=[];for(const c of candidates){try{const stat=await fs.stat(c.file);if(Date.now()-stat.mtimeMs<DAY)recent.push({...c,stat});}catch{}}
    const found=[],headers=new Map();
    for(const c of recent.sort((a,b)=>b.stat.mtimeMs-a.stat.mtimeMs).slice(0,240)){
      let f=this.files.get(c.file);const meta=f?.meta||this.headers.get(c.file)||await this.metadata(c.file,c.provider);if(!meta)continue;
      // Codex rollouts are filed by date, so only the header says which project one belongs to. It is remembered so an unwatched file is not reopened every cycle, and dropped from everything else.
      headers.set(c.file,meta);if(!this.store.rootFor(meta.cwd))continue;this.available[c.provider]=true;
      if(!f)f={...c,offset:0,partial:'',meta,watched:false};else f.stat=c.stat;
      found.push(f);
    }
    this.headers=headers;
    const projects=new Map();for(const f of found){const prior=projects.get(f.meta.cwd)||{path:f.meta.cwd,name:path.basename(f.meta.cwd),providers:[],lastSeenAt:0};if(!prior.providers.includes(f.provider))prior.providers.push(f.provider);prior.lastSeenAt=Math.max(prior.lastSeenAt,f.stat.mtimeMs);projects.set(prior.path,prior);}
    this.recentProjects=[...projects.values()].sort((a,b)=>b.lastSeenAt-a.lastSeenAt).slice(0,24);
    // Keep watched streams ahead of discovery-only candidates under the read limit.
    found.sort((a,b)=>Number(!!this.store.rootFor(b.meta.cwd))-Number(!!this.store.rootFor(a.meta.cwd))||b.stat.mtimeMs-a.stat.mtimeMs);
    if(found.length>120||recent.length>240)this.limited=true;
    this.files=new Map(found.slice(0,120).map(f=>[f.file,f]));
  }
  async poll(){
    if(!this.discovery)return; // Every log lives under the home directory, so there is nothing else to read.
    if(Date.now()-this.lastDiscovery>5000){this.lastDiscovery=Date.now();await this.discover();}
    for(const f of [...this.files.values()].sort((a,b)=>a.stat.mtimeMs-b.stat.mtimeMs)){
      let handle;
      try{
        const stat=await fs.stat(f.file);f.stat=stat;const wanted=!!this.store.rootFor(f.meta.cwd);
        if(wanted&&!f.watched){f.offset=0;f.partial='';f.eventState=undefined;}f.watched=wanted;
        if(!wanted){f.offset=stat.size;continue;} // Only metadata discovery outside selected roots.
        if(stat.size===f.offset)continue;
        handle=await fs.open(f.file,'r');if(stat.size<f.offset){f.offset=0;f.partial='';f.eventState=undefined;}
        let start=f.offset;const skipped=stat.size-start>LIMIT;if(skipped){start=stat.size-LIMIT;f.partial='';}
        const buf=Buffer.alloc(stat.size-start);await handle.read(buf,0,buf.length,start);
        let input=f.partial+buf.toString('utf8');if(skipped)input=input.slice(input.indexOf('\n')+1);
        const lines=input.split('\n');f.partial=lines.pop();f.offset=stat.size;if(f.partial.length>LIMIT)f.partial='';
        for(const line of lines){
          let row;try{row=JSON.parse(line);}catch{continue;}
          const evs=f.provider==='codex'?codexEvents(row,f.meta,path.basename(f.file)):claudeEvents(row,path.basename(f.file),f.eventState||=( {pending:new Map()} ));
          for(const ev of evs){if(ev.cwd===f.meta.cwd||f.provider==='codex')this.store.accept(ev);else{const canonical=await fs.realpath(ev.cwd).catch(()=>null);if(canonical===f.meta.cwd)this.store.accept({...ev,cwd:canonical});}}
        }
      }catch{this.files.delete(f.file);}finally{await handle?.close();}
    }
  }
}
