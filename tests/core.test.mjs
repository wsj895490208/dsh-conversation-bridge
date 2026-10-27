import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {existsSync,writeFileSync,readFileSync} from 'node:fs';
import {runImportWorker} from '../plugin/src/import-task.mjs';
import {normalize} from '../plugin/src/importer.mjs';
import {MemoryIndex} from '../plugin/src/memory.mjs';
import {nativeSession} from '../plugin/src/native.mjs';
import {BridgeService} from '../plugin/src/service.mjs';
import {freezePolicy} from '../plugin/src/replay-host.mjs';
import {installInteraction,needsInteractionSeriesReset} from '../plugin/src/interaction.mjs';
import {temp,corpus,FakeSemantic,finish} from './helpers.mjs';
import {locationFile,readLocation,saveLocation} from '../plugin/src/location.mjs';

test('storage fallback is plugin-owned, profile isolated and requires absolute locations',()=>{
 const home=temp(),target=temp(),file=locationFile({},home,'desktop');saveLocation(file,{dataDir:target});assert.equal(readLocation(file).dataDir,target);assert.equal(readLocation(locationFile({},home,'web')).dataDir,undefined);assert.throws(()=>saveLocation(file,{dataDir:'relative'}),e=>e.code==='invalid_path');assert(!existsSync(join(home,'.dsh','profiles')));
});

