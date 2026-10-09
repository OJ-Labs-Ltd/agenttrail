import path from 'node:path';
import { clean } from './crew.mjs';

// The single statement of what the browser may receive. A field that is not listed here is dropped,
// so a new field is private until someone adds it on purpose.
const IDENTITY=['id','provider','sessionId','parentId','cwd','at','source','kind','turnId'];
const TASKS=['tasks','tasksPartial','planId','outcomeId','outcomeTitle','taskChange'];

export const EVENT_FIELDS={
  'session-start':[...IDENTITY,...TASKS],
  'session-end':IDENTITY,
  'turn-start':[...IDENTITY,...TASKS],
  'turn-end':[...IDENTITY,'error'],
  'tool-start':[...IDENTITY,'tool','toolId','file','work',...TASKS],
  'tool-end':[...IDENTITY,'tool','toolId','file','error','work',...TASKS],
  permission:IDENTITY,
  input:IDENTITY,
  interrupted:IDENTITY,
  activity:[...IDENTITY,'tool','file'],
  unknown:IDENTITY,
  role:[...IDENTITY,'roleId','workflowId','runId','itemId','orderId'],
  observation:[...IDENTITY,'work'],
};

const ARTIFACT_IDENTITY=['id','artifactId','revisionId','provider','sessionId','cwd','kind','file','type','label','orderId'];
const ARTIFACT_HANDOFF=['handoffId','recipientProvider','recipientSessionId'];
export const ARTIFACT_FIELDS={
  produced:ARTIFACT_IDENTITY,
  offered:[...ARTIFACT_IDENTITY,...ARTIFACT_HANDOFF],
  received:[...ARTIFACT_IDENTITY,...ARTIFACT_HANDOFF],
  failed:[...ARTIFACT_IDENTITY,...ARTIFACT_HANDOFF],
};

// Map hook payloads. tool_input is reduced to file_path/notebook_path/todos[{content,status}] by allowHook.
const HOOK_IDENTITY=['hook_event_name','session_id','cwd','agent'];
const HOOK_TOOL=[...HOOK_IDENTITY,'tool_name','tool_input'];
export const HOOK_FIELDS={
  SessionStart:HOOK_IDENTITY,
  SessionEnd:HOOK_IDENTITY,
  Stop:HOOK_IDENTITY,
  SubagentStop:HOOK_IDENTITY,
  PreToolUse:HOOK_TOOL,
  PostToolUse:HOOK_TOOL,
};

const TASK_FIELDS=['id','title','status'];
const WORK_FIELDS=['category','label','file','completed'];
const TOOL_INPUT_FIELDS=['file_path','notebook_path'];
const TODO_FIELDS=['content','status'];
const LIST_LIMIT=50;

const isRecord=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const isScalar=value=>value===null||['string','number','boolean'].includes(typeof value);
const pick=(source,fields)=>Object.fromEntries(fields.filter(field=>isScalar(source[field])&&field in source).map(field=>[field,source[field]]));
const pickList=(items,fields)=>Array.isArray(items)?items.slice(0,LIST_LIMIT).filter(isRecord).map(item=>pick(item,fields)):undefined;

const NESTED_EVENT_FIELDS={
  tasks:value=>pickList(value,TASK_FIELDS),
  taskChange:value=>isRecord(value)?pick(value,TASK_FIELDS):undefined,
  work:value=>isRecord(value)?pick(value,WORK_FIELDS):undefined,
};

export function allowEvent(event){
  const fields=isRecord(event)?EVENT_FIELDS[event.kind]||ARTIFACT_FIELDS[event.kind]:undefined;
  if(!fields)return null;
  const allowed={};
  for(const field of fields){
    const value=NESTED_EVENT_FIELDS[field]?NESTED_EVENT_FIELDS[field](event[field]):isScalar(event[field])&&field in event?event[field]:undefined;
    if(value!==undefined)allowed[field]=value;
  }
  return allowed;
}

export function allowHook(hook){
  const fields=isRecord(hook)?HOOK_FIELDS[hook.hook_event_name]:undefined;
  if(!fields)return null;
  const allowed=pick(hook,fields.filter(field=>field!=='tool_input'));
  if(fields.includes('tool_input')&&isRecord(hook.tool_input)){
    const todos=pickList(hook.tool_input.todos,TODO_FIELDS);
    allowed.tool_input={...pick(hook.tool_input,TOOL_INPUT_FIELDS),...(todos?{todos}:{})};
  }
  return allowed;
}

const TOKEN_SHAPES=/-----BEGIN [A-Z ]+-----[\s\S]*?(?:-----END [A-Z ]+-----|$)|\bBearer\s+[\w.~+/=-]{8,}|eyJ[\w-]{5,}\.[\w-]{5,}(?:\.[\w-]*)?|\b(?:sk-[\w-]{8,}|gh[pousr]_\w{20,}|github_pat_\w{20,}|xox[abp]-[\w-]{10,}|AKIA[0-9A-Z]{16}|AIza[\w-]{35}|glpat-[\w-]{20,})/g;
const LONG_RUN=/[A-Za-z0-9+/_=-]{32,}/g;
const SLUG_WORD=/^(?:[a-z0-9]+|[A-Z0-9]+|[A-Z][a-z0-9]+)$/;

// ponytail: a character-class heuristic, not entropy maths. A long CamelCase identifier is redacted as a
// false positive; a secret made of 3+ short clean words would pass. Upgrade to Shannon entropy if either bites.
function looksRandom(run){
  if(/^[0-9a-f-]+$/i.test(run))return false; // git SHAs and hyphenated UUIDs
  const words=run.split(/[-_/]/);
  if(words.length>=3&&words.every(word=>SLUG_WORD.test(word)))return false; // branch names and paths
  return [/[a-z]/,/[A-Z]/,/\d/].filter(shape=>shape.test(run)).length>=2;
}

export const redactSecrets=text=>typeof text==='string'?text.replace(TOKEN_SHAPES,'[redacted]').replace(LONG_RUN,run=>looksRandom(run)?'[redacted]':run):'';

// Redact before capping so a cut cannot leave a recognisable token prefix behind.
export const titleText=(text,max=180)=>redactSecrets(clean(text,2000).replace(/[\s\x7f-\x9f]+/g,' ').trim()).slice(0,max);

const slashed=file=>file.replace(/\\/g,'/');
const isAbsolute=file=>/^(?:\/|[A-Za-z]:(?:\/|$))/.test(file);

export function relativePath(file,roots=[]){
  if(typeof file!=='string'||!file)return '';
  const normal=path.posix.normalize(slashed(file));
  for(const root of roots){
    const base=path.posix.normalize(slashed(root)).replace(/\/$/,'');
    if(normal.startsWith(base+'/'))return titleText(normal.slice(base.length+1),300);
  }
  if(!isAbsolute(normal)&&normal!=='..'&&!normal.startsWith('../'))return titleText(normal,300);
  const name=path.posix.basename(normal);
  return titleText(name&&!/^[A-Za-z]:$/.test(name)?name:'[path]',300);
}
