import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { requireValue } from './util.mjs';

// Only official V4 fields. Plugin metadata belongs in SessionBinding, never in a host header.
export function nativeSession(messages,cwd,sessionId=`session-${randomUUID()}`) {
  requireValue(messages.length,'empty_branch','不能创建空迁移会话');
  const timestamps=messages.map(m=>Date.parse(m.time)).filter(Number.isFinite);
  const first=timestamps.length?Math.min(...timestamps):Date.now();
  const header={version:4,id:sessionId,createdAt:first,isSeeded:false,delegationDepth:0,cwd,agentPreset:'conversation-bridge'};
  const events=[],mapping=[];let turn=0,open=false;
  const append=(type,data,m,surface=false)=>{const seq=events.length;events.push({type,seq,time:Number.isFinite(Date.parse(m?.time))?Date.parse(m.time):first,data,...(surface?{surfaceOp:'append'}:{})});mapping.push({seq,type,node:m?.nodeId??null,index:m?.index??null,turn});};
  const finish=m=>{if(open){append('step/end',{turn,step:1},m);append('turn/end',{turn,reason:{kind:'completed'}},m);open=false;}};
  for(const m of messages){
    if(m.role==='user'||!open){finish(m);turn++;open=true;append('turn/start',{turn},m);append('step/start',{turn,step:1},m);if(turn===1)append('system/message',{turn,step:1,message:{id:`${sessionId}-system`,role:'system',source:{kind:'system-prompt'},content:[]}},m,true);}
    const message={id:`${sessionId}-node-${m.nodeId}`,role:m.role,source:m.role==='user'?{kind:'user'}:{kind:'model',provider:'deepseek-web-export',model:m.model||'unknown'},content:m.visible.map(f=>({type:'text',text:f.type==='FILE'?(f.files||[]).map(a=>`[历史附件元数据：文件名=${JSON.stringify(a.file_name)}；ID=${a.file_id}；大小=${a.file_size}字节。是否附入本体请以真实附件块为准，不得从元数据臆测正文。]`).join('\n'):f.content}))};
    if(m.role==='user')append('user/message',message,m,true);else append('assistant/message',{turn,step:1,message,stream:[]},m,true);
  }finish(messages.at(-1));return {header,events,mapping};
}
export async function validateNative(candidate,load) {
  const [{sessionFormatCatalog:catalog},{Session,SessionId,SessionLogOffset},{currentSessionMessageProjections}, {validateStoredEvents}]=await Promise.all([load('dsh-session-format-catalog'),load('dsh-session'),load('dsh-session-format-catalog','message-projections'),load('dsh-session-persistence')]);
  const restore=catalog.createRestore(catalog.encodeCurrentHeader(candidate.header,SessionLogOffset(0)),{recovery:'strict',validation:'current'});
  for(const e of candidate.events)restore.decodeRow(catalog.encodeCurrentEvent(e));const restored=restore.finish();
  validateStoredEvents(restored.header,restored.events,{kind:'bridge-validation',path:'in-memory'});
  const session=Session.fromRestore(SessionId(restored.header.id),restored.events,restored.header,SessionLogOffset(restored.inheritedEventCount),'detached',currentSessionMessageProjections);
  const actual=session.deriveMessages().filter(m=>m.role!=='system').map(({role,content})=>({role,content}));
  const expected=candidate.events.filter(e=>e.type==='user/message'||e.type==='assistant/message').map(e=>{const m=e.type==='user/message'?e.data:e.data.message;return {role:m.role,content:m.content};});
  requireValue(isDeepStrictEqual(actual,expected),'native_roundtrip_failed','原生会话回读与导入消息不一致');return {messages:actual.length,events:restored.events.length};
}
