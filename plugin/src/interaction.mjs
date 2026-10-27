export const memoryToolName='memory_search';
export const selectInteractionTools=(tools,mode)=>mode==='chat'?tools.filter(t=>t.name===memoryToolName):tools;
export function needsInteractionSeriesReset(session,tools){
  if(!tools)return false;const names=xs=>[...new Set((xs||[]).map(t=>t.name))].sort(),expected=names(tools);
  if(JSON.stringify(expected)!==JSON.stringify(names(session.requestHeader?.()?.tools)))return true;
  const history=session.toolHistory?.();return [...(history?.tools||[]),...(history?.updates||[]).flatMap(u=>u.additions||[])].some(t=>!expected.includes(t.name));
}
export function installInteraction(ctx,service){
  const offered=new WeakMap();
  ctx.on('system-prompt/assemble',async(assembly,context,next)=>{const result=await next(),agent=context.agent,conversation=agent&&service.bound(agent.id,agent.session?.header?.cwd);if(!conversation)return result;const tools=selectInteractionTools(result.tools,conversation.mode);offered.set(agent,tools);return {...result,tools};},{prepend:true});
  ctx.on('agent/pre-step',async({agent},next)=>{const c=service.bound(agent.id,agent.session.header.cwd);if(c&&c.status!=='ready')return {kind:'reject'};const decision=await next();if(c&&decision.kind==='enter'&&needsInteractionSeriesReset(agent.session,offered.get(agent)))return {...decision,startsRequestSeries:true};return decision;},{prepend:true});
  ctx.on('tools/pre-execute',async(exec,next)=>{const c=exec.agent&&service.bound(exec.agent.id,exec.agent.session.header.cwd);if(!c)return next();if(c.status!=='ready')return {kind:'deny',reason:'会话尚未准备完成或已移除'};if(c.mode==='chat'&&exec.name!==memoryToolName)return {kind:'deny',reason:'对话模式仅提供历史查询，请切换工程模式后使用工程工具'};return next();});
}
