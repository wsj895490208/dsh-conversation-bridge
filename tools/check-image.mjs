// Offline probe of the installed image-admission backend. No real sessions,
// credentials, uploads to DeepSeek, or model requests are used.
import {mkdtempSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {deflateSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {packageLoader} from '../plugin/src/sdk.mjs';
import {MemoryIndex} from '../plugin/src/memory.mjs';
import {SemanticWorker} from '../plugin/src/semantic.mjs';
import {writeJson} from '../plugin/src/util.mjs';
const root=resolve(import.meta.dirname,'..'),load=packageLoader(join(process.argv[2],'resources/app.asar/dsh/node_modules/@deepseek-ai'));
const [{Context},{LocalAttachmentStore},{admitEncodedImages}]=await Promise.all([load('cordis'),load('dsh-attachment-local'),load('dsh-attachment')]);
const base=join(root,'tests/.tmp');mkdirSync(base,{recursive:true});const temp=mkdtempSync(join(base,'image-upload-'));
function crc32(bytes){let crc=0xffffffff;for(const b of bytes){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function chunk(type,data){const tag=Buffer.from(type),head=Buffer.alloc(4),tail=Buffer.alloc(4);head.writeUInt32BE(data.length);tail.writeUInt32BE(crc32(Buffer.concat([tag,data])));return Buffer.concat([head,tag,data,tail]);}
const header=Buffer.alloc(13);header.writeUInt32BE(32,0);header.writeUInt32BE(32,4);header[8]=8;header[9]=2;
const rows=Buffer.alloc(32*(1+32*3));for(let y=0;y<32;y++)for(let x=0;x<32;x++){const offset=y*97+1+x*3;rows[offset]=40;rows[offset+1]=130;rows[offset+2]=220;}
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
const ctx=new Context(),scope=ctx.plugin(LocalAttachmentStore,{dshHome:temp}),semantic=new SemanticWorker(join(root,'data/models')),index=new MemoryIndex(join(temp,'memory.sqlite'));
try{
  // Reproduce the important load order: Transformers (old sharp) first, then
  // Harness's native image decoder (new sharp). Threads failed at this boundary.
  const warm=await semantic.call('warm');assert.equal(warm.dimensions,384);assert.notEqual(warm.pid,process.pid);
  index.insert({id:'synthetic',node:'s1',role:'user',body:'合成测试：我喜欢蓝色陶瓷杯',time:'2020-01-01',source:'synthetic'});
  await semantic.call('batch',{file:index.file,offset:0,limit:1});assert.equal(index.health().ready,true);
  const hits=await semantic.call('search',{file:index.file,query:'蓝色陶瓷杯',limit:5});assert.equal(hits[0].id,'synthetic');assert.equal(hits[0].role,'user');assert.equal(hits[0].node,'s1');
  await scope.await();const images=await admitEncodedImages(ctx.attachments,[{data:png.toString('base64'),mediaType:'image/png',name:'synthetic.png'}]);assert.equal(images.length,1);const image=await ctx.attachments.readImage(images[0]);assert(image.data.byteLength>0);
  const objects=process.report.getReport().sharedObjects;assert(!objects.some(p=>p.includes('DSH-Conversation-Bridge')&&/sharp|vips/i.test(p)));
  const barrier=await semantic.call('barrier');assert.equal(barrier.pid,warm.pid);assert.equal(barrier.idle,true);
  const report={version:'0.1.0',localAdmission:true,readback:true,embeddingFirst:true,separateProcess:true,hostPid:process.pid,semanticPid:warm.pid,dimensions:warm.dimensions,vectorIndexVerified:true,vectorSearchVerified:true,hostLoadedPluginSharp:false,hostNativeImages:objects.filter(p=>/sharp|vips/i.test(p)).map(p=>p.split(/[\\/]/).at(-1)),syntheticBytes:png.length,width:images[0].width,height:images[0].height,realModelCalls:0,remoteUploads:0};
  writeJson(join(root,'docs/image-validation.json'),report);console.log(JSON.stringify(report));
}finally{index.close();await semantic.stop();await scope.dispose();}
