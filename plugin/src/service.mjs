import {existsSync,readFileSync,copyFileSync,appendFileSync,rmSync} from 'node:fs';
import {join,basename,resolve} from 'node:path';
import {Store} from './store.mjs';
import {MemoryIndex} from './memory.mjs';
import {SemanticWorker} from './semantic.mjs';
import {ensureModel,modelFingerprint,modelPin,hasBundledModel} from './models.mjs';
import {messageBody} from './importer.mjs';
import {runImportWorker} from './import-task.mjs';
import {nativeSession} from './native.mjs';
import {replayPrefix} from './rebuild.mjs';
import {BridgeError,requireValue,hash,id,directory,inside,writeJson,readJson,publicError,mergeRrf} from './util.mjs';

const now=()=>new Date().toISOString();
const textOf=m=>(m?.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('\n');
export const defaults={preparationInput:2000000,preparationOutput:200000,recallWaitMs:3000,recallCharacters:6000};
export function normalizeUsage(u){return u?{input:(u.inputTokens??u.input_tokens??0)+(u.cacheReadTokens??0)+(u.cacheWriteTokens??0),output:u.outputTokens??u.output_tokens??0}:null;}

export class BridgeService{
  constructor(root,host={},options={}){
    this.root=directory(resolve(root));this.host=host;this.modelCache=options.modelCache||join(this.root,'models',modelFingerprint.slice(0,16));
    for(const folder of ['imports','archives','conversations','exports'])directory(join(this.root,folder));
    this.store=new Store(this.root);this.semantic=options.semantic||new SemanticWorker(this.modelCache);this.indices=new Map();this.controllers=new Map();this.running=new Map();this.replayScopes=new Map();this.bridgePromise=null;this.closed=false;
    if(!this.store.get('settings','settings',false))this.store.put('settings',{id:'settings',...defaults});
    for(const attempt of this.store.all('summary-attempt'))if(attempt.status==='requested'){this.store.patch('summary-attempt',attempt.id,{status:'unknown',error:{code:'summary_outcome_unknown',message:'上次摘要调用结果不明确，重试可能再次计费，请检查后明确重试'}});if(attempt.reservation)this.store.reconcile(attempt.reservation,null);}
    for(const job of this.store.all('job'))if(job.status==='running'){const unknown=this.store.all('summary-attempt').some(a=>a.jobId===job.id&&a.status==='unknown');this.store.patch('job',job.id,{status:unknown?'waiting':'queued',message:unknown?'上次模型调用结果不明确，等待检查':'重启后从检查点继续'});}
  }
  settings(){return this.store.get('settings','settings');}
  setSettings(input){const next={};for(const key of Object.keys(defaults))if(input[key]!==undefined){const n=Number(input[key]);requireValue(Number.isSafeInteger(n)&&n>=0&&n<=100000000,'invalid_setting','设置必须为有效非负整数');next[key]=n;}requireValue((next.recallWaitMs??this.settings().recallWaitMs)<=3000&&(next.recallCharacters??this.settings().recallCharacters)<=6000,'invalid_setting','检索最多等待3秒、返回6000字符');return this.store.patch('settings','settings',next);}
  status(){return {version:'0.2.0',root:this.root,modelCache:this.modelCache,modelDelivery:{bundled:hasBundledModel(),id:modelPin.id,bytes:Object.values(modelPin.files).reduce((n,f)=>n+f.bytes,0),fingerprint:modelFingerprint,downloadRequired:false},compatibility:this.host.compatibility,settings:this.settings(),conversations:this.store.all('conversation').map(c=>({...c,busy:!!this.host.isBusy?.(c.sessionId)})),jobs:this.store.all('job'),workspaces:this.host.workspaces?.()||[],modelSources:this.host.modelSources?.()||[],usage:this.store.usageDetails('preparation'),modelProgress:this.store.get('state','model',false)};}
  upload(bytes,{kind='json',name='upload'}={}){
    requireValue(['json','attachment'].includes(kind),'invalid_upload','不支持的上传类型');requireValue(bytes.length>0&&bytes.length<=200*1024*1024,'file_too_large','文件为空或超过200MiB');
    const digest=hash(bytes),file=inside(this.root,'imports',digest+(kind==='json'?'.json':'.bin'));if(!existsSync(file))copyBytes(file,bytes);
    return this.store.put('upload',{id:digest,kind,name:basename(name),file,sha256:digest,bytes:bytes.length,createdAt:now()});
  }
  job(type,payload){
    if(type==='index')payload={...payload,modelFingerprint};
    if(payload.conversationId)requireValue(!this.store.get('removed',payload.conversationId,false),'conversation_removed','会话已移除');
    const old=this.store.all('job').find(j=>j.type===type&&JSON.stringify(j.payload)===JSON.stringify(payload)&&['queued','running','paused','waiting','failed'].includes(j.status));if(old)return old;
    const job=this.store.create('job',{type,payload,status:'queued',done:0,total:0,offset:0,message:'排队中'});queueMicrotask(()=>this.kick());return job;
  }
  scan(uploadId){const u=this.store.get('upload',uploadId);requireValue(u.kind==='json','invalid_upload','请选择 JSON');const done=this.store.all('job').find(j=>j.type==='scan'&&j.payload.uploadId===uploadId&&j.status==='completed'&&existsSync(j.resultFile));return done||this.job('scan',{uploadId});}
  scanState(jobId){const j=jobId?this.store.get('job',jobId):this.store.all('job').find(j=>j.type==='scan');return j?{...j,upload:this.store.get('upload',j.payload.uploadId),waitsForIndex:false,lane:'local-parse'}:null;}
  scanResult(jobId){const j=this.store.get('job',jobId);requireValue(j.status==='completed'&&j.resultFile,'not_ready','解析尚未完成');return readJson(inside(this.root,j.resultFile));}
  bridge(){return this.bridgePromise??=this.host.createReplayHost(this);}
  async importPreview({uploadId,conversationId,leaf,referenceSessionId,workspaceId}){
    requireValue(this.host.compatibility?.compatible,'unsupported_host','宿主兼容性检查未通过');const u=this.store.get('upload',uploadId);requireValue(u.kind==='json'&&hash(readFileSync(inside(this.root,u.file)))===u.sha256,'hash_changed','导入原件已改变');
    const workspace=this.host.workspace(workspaceId);requireValue(workspace,'workspace_missing','请选择已登记工作区');
    const selected=await runImportWorker('selected',{path:u.file,conversationId,leaf}),bridge=await this.bridge(),previewId=id('preview');
    const candidate=nativeSession(selected.messages,workspace.path,`session-${hash(previewId).slice(0,24)}`),tools=await this.host.importTools(candidate,bridge);
    const model=await bridge.snapshot(referenceSessionId,tools),preview=await bridge.preview(candidate,model);
    return this.store.put('preview',{id:previewId,uploadId,conversationId,leaf:String(leaf),referenceSessionId,workspaceId,workspace:workspace.path,sourceHash:u.sha256,selectedHash:hash(JSON.stringify(selected)),statistics:selected.statistics,attachments:selected.attachments,model,...preview,createdAt:now()});
  }
  async confirmImport({previewId,requestId,label}){
    requireValue(typeof requestId==='string'&&requestId.length>=8&&requestId.length<160,'invalid_request','确认请求缺少有效标识');
    requireValue(!this.store.get('removed-request',requestId,false),'conversation_removed','此确认请求对应的会话已移除；主动重新导入请重新预演');
    const previous=this.store.get('request',requestId,false);if(previous){requireValue(previous.previewId===previewId,'request_conflict','确认请求对应其他预演');requireValue(!this.store.get('removed',previous.conversationId,false),'conversation_removed','会话已移除');return {...previous,conversation:this.store.get('conversation',previous.conversationId)};}
    const p=this.store.get('preview',previewId),u=this.store.get('upload',p.uploadId),bridge=await this.bridge();
    requireValue(hash(readFileSync(u.file))===p.sourceHash,'hash_changed','原件已改变，请重新上传');const workspace=this.host.workspace(p.workspaceId);requireValue(workspace?.path===p.workspace,'preview_stale','工作区已改变，请重新预演');
    const selected=await runImportWorker('selected',{path:u.file,conversationId:p.conversationId,leaf:p.leaf});requireValue(hash(JSON.stringify(selected))===p.selectedHash,'hash_changed','选定分支已改变');
    const candidate=nativeSession(selected.messages,p.workspace),tools=await this.host.importTools(candidate,bridge),current=await bridge.snapshot(p.referenceSessionId,tools);requireValue(current.sha256===p.model.sha256,'preview_stale','模型、工具或压缩配置已改变，请重新预演');
    const fingerprint=hash(JSON.stringify([p.sourceHash,p.conversationId,p.leaf])),archiveId='archive-'+fingerprint.slice(0,24),archivePath=directory(inside(this.root,'archives',archiveId));
    if(!this.store.get('archive',archiveId,false)){copyFileSync(u.file,join(archivePath,'original.json'));writeJson(join(archivePath,'selected.json'),selected);this.store.put('archive',{id:archiveId,path:archivePath,sourceHash:p.sourceHash,attachments:p.attachments,statistics:selected.statistics});}
    const cId=id('conversation'),path=directory(inside(this.root,'conversations',cId));writeJson(join(path,'source.json'),candidate);
    const c=this.store.put('conversation',{id:cId,archiveId,previewId,path,sessionId:candidate.header.id,workspaceId:p.workspaceId,workspace:p.workspace,attachments:structuredClone(p.attachments),status:'preparing',mode:'chat',label:typeof label==='string'&&label.trim()?label.trim().slice(0,120):selected.conversation.title||'导入会话',statistics:selected.statistics,createdAt:now(),sourceOffset:0,compactions:0,indexState:'queued'});
    this.store.put('binding',{id:c.sessionId,conversationId:c.id,cwd:c.workspace});
    const job=this.job('prepare',{conversationId:c.id}),record=this.store.put('request',{id:requestId,previewId,conversationId:c.id,jobId:job.id});this.store.patch('conversation',c.id,{jobId:job.id});return {...record,conversation:c,job};
  }
  index(conversationId){const c=this.store.get('conversation',conversationId);if(!this.indices.has(c.id))this.indices.set(c.id,new MemoryIndex(inside(this.root,c.path,'memory.sqlite')));return this.indices.get(c.id);}
  selected(c){const a=this.store.get('archive',c.archiveId);return readJson(inside(this.root,a.path,'selected.json'));}
  bound(sessionId,cwd){const b=this.store.get('binding',sessionId,false),c=b&&this.store.get('conversation',b.conversationId,false);if(!c||this.store.get('removed',c.id,false))return null;if(cwd&&resolve(cwd).toLowerCase()!==resolve(b.cwd).toLowerCase())return null;return c;}
  async nativeSummary(replay,input,generate,signal){
    const key='summary-'+hash(JSON.stringify([replay.conversationId,replay.cursor,replay.snapshot.sha256,input]));const cached=this.store.get('summary',key,false);if(cached?.status==='success')return cached.result;
    const unknown=this.store.all('summary-attempt').find(a=>a.cacheKey===key&&a.status==='unknown'&&!a.retryAuthorized);requireValue(!unknown,'summary_outcome_unknown','此前调用结果不明确，需在任务页检查并明确重试');signal?.throwIfAborted();
    const attempt=this.store.create('summary-attempt',{cacheKey:key,conversationId:replay.conversationId,jobId:replay.jobId,cursor:replay.cursor,status:'preparing'});
    replay.attempt=attempt;replay.reservation=null;replay.usage=null;replay.started=false;
    try{
      const result=await generate();if(replay.reservation)this.store.reconcile(replay.reservation,normalizeUsage(result.usage));
      this.store.put('summary',{id:key,status:'success',conversationId:replay.conversationId,cursor:replay.cursor,sourceOffset:replay.sourceOffset,inputIds:input.messages.map(m=>m.id),inputHash:hash(JSON.stringify(input.messages)),result,at:now()});
      this.store.patch('summary-attempt',attempt.id,{status:'success',usage:result.usage||null});return result;
    }catch(error){const usage=normalizeUsage(replay.usage);if(replay.reservation)this.store.reconcile(replay.reservation,usage);this.store.patch('summary-attempt',attempt.id,{status:!replay.started||usage?'failed':'unknown',usage,error:publicError(error)});throw error;}
  }
  reserveNativeCall(replay,options){
    requireValue(replay.attempt&&!replay.started,'summary_state','摘要计量状态无效');const settings=this.settings();
    // This is the factory's actual call, including its unchanged final directive.
    const input=options.messages.reduce((n,m)=>n+this.host.tokenMeter.estimateMessage(m),0);
    const reservation=this.store.reserve('preparation',input,options.maxTokens,{input:settings.preparationInput,output:settings.preparationOutput},{runId:replay.conversationId,jobId:replay.jobId});
    replay.reservation=reservation;replay.started=true;this.store.patch('summary-attempt',replay.attempt.id,{status:'requested',reservation});
  }
  kick(){if(this.closed)return;for(const lane of ['scan','background']){if(this.running.has(lane))continue;const job=[...this.store.all('job')].reverse().find(j=>j.status==='queued'&&(j.type==='scan'?'scan':'background')===lane);if(!job)continue;const controller=new AbortController();this.controllers.set(job.id,controller);const promise=this.runJob(job,controller.signal).finally(()=>{this.running.delete(lane);this.controllers.delete(job.id);queueMicrotask(()=>this.kick());});this.running.set(lane,promise);}}
  active(job){return !this.closed&&this.store.get('job',job.id,false)?.status==='running';}
  async runJob(job,signal){
    this.store.patch('job',job.id,{status:'running',startedAt:now(),error:null});
    try{await this.execute({...job,signal});if(this.active(job))this.store.patch('job',job.id,{status:'completed',completedAt:now()});}
    catch(error){const current=this.store.get('job',job.id,false);if(!current||['paused','cancelled'].includes(current.status)||this.closed)return;const unknown=this.store.all('summary-attempt').some(a=>a.jobId===job.id&&a.status==='unknown'&&!a.retryAuthorized);const status=unknown||error.code==='quota_exceeded'?'waiting':'failed';this.store.patch('job',job.id,{status,error:publicError(error),message:unknown?'模型调用结果不明确，等待检查':error.code==='quota_exceeded'?'导入准备额度不足，等待调整或次日重试':publicError(error).message});}
  }
  async execute(job){
    if(job.type==='scan'){const u=this.store.get('upload',job.payload.uploadId);requireValue(hash(readFileSync(u.file))===u.sha256,'hash_changed','上传副本校验失败');this.store.patch('job',job.id,{message:'正在解析对话与分支（独立队列）'});const result=await runImportWorker('scan',{path:u.file},{signal:job.signal}),file=join(this.root,'imports',job.id+'.scan.json');writeJson(file,result);this.store.patch('job',job.id,{resultFile:file,message:'解析完成'});return;}
    if(job.type==='index')return this.buildIndex(job.payload.conversationId,job);
    requireValue(job.type==='prepare','invalid_job','未知任务类型');const c=this.store.get('conversation',job.payload.conversationId);requireValue(c.status==='preparing'&&!this.store.get('removed',c.id,false),'conversation_disabled','会话未处于准备状态');
    const bridge=await this.bridge(),preview=this.store.get('preview',c.previewId),source=readJson(inside(this.root,c.path,'source.json')),checkpointFile=join(c.path,'checkpoint.json');
    if(!existsSync(checkpointFile)){
      const archive=this.store.get('archive',c.archiveId);await this.host.attachImported?.(source,c.attachments||archive.attachments);writeJson(join(c.path,'source.json'),source);
    }
    const selected=this.selected(c);this.index(c.id).seed(selected.messages,messageBody);
    const saved=existsSync(checkpointFile)?readJson(checkpointFile):{header:source.header,events:[],offset:0,finalBoundary:false};let session=bridge.restore(saved);
    if(saved.events.length)await bridge.sync(saved);this.store.patch('job',job.id,{phase:'rebuild',message:'按原生规则重建上下文'});
    const result=await replayPrefix({session,events:source.events,offset:saved.offset,finalBoundary:saved.finalBoundary,snapshot:preview.model,meter:bridge.meter,restore:bridge.restore,signal:job.signal,active:()=>this.active(job),
      compact:args=>bridge.compact({...args,conversationId:c.id,jobId:job.id}),
      progress:info=>{this.store.patch('conversation',c.id,{sourceOffset:info.offset,sourceNode:source.mapping[info.cursor]?.node,windowTokens:info.tokens});this.store.patch('job',job.id,{done:info.offset,total:source.events.length,message:`重建上下文 · 源节点 ${source.mapping[info.cursor]?.node||'末尾'} · 估算 ${info.tokens} token`});},
      checkpoint:async info=>{session=info.session;const cp={header:session.header,events:[...session.snapshotEvents()],offset:info.offset,finalBoundary:info.finalBoundary};writeJson(checkpointFile,cp);await bridge.sync(cp);const compactions=cp.events.filter(e=>e.type==='compaction/summary').length;this.store.patch('conversation',c.id,{compactions,sourceOffset:info.offset});if(info.compacted)this.store.put('checkpoint',{id:`${c.id}-${compactions}`,conversationId:c.id,cursor:info.cursor,sourceNode:source.mapping[info.cursor]?.node,before:info.before,after:info.after,events:cp.events.length,strategy:preview.model.strategy});}
    });
    job.signal.throwIfAborted();this.store.patch('conversation',c.id,{contextReady:true,windowTokens:result.measurement.totalTokens});
    await this.buildIndex(c.id,job);job.signal.throwIfAborted();const health=this.index(c.id).health();requireValue(health.ready,'index_incomplete','索引未通过完整性核验');
    const final=readJson(checkpointFile),validation=await bridge.finish(final,c.workspaceId);this.store.patch('conversation',c.id,{status:'ready',indexState:'ready',liveStartSeq:final.events.length,validation,readyAt:now()});this.store.patch('job',job.id,{phase:'done',message:'原生回读、上下文和索引已通过，可直接续聊',result:{conversationId:c.id,sessionId:c.sessionId}});
  }
  async buildIndex(conversationId,job){
    const c=this.store.get('conversation',conversationId),index=this.index(c.id);this.store.patch('job',job.id,{phase:'model',message:'从安装包自动准备并校验本地模型（无需联网）'});
    await (this.host.ensureModel||ensureModel)(this.modelCache,{signal:job.signal,progress:p=>{this.store.put('state',{id:'model',...p});}});
    this.store.patch('job',job.id,{phase:'index',message:'正在建立本会话索引'});let offset=job.type==='index'&&index.vectorModel()===modelFingerprint?job.offset||0:0;
    for(;;){job.signal.throwIfAborted();requireValue(this.active(job),'job_paused','索引任务已暂停');const out=await this.semantic.call('batch',{file:index.file,offset,limit:8});offset=out.nextOffset;this.store.patch('job',job.id,{offset,done:offset,total:index.stats().total,message:`整理记忆 · 已检查 ${offset} 条原文`});if(out.done&&offset>=index.stats().total)break;}
    const health=index.health();requireValue(health.ready,'index_incomplete','向量索引不完整',{health});this.store.patch('conversation',c.id,{indexState:'ready',indexCheckedAt:now()});
  }
  async controlJob(jobId,action){
    requireValue(['pause','resume','retry','cancel'].includes(action),'invalid_action','未知任务操作');const job=this.store.get('job',jobId);if(job.payload.conversationId)requireValue(!this.store.get('removed',job.payload.conversationId,false),'conversation_removed','会话已移除');
    if(['pause','cancel'].includes(action)){this.store.patch('job',jobId,{status:action==='pause'?'paused':'cancelled'});this.controllers.get(jobId)?.abort();const lane=job.type==='scan'?'scan':'background';if(this.running.has(lane))await this.running.get(lane);return this.store.get('job',jobId);}
    requireValue(!['completed','running'].includes(job.status),'invalid_action','该任务不能重试');
    for(const a of this.store.all('summary-attempt'))if(a.jobId===jobId&&a.status==='unknown')this.store.patch('summary-attempt',a.id,{retryAuthorized:true,retryAuthorizedAt:now()});
    this.store.patch('job',jobId,{status:'queued',error:null,message:'等待继续'});this.kick();return this.store.get('job',jobId);
  }
  capture(session,event){
    const c=this.bound(session.id,session.header.cwd);if(!c||c.status!=='ready'||event.seq<(c.liveStartSeq??Infinity))return;
    const message=event.type==='user/message'?event.data:event.type==='assistant/message'?event.data.message:null;if(!message||!['user','model'].includes(message.source?.kind))return;
    const eventId=`${session.id}:${event.seq}`;if(this.store.get('captured',eventId,false))return;
    appendFileSync(inside(this.root,c.path,'new-events.jsonl'),JSON.stringify(event)+'\n');const body=textOf(message);this.index(c.id).insert({id:message.id,node:message.id,role:message.role,time:new Date(event.time).toISOString(),body,source:'new-chat'});this.store.put('captured',{id:eventId,conversationId:c.id,seq:event.seq});
    const blocked=this.store.all('job').find(j=>j.type==='index'&&j.payload.conversationId===c.id&&['failed','waiting','paused'].includes(j.status));if(!blocked)this.job('index',{conversationId:c.id});
  }
  async recover(){
    for(const c of this.store.all('conversation').filter(c=>c.status==='ready')){
      try{const saved=await this.host.readSession(c.sessionId);for(const e of saved.events)this.capture({id:c.sessionId,header:saved.header},e);}catch(error){this.store.patch('conversation',c.id,{captureError:publicError(error)});}
      const health=this.index(c.id).health();
      if(health.documents>0&&!health.modelMatches){this.store.patch('conversation',c.id,{indexState:'rebuilding',indexReason:'模型版本已更新，后台重建向量；原文保留，期间可用全文检索'});this.job('index',{conversationId:c.id});}
    }
    this.kick();
  }
  async search(conversationId,query){
    requireValue(typeof query==='string'&&query.trim()&&query.length<=1600,'invalid_query','查询须为1—1600字符');const c=this.store.get('conversation',conversationId);requireValue(!this.store.get('removed',c.id,false),'conversation_removed','会话已移除');const index=this.index(c.id),lexical=index.lexical(query,10);let timer;
    try{const vector=await Promise.race([this.semantic.call('search',{file:index.file,query,limit:10}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('timeout')),this.settings().recallWaitMs);})]);return {hits:mergeRrf([lexical,vector],5),mode:'hybrid'};}catch{return {hits:lexical.slice(0,5),mode:'full-text',degraded:'向量暂不可用，已使用全文检索'};}finally{clearTimeout(timer);}
  }
  async memorySearch(sessionId,cwd,query){
    const c=this.bound(sessionId,cwd);requireValue(c?.status==='ready','memory_unavailable','当前会话没有就绪的专属记忆库');const result=await this.search(c.id,query),hits=[],limit=this.settings().recallCharacters;
    const out={kind:'historical-quotes',query,hits,mode:result.mode,...(result.degraded?{degraded:result.degraded}:{})};
    for(const h of result.hits){const hit={role:h.role,time:h.time,node:h.node,category:h.role==='assistant'?'assistant_expression':'user_statement',status:'historical',text:h.body};hits.push(hit);if(JSON.stringify(out).length>limit){hits.pop();const room=limit-JSON.stringify(out).length-220;if(room>0){hit.text=hit.text.slice(0,room);hit.partial=true;hits.push(hit);}break;}}
    this.store.create('rag-call',{conversationId:c.id,query,nodes:hits.map(h=>h.node),mode:result.mode});return out;
  }
  async setMode({conversationId,mode}){requireValue(['chat','engineering'].includes(mode),'invalid_mode','请选择对话或工程模式');const c=this.store.get('conversation',conversationId);requireValue(c.status==='ready','conversation_disabled','会话尚未就绪');requireValue(!this.host.isBusy?.(c.sessionId),'busy','请等待当前回复和工具完成');return this.store.patch('conversation',c.id,{mode});}
  details(conversationId){const c=this.store.get('conversation',conversationId);return {conversation:c,health:this.index(c.id).health(),preview:this.store.get('preview',c.previewId),checkpoints:this.store.all('checkpoint').filter(x=>x.conversationId===c.id),attempts:this.store.all('summary-attempt').filter(x=>x.conversationId===c.id),ragCalls:this.store.all('rag-call').filter(x=>x.conversationId===c.id)};}
  async mapAttachment({previewId,fileId,uploadId}){
    const p=this.store.get('preview',previewId),u=this.store.get('upload',uploadId);requireValue(u.kind==='attachment','invalid_upload','请选择附件');const item=p.attachments.find(a=>a.file_id===fileId);requireValue(item,'not_found','附件标识不存在');requireValue(item.file_size==null||item.file_size===u.bytes,'attachment_size_mismatch','附件大小与导出记录不一致');
    const attachments=p.attachments.map(a=>a.file_id===fileId?{...a,status:'available',path:u.file,sha256:u.sha256}:a);return this.store.patch('preview',p.id,{attachments});
  }
  async removeConversation({conversationId}){
    const old=this.store.get('removed',conversationId,false);if(old?.status==='removed')return old;const c=this.store.get('conversation',conversationId);requireValue(!this.host.isBusy?.(c.sessionId),'busy','请等会话空闲后移除');
    this.store.put('removed',{id:c.id,sessionId:c.sessionId,status:'removing'});
    for(const j of this.store.all('job').filter(j=>j.payload.conversationId===c.id)){this.store.patch('job',j.id,{status:'cancelled'});this.controllers.get(j.id)?.abort();}
    await Promise.allSettled([...this.running.values()]);await this.host.archiveSession(c.sessionId);await this.semantic.call('barrier');this.indices.get(c.id)?.close();this.indices.delete(c.id);
    const folder=inside(this.root,'conversations',c.id);requireValue(folder===resolve(c.path),'invalid_path','会话派生目录不匹配');rmSync(folder,{recursive:true,force:true});
    this.store.transaction(()=>{for(const request of this.store.all('request').filter(r=>r.conversationId===c.id))this.store.put('removed-request',{id:request.id});for(const kind of ['conversation','binding','captured','checkpoint','summary','summary-attempt','rag-call','request','snapshot','job'])for(const row of this.store.all(kind))if(row.id===c.id||row.conversationId===c.id||row.payload?.conversationId===c.id)this.store.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(kind,row.id);});
    return this.store.put('removed',{id:c.id,sessionId:c.sessionId,status:'removed'});
  }
  async close(){if(this.closed)return;this.closed=true;for(const c of this.controllers.values())c.abort();await Promise.allSettled([...this.running.values()]);await this.semantic.stop();if(this.bridgePromise)await(await this.bridgePromise).close();for(const index of this.indices.values())index.close();this.store.close();}
}
import {atomicFile} from './util.mjs';
const copyBytes=(file,bytes)=>atomicFile(file,bytes);
