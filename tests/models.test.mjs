import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readdirSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {ensureModel,verifyModel,modelFingerprint} from '../plugin/src/models.mjs';
import {MemoryIndex} from '../plugin/src/memory.mjs';
import {BridgeService} from '../plugin/src/service.mjs';
import {hash} from '../plugin/src/util.mjs';
import {temp,FakeSemantic,finish} from './helpers.mjs';

function fixture(){
  const bundled=temp('model-bundle-'),cache=temp('model-cache-'),files={'config.json':Buffer.from('{}'),'onnx/model_quantized.onnx':Buffer.from('synthetic-model')},pin={id:'synthetic',revision:'frozen',files:{}};
  for(const [name,body]of Object.entries(files)){const file=join(bundled,'multilingual-minilm',name);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,body);pin.files[name]={bytes:body.length,sha256:hash(body)};}
  return {bundled,cache,pin};
}
test('bundled model prepares a fresh cache with networking disabled and reuses it',async()=>{
  const {bundled,cache,pin}=fixture(),events=[];let network=0;
  const fetcher=()=>{network++;throw Error('Network forbidden');};
  await ensureModel(cache,{pin,bundledRoot:bundled,fetcher,progress:p=>events.push(p)});
  assert.equal(network,0);assert(await verifyModel(cache,{pin}));assert(events.some(p=>p.source==='package'&&p.verified));
  await ensureModel(cache,{pin,bundledRoot:null,fetcher});assert.equal(network,0);
});
test('missing or corrupt bundled weights never silently download; cache repair is local',async()=>{
  const {bundled,cache,pin}=fixture();let network=0;const fetcher=()=>{network++;throw Error('Network forbidden');};
  await assert.rejects(ensureModel(cache,{pin,bundledRoot:null,fetcher}),e=>e.code==='model_missing');
  writeFileSync(join(bundled,'multilingual-minilm/onnx/model_quantized.onnx'),'bad');
  await assert.rejects(ensureModel(cache,{pin,bundledRoot:bundled,fetcher}),e=>e.code==='model_integrity');
  assert(!readdirSync(join(cache,'multilingual-minilm/onnx')).some(n=>n.includes('.part-')));assert.equal(network,0);
  const restored=fixture();await ensureModel(restored.cache,{pin:restored.pin,bundledRoot:restored.bundled});writeFileSync(join(restored.cache,'multilingual-minilm/config.json'),'xx');
  assert.equal(await verifyModel(restored.cache,{pin:restored.pin}),false);await ensureModel(restored.cache,{pin:restored.pin,bundledRoot:restored.bundled,fetcher});assert(await verifyModel(restored.cache,{pin:restored.pin}));
});
test('cancelling bundled preparation removes partial files and retry completes offline',async()=>{
  const {bundled,cache,pin}=fixture(),controller=new AbortController();
  await assert.rejects(ensureModel(cache,{pin,bundledRoot:bundled,signal:controller.signal,progress:p=>{if(!p.verified)controller.abort();}}),e=>e.name==='AbortError');
  const partials=readdirSync(join(cache,'multilingual-minilm'),{recursive:true}).filter(n=>String(n).includes('.part-'));assert.equal(partials.length,0);
  await ensureModel(cache,{pin,bundledRoot:bundled});assert(await verifyModel(cache,{pin}));
});
test('model changes invalidate only derived vectors and preserve raw text/tombstones',()=>{
  const index=new MemoryIndex(join(temp(),'legacy.sqlite'));try{
    index.insert({id:'one',node:'one',role:'user',body:'synthetic original'});index.prepareVectorModel('previous-model');index.db.prepare('INSERT INTO vectors VALUES(?,?,?,?,?)').run('one',0,'synthetic original',Buffer.alloc(384*4),hash('synthetic original'));
    assert.equal(index.health().modelMatches,false);assert.equal(index.health().ready,false);index.correct('one',{active:false});assert(index.prepareVectorModel());assert.equal(index.vectorModel(),modelFingerprint);assert.equal(index.stats().vectors,0);assert.equal(index.get('one').original,'synthetic original');assert.equal(index.get('one').active,false);
  }finally{index.close();}
});
test('cancellation during a bundled copy closes streams and permits an offline retry',async()=>{
  const {bundled,cache,pin}=fixture(),body=Buffer.alloc(3*1024*1024,7),name='onnx/model_quantized.onnx',controller=new AbortController();
  writeFileSync(join(bundled,'multilingual-minilm',name),body);pin.files[name]={bytes:body.length,sha256:hash(body)};
  await assert.rejects(ensureModel(cache,{pin,bundledRoot:bundled,signal:controller.signal,progress:p=>{if(p.file===name&&p.bytes>=1048576&&!p.verified)controller.abort();}}),e=>e.name==='AbortError');
  assert(!readdirSync(join(cache,'multilingual-minilm/onnx')).some(n=>n.includes('.part-')));
  await ensureModel(cache,{pin,bundledRoot:bundled});assert(await verifyModel(cache,{pin}));
});
test('upgrade queues an independent index rebuild and ignores stale job offsets',async()=>{
  const root=temp(),service=new BridgeService(root,{ensureModel:async()=>{},readSession:async()=>({header:{},events:[]})},{semantic:new FakeSemantic()});
  try{
    service.store.put('conversation',{id:'old',status:'ready',path:join(root,'conversations/old'),sessionId:'session-old'});const index=service.index('old');index.insert({id:'one',role:'user',body:'preserved original'});index.prepareVectorModel('previous-model');
    service.store.create('job',{type:'index',payload:{conversationId:'old'},status:'failed',offset:999});await service.recover();
    const queued=service.store.all('job').find(j=>j.type==='index'&&j.payload.modelFingerprint===modelFingerprint);assert(queued);assert.equal((await finish(service,queued)).status,'completed');assert.equal(index.health().ready,true);assert.equal(index.get('one').original,'preserved original');
  }finally{await service.close();}
});
