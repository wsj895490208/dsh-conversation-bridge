// Exercise the extracted release package, an empty cache and disabled preparation networking.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {writeJson} from '../plugin/src/util.mjs';
const root=resolve(import.meta.dirname,'..'),packageRoot=process.argv[2]&&existsSync(join(process.argv[2],'src/models.mjs'))?resolve(process.argv[2]):join(root,'plugin');
const {ensureModel,verifyModel,modelPin,modelFingerprint}=await import(pathToFileURL(join(packageRoot,'src/models.mjs')));
const {MemoryIndex}=await import(pathToFileURL(join(packageRoot,'src/memory.mjs')));
const {SemanticWorker}=await import(pathToFileURL(join(packageRoot,'src/semantic.mjs')));
const temporary=join(root,'tests/.tmp');mkdirSync(temporary,{recursive:true});const base=mkdtempSync(join(temporary,'offline-')),cache=join(base,'cache'),originalFetch=globalThis.fetch;let networkCalls=0;
globalThis.fetch=()=>{networkCalls++;throw Error('Preparation networking disabled');};
const worker=new SemanticWorker(cache);let index;
try{
  const sources=new Set();await ensureModel(cache,{progress:p=>sources.add(p.source)});assert(sources.has('package'));assert.equal(networkCalls,0);assert(await verifyModel(cache));
  await ensureModel(cache,{bundledRoot:null});assert.equal(networkCalls,0);
  const warm=await worker.call('warm');assert.equal(warm.dimensions,384);assert.equal(warm.remoteModelsAllowed,false);
  index=new MemoryIndex(join(base,'memory.sqlite'));
  index.insert({id:'cup',role:'user',body:'我最喜欢蓝色陶瓷杯，平时用它喝水。'});
  index.insert({id:'train',role:'user',body:'合成行程：周六上午坐火车去杭州。'});
  index.insert({id:'code',role:'assistant',body:'合成技术记录：这个示例使用 JavaScript。'});
  await worker.call('batch',{file:index.file,offset:0,limit:8});assert(index.health().ready);assert.equal(index.vectorModel(),modelFingerprint);
  const results=await worker.call('search',{file:index.file,query:'平时喝水喜欢用什么颜色的杯子',limit:3});assert.equal(results[0].id,'cup');
  index.db.prepare('UPDATE meta SET value=? WHERE key=?').run('legacy-model','embeddingFingerprint');
  await assert.rejects(worker.call('search',{file:index.file,query:'杯子',limit:3}),/model changed/i);
  await worker.call('batch',{file:index.file,offset:0,limit:8});assert(index.health().ready);assert.equal(index.get('cup').original,'我最喜欢蓝色陶瓷杯，平时用它喝水。');
  const report={version:'0.2.0',extractedReleasePackage:packageRoot!==join(root,'plugin'),emptyCachePreparation:true,bundledSource:true,preparationNetworkCalls:networkCalls,cachedReuse:true,embeddingLocalOnly:true,dimensions:warm.dimensions,vectorIndexVerified:true,syntheticRecallTop1:true,mismatchedVectorsRejected:true,rawTextPreserved:true,model:modelPin.id,revision:modelPin.revision,modelFingerprint,realModelCalls:0};
  writeJson(join(root,'docs/offline-validation.json'),report);console.log(JSON.stringify(report));
}finally{globalThis.fetch=originalFetch;await worker.stop();index?.close();}
