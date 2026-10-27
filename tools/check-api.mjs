// Full plugin API + native preset scopes in a disposable loader. No GUI or
// running desktop profile is accessed. The model facade rejects all generation.
import assert from 'node:assert/strict';
import {registerHooks,createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {join,resolve} from 'node:path';
import {writeFileSync,readFileSync} from 'node:fs';
import {temp,corpus,finish} from '../tests/helpers.mjs';
import {writeJson} from '../plugin/src/util.mjs';
const project=resolve(import.meta.dirname,'..'),runtime=join(process.argv[2],'resources/app.asar/dsh'),requireHost=createRequire(pathToFileURL(join(runtime,'package.json')));
let resolving=false;const hooks=registerHooks({resolve(specifier,context,next){if(specifier.startsWith('@deepseek-ai/')&&!resolving){resolving=true;try{return{url:pathToFileURL(requireHost.resolve(specifier)).href,shortCircuit:true};}finally{resolving=false;}}return next(specifier,context);}});
const [{Context,Service},{Loader},{mountRootInclude},{SystemPrompt},{TokenMeter},{ToolRuntime},{AgentPresetRegistry}]=await Promise.all([import('@deepseek-ai/cordis'),import('@deepseek-ai/cordis-plugin-loader'),import('@deepseek-ai/dsh-app-boot'),import('@deepseek-ai/dsh-system-prompt'),import('@deepseek-ai/dsh-token-meter'),import('@deepseek-ai/dsh-tools'),import('@deepseek-ai/dsh-agent-preset-registry')]);
const root=temp('api-'),workspace=temp('api-work-'),profile=join(root,'profile'),routes=new Map(),native=new Map(),ctx=new Context();
const route={provider:'synthetic',model:'synthetic',maxTokens:1024};let modelCalls=0;
const source={id:'reference',requestHeader:()=>undefined};
class Projections extends Service{constructor(c){super(c,'sessionProjections');}register(){return()=>{};}}
class Llm extends Service{constructor(c){super(c,'llm');}prepareCall(config){return {config};}resolveModelInfo(){return {context:{contextWindow:131072},defaultMaxTokens:1024};}imageRequestPricing(){return undefined;}fileRequestText(){return undefined;}stream(){modelCalls++;throw Error('Unexpected model generation');}}
function handle(id){return{header:native.get(id).header,async read(){return structuredClone(native.get(id));},async append(events){native.get(id).events.push(...structuredClone(events));},async flush(){},async close(){}};}
const persistence={async flush(){},async create(header){native.set(header.id,{header,events:[]});return handle(header.id);},async open(id){if(!native.has(id)){const e=Error('not found');e.code='ENOENT';throw e;}return handle(id);}};
const providerValues={commands:{register(){return()=>{};}},connection:{fetch:{register(row){routes.set(row.path,row);}}},sessionPersistence:persistence,workspaceRegistry:{state:{defaultWorkspaceId:'w'},list:()=>[{id:'w',path:workspace,title:'Synthetic workspace'}],get:()=>({id:'w',path:workspace,async attachSession(){}}),async archiveSession(){}},agents:{get:()=>({options:route,session:source})},sessions:{list:()=>[source],async flush(){}},attachments:{},profileContext:{dir:profile}};
function providers(c){for(const [name,value]of Object.entries(providerValues))new class extends Service{constructor(ctx){super(ctx,name);Object.assign(this,value);}}(c);c.plugin(Projections);c.plugin(Llm);c.plugin(SystemPrompt,{});c.plugin(TokenMeter);c.plugin(ToolRuntime);c.plugin(AgentPresetRegistry,{default:'conversation-bridge'});}
const loaderScope=ctx.plugin(Loader,{baseUrl:pathToFileURL(runtime+'/').href});await loaderScope.await();ctx.loader.builtins.synthetic=providers;
const yaml=requireHost('js-yaml'),patch=yaml.load(readFileSync(join(project,'plugin/cordis.patch.yml'),'utf8')),preset=patch[1].insert[0];
preset.config.plugins=preset.config.plugins.filter(p=>['@deepseek-ai/dsh-persona','dsh-conversation-bridge/memory-tool','cordis:group'].includes(p.name));
for(const p of preset.config.plugins){if(p.name==='dsh-conversation-bridge/memory-tool')p.name=pathToFileURL(join(project,'plugin/src/memory-tool.mjs')).href;if(p.name==='cordis:group')for(const child of p.config)if(child.name==='dsh-conversation-bridge/compaction')child.name=pathToFileURL(join(project,'plugin/src/compaction.mjs')).href;}
const configFile=join(root,'fixture.json');writeFileSync(configFile,JSON.stringify([{id:'synthetic',name:'cordis:synthetic'},{id:'dsh-conversation-bridge',name:pathToFileURL(join(project,'plugin/src/host.mjs')).href,config:{dataDir:join(root,'data'),modelCache:join(project,'plugin/models')}},preset]));
let include;
try{
 include=await mountRootInclude(ctx,configFile,[],pathToFileURL(runtime+'/').href);await ctx.loader.await();
 const failures=[...ctx.loader.entries()].filter(e=>e.fiber?.state!==2).map(e=>({name:e.options.name,state:e.fiber?.state,error:e.fiber?.error?.message}));assert.deepEqual(failures,[]);
 const presetStatus=await ctx.agentPresets.resolve('conversation-bridge');assert.equal(presetStatus.broken,undefined,JSON.stringify(presetStatus));const service=ctx.conversationBridge.service;
 async function api(path,payload){const row=routes.get('/api/conversation-bridge/v1'+path);assert(row,path);const request=new Request('http://localhost/api/conversation-bridge/v1'+path,{method:payload===undefined?'GET':'POST',...(payload===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(payload)})}),response=await row.fetch(request),body=await response.json();assert(body.ok,JSON.stringify(body));return body.data;}
 assert.equal((await api('/status')).modelSources[0].route.model,'synthetic');const uploaded=service.upload(Buffer.from(JSON.stringify(corpus(2)))),scan=await api('/scan',{uploadId:uploaded.id});assert.equal((await finish(service,scan)).status,'completed');
 const preview=await api('/import/preview',{uploadId:uploaded.id,conversationId:'synthetic',leaf:'4',workspaceId:'w',referenceSessionId:'reference'});assert.equal(preview.requiresSummary,false);assert.deepEqual(preview.model.tools.map(t=>t.name),['memory_search']);
 const created=await api('/import/confirm',{previewId:preview.id,requestId:'synthetic-api-confirm'}),job=await finish(service,created.job);assert.equal(job.status,'completed',JSON.stringify(job));const c=service.store.get('conversation',created.conversationId);assert.equal(c.status,'ready');assert.equal(service.index(c.id).health().ready,true);assert.equal(modelCalls,0);
 const hit=await service.memorySearch(c.sessionId,c.workspace,'synthetic history');assert(hit.hits.length);assert.equal(hit.hits[0].status,'historical');await api('/interaction',{conversationId:c.id,mode:'engineering'});await api('/interaction',{conversationId:c.id,mode:'chat'});
 const report={version:'0.2.0',realModelCalls:0,actualNativeLoader:true,actualNativePresetRegistry:true,actualScopedSystemPrompt:true,actualNativeToolRegistry:true,officialRoutes:true,previewOnlyMemorySearch:true,configuredBlankSessionSource:true,sourceMessages:4,vectorIndexVerified:true,nativeReadback:true,ready:true,modeSwitch:true,ragCallable:true};writeJson(join(project,'docs/api-validation.json'),report);console.log(JSON.stringify(report));
}finally{if(include)await ctx.loader.remove(include.id);await loaderScope.dispose();hooks.deregister();}