test('DeepSeek parent chain preserves roles, text, branches and attachment-only messages',()=>{
 const c=corpus(2)[0];c.mapping['5']={id:'5',parent:'2',children:[],message:{fragments:[{type:'REQUEST',content:'other branch'}]}};c.mapping['2'].children.push('5');c.mapping['3'].message.fragments=[{type:'FILE',files:[{file_id:'f1',file_name:'synthetic.png',file_size:99}]}];
 const a=normalize(c,'4'),b=normalize(c,'5');assert.deepEqual(a.messages.map(m=>m.role),['user','assistant','user','assistant']);assert.equal(a.statistics.attachmentOnly,1);assert.equal(a.attachments.length,1);assert(!a.messages.some(m=>m.text==='other branch'));assert.equal(b.messages.length,3);
 const native=nativeSession(a.messages,temp());assert.equal(native.header.agentPreset,'conversation-bridge');assert.equal(native.events.filter(e=>e.type==='user/message').length,2);assert(native.events.some(e=>JSON.stringify(e).includes('f1')));
});
test('local parse lane is independent, malformed exports fail and retry explicitly',async()=>{
 const root=temp(),service=new BridgeService(root,{}, {semantic:new FakeSemantic()});try{const upload=service.upload(Buffer.from(JSON.stringify(corpus())),{name:'history.json'}),job=service.scan(upload.id);service.running.set('background',new Promise(()=>{}));assert.equal((await finish(service,job)).status,'completed');assert.equal(service.scanResult(job.id).conversations[0].branches.length,1);assert.equal(service.scan(upload.id).id,job.id);assert.equal(service.scanState(job.id).waitsForIndex,false);service.running.delete('background');const bad=service.upload(Buffer.from('{bad'));const failed=await finish(service,service.scan(bad.id));assert.equal(failed.status,'failed');await service.controlJob(failed.id,'retry');assert.equal((await finish(service,failed)).status,'failed');}finally{service.running.delete('background');await service.close();}
});
test('parser cancellation, timeout, clean exit settle without hanging',async()=>{
 const root=temp(),entry=join(root,'silent.mjs');writeFileSync(entry,'export {};');await assert.rejects(runImportWorker('scan',{path:'x'},{entry:new URL('file:///'+entry.replaceAll('\\','/'))}),e=>e.code==='parse_worker_exit');const sleeping=join(root,'sleep.mjs');writeFileSync(sleeping,'setInterval(()=>{},1000);');await assert.rejects(runImportWorker('scan',{path:'x'},{entry:new URL('file:///'+sleeping.replaceAll('\\','/')),timeoutMs:30}),e=>e.code==='parse_timeout');const abort=new AbortController();abort.abort();await assert.rejects(runImportWorker('scan',{}, {signal:abort.signal}),e=>e.code==='job_paused');
});
test('index health rejects zero, partial, and stale vectors; libraries stay isolated',()=>{
 const a=new MemoryIndex(join(temp(),'a.sqlite')),b=new MemoryIndex(join(temp(),'b.sqlite'));try{a.insert({id:'1',node:'1',role:'user',body:'我喜欢蓝色陶瓷杯'});assert.equal(a.health().ready,false);assert.equal(a.lexical('蓝色陶瓷')[0].node,'1');assert.equal(b.lexical('蓝色陶瓷').length,0);a.db.prepare('INSERT INTO vectors VALUES(?,?,?,?,?)').run('1',0,'old',Buffer.alloc(384*4),'old');assert.equal(a.health().ready,false);a.correct('1',{active:false});assert.equal(a.lexical('蓝色陶瓷').length,0);}finally{a.close();b.close();}
});
test('native threshold preview follows default ratio, output reservation and model override',()=>{
 const base={thresholdRatio:.8,headroomTokens:65536,retainRatio:.16,maxTokens:65536,modelPolicies:[],compactionRetries:1,maxOverflowRetries:1,auto:true},route={provider:'p',model:'m',maxTokens:256000},info={context:{contextWindow:1048576}};const p=freezePolicy(route,info,base);assert.equal(p.thresholdTokens,727040);assert.equal(p.retainTokens,Math.floor((1048576-256000)*.16));assert.equal(p.summaryMaxTokens,65536);const override=freezePolicy(route,info,{...base,modelPolicies:[{provider:'p',model:'m',thresholdRatio:.5,retainTokens:1000}]});assert.equal(override.thresholdTokens,524288);assert.equal(override.retainTokens,1000);
});
test('no automatic RAG, native approvals survive engineering, unready sessions are blocked',async()=>{
 const hooks={},c={id:'c',status:'ready',mode:'chat'},ctx={on:(n,f)=>hooks[n]=f},service={bound:()=>c};installInteraction(ctx,service);const agent={id:'s',session:{header:{cwd:'x'},requestHeader:()=>({tools:[]}),toolHistory:()=>({})}};const assembly=await hooks['system-prompt/assemble']({}, {agent},async()=>({tools:[{name:'memory_search'},{name:'pwsh'}]}));assert.deepEqual(assembly.tools.map(t=>t.name),['memory_search']);assert.equal((await hooks['agent/pre-step']({agent},async()=>({kind:'enter'}))).startsRequestSeries,true);assert.equal((await hooks['tools/pre-execute']({agent,name:'pwsh'},async()=>{throw Error('should be blocked');})).kind,'deny');c.mode='engineering';const approval={kind:'ask'};assert.equal(await hooks['tools/pre-execute']({agent,name:'pwsh'},async()=>approval),approval);c.status='preparing';assert.equal((await hooks['agent/pre-step']({agent},async()=>{throw Error();})).kind,'reject');assert.equal(needsInteractionSeriesReset(agent.session,[{name:'memory_search'}]),true);
});
test('removal creates no backup, preserves source and workspace, prevents resurrection',async()=>{
 const root=temp(),work=temp(),archived=[],service=new BridgeService(root,{archiveSession:async s=>archived.push(s)}, {semantic:new FakeSemantic()});try{const path=join(root,'conversations','c');service.store.put('conversation',{id:'c',sessionId:'s',path,workspace:work,status:'ready'});service.store.put('binding',{id:'s',conversationId:'c',cwd:work});service.store.put('request',{id:'removed-request-key',previewId:'p',conversationId:'c'});service.index('c').insert({id:'d',role:'user',body:'synthetic'});writeFileSync(join(work,'keep.txt'),'keep');const original=join(root,'imports','original.json');writeFileSync(original,'[]');await service.removeConversation({conversationId:'c'});assert.deepEqual(archived,['s']);assert(!existsSync(join(path,'memory.sqlite')));assert(existsSync(join(work,'keep.txt')));assert.equal(readFileSync(original,'utf8'),'[]');assert(!existsSync(join(root,'backups')));assert.throws(()=>service.job('index',{conversationId:'c'}),e=>e.code==='conversation_removed');await service.removeConversation({conversationId:'c'});assert.equal(archived.length,1);await assert.rejects(service.confirmImport({previewId:'p',requestId:'removed-request-key'}),e=>e.code==='conversation_removed');}finally{await service.close();}
});
test('unknown summary outcome pauses without repeated model calls; quotas remain accounted',async()=>{
 const root=temp(),service=new BridgeService(root,{tokenMeter:{estimateMessage:()=>100}}, {semantic:new FakeSemantic()});const replay={conversationId:'c',jobId:'j',cursor:1,sourceOffset:1,snapshot:{sha256:'x',summaryMaxTokens:1000}},input={messages:[{id:'u',role:'user',content:[]}]};let calls=0;try{await assert.rejects(service.nativeSummary(replay,input,async()=>{service.reserveNativeCall(replay,{messages:input.messages,maxTokens:1000});calls++;throw Error('network');}));await assert.rejects(service.nativeSummary(replay,input,async()=>{calls++;}),e=>e.code==='summary_outcome_unknown');assert.equal(calls,1);assert.equal(service.store.usageDetails('preparation').unknown.output,1000);}finally{await service.close();}
});

test('new events arriving during the last index batch are included before ready',async()=>{
 const root=temp();let service,added=false;const semantic=new FakeSemantic(),original=semantic.call.bind(semantic);semantic.call=async(action,args)=>{const out=await original(action,args);if(action==='batch'&&!added){added=true;service.index('c').insert({id:'second',role:'user',body:'arrived during indexing'});}return out;};service=new BridgeService(root,{ensureModel:async()=>{}},{semantic});try{service.store.put('conversation',{id:'c',path:join(root,'conversations','c'),status:'ready'});service.index('c').insert({id:'first',role:'user',body:'synthetic history'});const job=service.job('index',{conversationId:'c'});assert.equal((await finish(service,job)).status,'completed');assert.equal(service.index('c').health().coveredDocuments,2);}finally{await service.close();}
});
