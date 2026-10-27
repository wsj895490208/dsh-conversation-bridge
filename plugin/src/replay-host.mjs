import {isDeepStrictEqual} from 'node:util';
import {hash,requireValue} from './util.mjs';
import * as compactionPlugin from './compaction.mjs';

export function freezePolicy(route,info,config,tools=[]){
  const override=config.modelPolicies.find(p=>p.provider===route.provider&&p.model===route.model)||{};
  const pick=k=>override[k]??config[k];
  const contextWindow=info.context?.contextWindow,outputReservation=route.maxTokens??info.defaultMaxTokens??0;
  requireValue(Number.isSafeInteger(contextWindow)&&contextWindow>0,'model_capacity_missing','模型未提供有效上下文容量');
  const thresholdTokens=Math.floor(Math.min(contextWindow*pick('thresholdRatio'),contextWindow-outputReservation-pick('headroomTokens')));
  const retainTokens=override.retainTokens??(override.retainRatio!==undefined?Math.floor((contextWindow-outputReservation)*override.retainRatio):config.retainTokens??Math.floor((contextWindow-outputReservation)*config.retainRatio));
  requireValue(thresholdTokens>retainTokens&&thresholdTokens>0,'invalid_model_config','模型输出预留或压缩预算无效');
  const value={route,contextWindow,outputReservation,thresholdTokens,retainTokens,policy:config,tools,summaryMaxTokens:pick('maxTokens'),strategy:'dsh-compaction-basic/0.2.1-rc.3/default'};
  return {...value,sha256:hash(JSON.stringify(value)),estimated:true};
}
export async function createReplayHost(ctx,service,load,plugin=compactionPlugin){
  const [{Context,Service},{sessionFormatCatalog:catalog},{Session,SessionId,SessionLogOffset},{currentSessionMessageProjections},{validateStoredEvents}]=await Promise.all([load('cordis'),load('dsh-session-format-catalog'),load('dsh-session'),load('dsh-session-format-catalog','message-projections'),load('dsh-session-persistence')]);
  const privateCtx=new Context();
  class Llm extends Service{constructor(c){super(c,'llm');}resolveModelInfo(...a){return ctx.llm.resolveModelInfo(...a);}async *stream(options){const scope=service.replayScopes.get(options.sessionId);if(scope&&service.reserveNativeCall)service.reserveNativeCall(scope,options);for await(const chunk of ctx.llm.stream(options)){if(chunk.type==='usage'&&scope)scope.usage=chunk.usage;yield chunk;}}}
  class Meter extends Service{constructor(c){super(c,'tokenMeter');}measure(...a){return ctx.tokenMeter.measure(...a);}estimateMessage(...a){return ctx.tokenMeter.estimateMessage(...a);}}
  class Sessions extends Service{constructor(c){super(c,'sessions');}flush(){return ctx.sessionPersistence.flush();}}
  class Bridge extends Service{constructor(c){super(c,'conversationBridge');this.service=service;}}
  const scopes=[Llm,Meter,Sessions,Bridge].map(p=>privateCtx.plugin(p));for(const scope of scopes)await scope.await();
  const compactScope=privateCtx.plugin(plugin);await compactScope.await();
  function restore(candidate){
    const decoder=catalog.createRestore(catalog.encodeCurrentHeader(candidate.header,SessionLogOffset(0)),{recovery:'strict',validation:'current'});
    for(const event of candidate.events)decoder.decodeRow(catalog.encodeCurrentEvent(event));const restored=decoder.finish();
    validateStoredEvents(restored.header,restored.events,{kind:'bridge-reconstruction',path:'in-memory'});
    return Session.fromRestore(SessionId(candidate.header.id),restored.events,restored.header,SessionLogOffset(restored.inheritedEventCount),'detached',currentSessionMessageProjections);
  }
  async function sync(candidate){
    let handle,stored;
    try{handle=await ctx.sessionPersistence.open(candidate.header.id,'read');stored=await handle.read();}
    catch(e){if(e.code!=='ENOENT'&&!/not.found|does not exist|no such|unknown session/i.test(e.message))throw e;}
    finally{await handle?.close();}
    if(stored){requireValue(stored.events.length<=candidate.events.length&&stored.events.every((e,i)=>isDeepStrictEqual(e,candidate.events[i])),'checkpoint_conflict','原生记录与重建检查点不一致，未覆盖已有记录');handle=await ctx.sessionPersistence.open(candidate.header.id,'write');}else handle=await ctx.sessionPersistence.create(candidate.header);
    try{const appended=candidate.events.slice(stored?.events.length||0);if(appended.length)await handle.append(appended);await handle.flush();}finally{await handle.close();}
    const reader=await ctx.sessionPersistence.open(candidate.header.id,'read');try{const actual=await reader.read();requireValue(isDeepStrictEqual(actual.events,candidate.events),'native_readback_failed','原生会话回读不一致');}finally{await reader.close();}
  }
  async function snapshot(referenceSessionId,tools){
    const agent=ctx.agents.get(referenceSessionId);let header=agent?.session.requestHeader?.();
    if(!header&&!(agent?.options?.provider&&agent?.options?.model)){const saved=await service.host.readSession(referenceSessionId);header=saved.events.findLast(e=>e.type==='request/header')?.data.header;}
    const route={...header?.config};for(const key of ['provider','model','maxTokens','reasoningEffort','temperature','topP'])if(agent?.options?.[key]!==undefined)route[key]=agent.options[key];
    requireValue(route.provider&&route.model,'no_route','请选择已配置模型的 DSH 会话作为设置来源');
    const prepared=await ctx.llm.prepareCall(route),info=await ctx.llm.resolveModelInfo(prepared.config.provider,prepared.config.model);
    return {...freezePolicy(prepared.config,info,privateCtx.compaction.config,tools),referenceSessionId};
  }
  return {
    restore,sync,meter:ctx.tokenMeter,snapshot,
    async preview(candidate,snapshot){
      let session=restore({header:candidate.header,events:[]}),firstTrigger=null,pending=[],measurement;
      const flush=()=>{if(!pending.length)return;const prefix=[...session.snapshotEvents()];session=restore({header:session.header,events:[...prefix,...pending.map((e,i)=>({...e,seq:prefix.length+i}))]});pending=[];};
      for(let offset=0;offset<candidate.events.length;offset++){
        const e=candidate.events[offset];pending.push(e);
        if(e.type==='user/message'&&e.data.source?.kind==='user'){
          flush();session.append('request/header',{reason:session.requestHeader()?'series':'initial',header:{config:snapshot.route,tools:snapshot.tools}});measurement=ctx.tokenMeter.measure(session);
          if(measurement.totalTokens>=snapshot.thresholdTokens){firstTrigger={sourceOffset:offset,node:candidate.mapping.find(m=>m.seq===offset)?.node,tokens:measurement.totalTokens,boundary:'user-request'};break;}
        }
      }
      if(!firstTrigger){flush();measurement=ctx.tokenMeter.measure(session);if(measurement.totalTokens>=snapshot.thresholdTokens)firstTrigger={sourceOffset:candidate.events.length,node:candidate.mapping.at(-1)?.node,tokens:measurement.totalTokens,boundary:'next-request'};}
      return {firstTrigger,requiresSummary:!!firstTrigger,estimatedTokens:measurement.totalTokens,subsequentCompactions:null,finalWindowTokens:firstTrigger?null:measurement.totalTokens,modelCalls:0,estimated:true};
    },
    async compact({session,cursor,sourceOffset,snapshot,signal,conversationId,jobId}){
      const info=await ctx.llm.resolveModelInfo(snapshot.route.provider,snapshot.route.model),current=freezePolicy(snapshot.route,info,privateCtx.compaction.config,snapshot.tools);
      requireValue(current.sha256===snapshot.sha256,'model_config_changed','模型容量或原生压缩配置已变化，请重新预演');
      const agent={id:session.id,session,options:snapshot.route};service.replayScopes.set(session.id,{conversationId,jobId,cursor,sourceOffset,snapshot});
      try{return await privateCtx.compaction.compactIfNeeded(agent,'pressure',signal);}finally{service.replayScopes.delete(session.id);}
    },
    async finish(candidate,workspaceId){await sync(candidate);const entity=ctx.workspaceRegistry.get(workspaceId);requireValue(entity&&entity.path===candidate.header.cwd,'workspace_changed','工作区已改变');await entity.attachSession(candidate.header.id);return {workspaceId:entity.id,readBackEvents:candidate.events.length,contextMessages:restore(candidate).deriveMessages().length};},
    async close(){await compactScope.dispose();for(const scope of scopes.reverse())await scope.dispose();}
  };
}
