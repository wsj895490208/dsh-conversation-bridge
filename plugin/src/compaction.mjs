export const inject=['llm','tokenMeter','sessions','conversationBridge'];
export async function apply(ctx){
  const service=ctx.conversationBridge.service;
  const {BasicCompactionEngine}=await service.host.load('dsh-compaction-basic');
  // The hook delegates unchanged to the shipped summarizer. No custom template,
  // retention, output limit, selection, locking, or checkpoint framing.
  class TrackedNativeCompaction extends BasicCompactionEngine{
    async summarize(input,agent,signal){
      const replay=service.replayScopes.get(agent.id);
      if(!replay)return super.summarize(input,agent,signal);
      return service.nativeSummary(replay,input,()=>super.summarize(input,agent,signal),signal);
    }
  }
  ctx.plugin(TrackedNativeCompaction,{});
}
