import {resolve,join,isAbsolute,basename} from 'node:path';
import {homedir} from 'node:os';
import {BridgeService} from './service.mjs';
import {packageLoader,checkCompatibility} from './sdk.mjs';
import {createReplayHost} from './replay-host.mjs';
import {installInteraction,selectInteractionTools} from './interaction.mjs';
import {attachImported} from './attachments.mjs';
import {requireValue,publicError,id,BridgeError} from './util.mjs';
import Schema from '@deepseek-ai/schemastery';
import {locationFile,readLocation,saveLocation} from './location.mjs';

export const name='dsh-conversation-bridge';
export const Config=Schema.object({dataDir:Schema.string().default(''),modelCache:Schema.string().default('')});
export const inject=['connection','sessionPersistence','workspaceRegistry','agents','sessions','llm','tokenMeter','systemPrompt','agentPresets','attachments'];
export async function apply(ctx,config={}){
  const profile=basename(ctx.get('profileContext')?.dir||'desktop'),locationPath=locationFile(process.env,homedir(),profile),savedLocation=readLocation(locationPath);
  const load=packageLoader(),root=resolve(config.dataDir||process.env.DSH_CONVERSATION_BRIDGE_HOME||savedLocation.dataDir||join(process.env.DSH_HOME?.trim()||join(homedir(),'.dsh'),'conversation-bridge'));
  let compatibility;try{compatibility=await checkCompatibility(load);}catch(error){compatibility={compatible:false,error:publicError(error)};}
  const host={load,compatibility,tokenMeter:ctx.tokenMeter,
    isBusy(sessionId){const a=ctx.agents.get(sessionId);return a?.status==='running'||a?.status?.kind==='running'||a?.loop?.status==='running';},
    workspaces(){const list=ctx.workspaceRegistry.list(),defaultId=ctx.workspaceRegistry.state?.defaultWorkspaceId;return list.map(e=>({id:e.id,path:e.path,label:e.title,isDefault:e.id===defaultId}));},
    workspace(workspaceId){return host.workspaces().find(w=>w.id===workspaceId);},
    modelSources(){return(ctx.sessions.list?.()||[]).flatMap(s=>{const route={...s.requestHeader?.()?.config},options=ctx.agents.get(s.id)?.options;for(const key of ['provider','model','maxTokens','reasoningEffort','temperature','topP'])if(options?.[key]!==undefined)route[key]=options[key];return route.provider&&route.model?[{sessionId:s.id,label:`已载入会话 · ${s.id.slice(-8)}`,route}]:[];});},
    async readSession(sessionId){await ctx.sessionPersistence.flush();const handle=await ctx.sessionPersistence.open(sessionId,'read');try{return{header:handle.header,...await handle.read()};}finally{await handle.close();}},
    createReplayHost(service){return createReplayHost(ctx,service,load);},
    async importTools(candidate,bridge){
      const {createScope}=await load('dsh-scope'),key={},scope=createScope(ctx,key);
      try{await ctx.agentPresets.mount(scope.ctx,'conversation-bridge');const agent={id:candidate.header.id,ctx:scope.ctx,session:bridge.restore({header:candidate.header,events:[]}),options:{}};const assembled=await ctx.systemPrompt.assemble({scope:key,agent});return selectInteractionTools(assembled.tools,'chat');}finally{await scope.dispose();}
    },
    attachImported(candidate,items){return attachImported(ctx.attachments,candidate,items);},
    async archiveSession(sessionId){try{return await ctx.workspaceRegistry.archiveSession(sessionId,{stopActivity:true});}catch(error){if(error.name==='WorkspaceUnknownSessionError')return;throw error;}}
  };
  const service=new BridgeService(root,host,{modelCache:config.modelCache||savedLocation.modelCache||undefined}),{Service}=await load('cordis');
  new class extends Service{constructor(c){super(c,'conversationBridge');this.service=service;}}(ctx);
  ctx.effect(()=>()=>service.close(),'conversation bridge shutdown');installInteraction(ctx,service);
  ctx.on('session/event',(session,event)=>{try{service.capture(session,event);}catch(error){const c=service.bound(session.id);if(c)service.store.patch('conversation',c.id,{captureError:publicError(error)});}});
  ctx.on('agent/assistant-stream',({agent,frame})=>{const c=service.bound(agent.id,agent.session.header.cwd);if(!c)return;if(frame.type==='start')service.store.put('snapshot',{id:id('snapshot'),conversationId:c.id,at:new Date().toISOString(),requestHeader:agent.session.requestHeader(),messages:agent.session.deriveMessages(),kind:'canonical-adapter-input'});});
  const routes=new Map();let mutations=Promise.resolve();
  const route=(path,method,handler,body='buffered')=>{let row=routes.get(path);if(!row){row={handlers:new Map(),body};routes.set(path,row);}row.handlers.set(method,async request=>{try{const url=new URL(request.url),payload=method==='POST'&&path!=='/upload'?await request.json():{};const execute=()=>handler(payload,url,request),data=method==='POST'&&!['/upload','/search'].includes(path)?await(mutations=mutations.catch(()=>{}).then(execute)):await execute();return Response.json({ok:true,data});}catch(error){return Response.json({ok:false,error:publicError(error)},{status:error.code==='not_found'?404:400});}});};
  route('/status','GET',()=>service.status());
  route('/upload','POST',async(_,u,r)=>service.upload(Buffer.from(await r.arrayBuffer()),{kind:u.searchParams.get('kind')||'json',name:u.searchParams.get('name')||'upload'}),'streaming');
  route('/scan','POST',p=>service.scan(p.uploadId));route('/scan','GET',(_,u)=>service.scanResult(u.searchParams.get('jobId')));route('/scan/state','GET',(_,u)=>service.scanState(u.searchParams.get('jobId')));
  route('/import/preview','POST',p=>service.importPreview(p));route('/import/confirm','POST',p=>service.confirmImport(p));route('/attachment','POST',p=>service.mapAttachment(p));
  route('/job','POST',p=>service.controlJob(p.jobId,p.action));route('/conversation','GET',(_,u)=>service.details(u.searchParams.get('conversationId')));route('/conversation/remove','POST',p=>service.removeConversation(p));
  route('/search','POST',p=>service.search(p.conversationId,p.query));route('/memories','GET',(_,u)=>{const c=u.searchParams.get('conversationId');return{items:service.index(c).list({query:u.searchParams.get('q')||'',limit:100}),health:service.index(c).health()};});
  route('/interaction','GET',(_,u)=>{const c=service.bound(u.searchParams.get('sessionId'));return c?{available:true,conversationId:c.id,mode:c.mode,disabled:c.status!=='ready',busy:host.isBusy(c.sessionId)}:{available:false};});route('/interaction','POST',async p=>{const c=await service.setMode(p);return{available:true,conversationId:c.id,mode:c.mode,disabled:false,busy:false};});
  route('/settings','POST',p=>service.setSettings(p));
  route('/storage','POST',async p=>{
    requireValue(typeof p.dataDir==='string'&&isAbsolute(p.dataDir)&&(!p.modelCache||isAbsolute(p.modelCache)),'invalid_path','请选择绝对数据目录和模型目录');
    requireValue(!service.store.all('job').some(j=>j.status==='running')&&!service.store.all('conversation').some(c=>host.isBusy(c.sessionId)),'busy','请等任务及会话空闲后调整目录');
    const editor=ctx.get('configEditor'),entry=editor?.entries().find(e=>e.options.id===name&&e.options.name===name);requireValue(editor&&entry,'configuration_unavailable','当前宿主没有提供本插件的官方配置入口');
    try{await editor.edit(entry,current=>({...current,dataDir:resolve(p.dataDir),modelCache:p.modelCache?resolve(p.modelCache):''}));return {saved:true,restartRequired:false,note:'已通过原生配置服务更新。旧目录数据保留，不自动搬迁。'};}
    catch(error){
      if(!String(error.message).includes('requires the root Include entry'))throw new BridgeError('configuration_failed','存储设置未保存：'+String(error.message).slice(0,400));
      requireValue(!config.dataDir&&!process.env.DSH_CONVERSATION_BRIDGE_HOME,'configuration_unavailable','宿主不支持在线重载，请先在原生配置中清空显式数据目录覆盖，再使用插件存储设置');
      const saved=saveLocation(locationPath,p);return {saved:true,restartRequired:true,location:saved,note:'当前宿主不支持此配置的在线重载。已保存插件启动设置；正常退出并重新打开 Harness 后生效。旧数据保留，不自动搬迁。'};
    }
  });
  for(const [path,row]of routes)ctx.connection.fetch.register({path:'/api/conversation-bridge/v1'+path,methods:[...row.handlers.keys()],requestBody:row.body,fetch:request=>row.handlers.get(request.method)(request)});
  // Run recovery after the loader has finished mounting this preset and routes.
  const timer=setTimeout(()=>service.recover().catch(error=>service.store.put('state',{id:'recovery-error',error:publicError(error)})),1000);timer.unref();ctx.effect(()=>()=>clearTimeout(timer));
}
