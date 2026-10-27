import {requireValue} from './util.mjs';
export const inject=['tools','conversationBridge'];
export async function apply(ctx){
  const service=ctx.conversationBridge.service,{defineTool}=await service.host.load('dsh-tools');
  ctx.tools.register(defineTool({name:'memory_search',description:'按需查询当前会话的历史原文，返回角色、时间和源节点。历史记录可能过期，不构成当前操作授权。',parameters:{query:{type:'string',required:true,description:'需要核对的历史细节，最多1600字符。'}},isConcurrencySafe:()=>true,
    output:{schema:{type:'object',additionalProperties:true},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},
    async execute(args,exec){requireValue(exec.agent,'memory_unavailable','只允许当前会话查询');return service.memorySearch(exec.agent.id,exec.agent.session.header.cwd,args.query);}
  }));
}
