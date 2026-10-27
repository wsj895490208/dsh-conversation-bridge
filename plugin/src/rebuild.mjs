import {requireValue} from './util.mjs';

// Mirrors the pinned BasicCompactionEngine policy calculation. Execution always
// calls that native engine; this pure calculation only describes its preview.
export function requestBoundary(event){return event.type==='user/message'&&event.data.source?.kind==='user';}
export function appendSource(session,event){return session.append(event.type,event.data,...(event.surfaceOp?[{surfaceOp:event.surfaceOp,...(event.replaces?{replaces:event.replaces}:{})}]:[]));}
export function replayRecent(session){return session.deriveMessages().filter(m=>m.source?.kind==='user'||m.source?.kind==='model').map(m=>({...m,time:session.snapshotEvents().find(e=>e.data?.id===m.id||e.data?.message?.id===m.id)?.time}));}
export function sourceRecent(events){return events.filter(e=>e.type==='user/message'&&e.data.source?.kind==='user'||e.type==='assistant/message'&&e.data.message?.source?.kind==='model').map(e=>({... (e.type==='user/message'?e.data:e.data.message),time:new Date(e.time).toISOString()}));}

// The driver receives one prefix event at a time. The source archive/RAG and
// final tail are deliberately absent from the compactor's interface.
export async function replayPrefix({session,events,offset=0,finalBoundary=false,snapshot,meter,compact,checkpoint,progress,signal,restore,active=()=>true}){
  let sinceSave=0,count=0,finalPhase=finalBoundary==='open',pending=[];
  const flushHistory=()=>{if(!pending.length)return;if(restore){const prefix=[...session.snapshotEvents()];session=restore({header:session.header,events:[...prefix,...pending.map((e,i)=>({...e,seq:prefix.length+i}))]});}else for(const event of pending)appendSource(session,event);pending=[];};
  const pressure=async(cursor)=>{
    signal?.throwIfAborted();requireValue(active(),'job_paused','重建已暂停，已完成检查点保留');
    const before=meter.measure(session),result=await compact({session,cursor,sourceOffset:offset,recent:sourceRecent(session.snapshotEvents()),snapshot,signal});
    const after=meter.measure(session);if(result){count++;await checkpoint({session,offset,finalBoundary:finalPhase?'open':false,compacted:true,cursor,before:before.totalTokens,after:after.totalTokens,result});sinceSave=0;}
    await progress?.({offset,cursor,tokens:after.totalTokens,estimated:true});
  };
  for(;offset<events.length;){
    signal?.throwIfAborted();requireValue(active(),'job_paused','重建已暂停');
    const event=events[offset];pending.push(event);offset++;sinceSave++;
    if(requestBoundary(event)){
      flushHistory();
      const turn=session.snapshotEvents().findLast(e=>e.type==='turn/start')?.data.turn;
      session.append('request/header',{reason:session.requestHeader()?'series':'initial',header:{config:snapshot.route,...(snapshot.tools?.length?{tools:snapshot.tools}:{})}});
      await pressure(offset-1);
    }
    if(event.type==='turn/end'&&sinceSave>=120){flushHistory();await checkpoint({session,offset,finalBoundary:false,cursor:offset-1});sinceSave=0;}
  }
  flushHistory();
  // Price the final assistant reply at the next normal request boundary without
  // creating a user message or asking the model to generate a reply.
  if(finalBoundary==='open'){
    const turn=session.snapshotEvents().findLast(e=>e.type==='turn/start').data.turn;
    session.append('step/end',{turn,step:1});session.append('turn/end',{turn,reason:{kind:'completed'}});
  }else if(!finalBoundary&&meter.measure(session).totalTokens>=snapshot.thresholdTokens){
    finalPhase=true;
    const turn=(session.snapshotEvents().findLast(e=>e.type==='turn/start')?.data.turn||0)+1;
    session.append('turn/start',{turn});session.append('step/start',{turn,step:1});
    session.append('request/header',{reason:session.requestHeader()?'series':'initial',header:{config:snapshot.route,...(snapshot.tools?.length?{tools:snapshot.tools}:{})}});
    try{await pressure(events.length-1);}finally{session.append('step/end',{turn,step:1});session.append('turn/end',{turn,reason:{kind:'completed'}});}
  }
  await checkpoint({session,offset,finalBoundary:true,cursor:events.length-1});
  return {session,offset,finalBoundary:true,additionalCompactions:count,measurement:meter.measure(session)};
}
