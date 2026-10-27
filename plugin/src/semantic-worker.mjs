import {join} from 'node:path';
import {MemoryIndex,chunks} from './memory.mjs';
import {hash} from './util.mjs';
import {verifyModel} from './models.mjs';
const cache=process.argv[2];if(!cache||!process.send)throw Error('Only the host may start this IPC worker');
let extractor,sequence=Promise.resolve(),stopping=false;
async function embed(text){
  if(!extractor){if(!await verifyModel(cache))throw Error('Local embedding model is missing or unverified');const t=await import('@huggingface/transformers');t.env.allowRemoteModels=false;t.env.allowLocalModels=true;t.env.localModelPath=cache;t.env.cacheDir=cache;extractor=await t.pipeline('feature-extraction','multilingual-minilm',{dtype:'q8',device:'cpu'});}
  const out=await extractor(text,{pooling:'mean',normalize:true,truncation:true,max_length:512});return new Float32Array(out.data);
}
async function handle(m){
  if(m.action==='warm')return {dimensions:(await embed('local history')).length,pid:process.pid};
  if(m.action==='barrier')return {idle:true,pid:process.pid};
  const index=new MemoryIndex(m.file);try{
    if(m.action==='batch'){
      const docs=index.db.prepare('SELECT * FROM docs ORDER BY rowid LIMIT ? OFFSET ?').all(m.limit||8,m.offset||0);
      for(const doc of docs){if(!doc.active)continue;const pieces=chunks(doc.body),sourceHash=hash(doc.body);
        for(let n=0;n<pieces.length;n++){if(index.db.prepare('SELECT 1 FROM vectors WHERE id=? AND chunk=? AND sourceHash=?').get(doc.id,n,sourceHash))continue;const v=await embed(pieces[n]);index.db.exec('BEGIN IMMEDIATE');try{const current=index.db.prepare('SELECT body,active FROM docs WHERE id=?').get(doc.id);if(current?.body===doc.body&&current.active)index.db.prepare('INSERT OR REPLACE INTO vectors VALUES(?,?,?,?,?)').run(doc.id,n,pieces[n],Buffer.from(v.buffer),sourceHash);index.db.exec('COMMIT');}catch(e){index.db.exec('ROLLBACK');throw e;}}
      }
      return {nextOffset:(m.offset||0)+docs.length,done:docs.length<(m.limit||8)};
    }
    if(m.action==='search'){
      const query=await embed(m.query),best=new Map();
      for(const row of index.db.prepare('SELECT v.*,d.body fullBody,d.node,d.role,d.time,d.kind,d.source FROM vectors v JOIN docs d ON d.id=v.id WHERE d.active=1 AND d.id NOT IN (SELECT id FROM tombstones)').iterate()){
        if(row.sourceHash!==hash(row.fullBody))continue;const v=new Float32Array(Uint8Array.from(row.vector).buffer);if(v.length!==384)continue;
        let score=0;for(let n=0;n<v.length;n++)score+=v[n]*query[n];if(!best.has(row.id)||score>best.get(row.id).score)best.set(row.id,{...row,vector:undefined,fullBody:undefined,sourceHash:undefined,score,channel:'vector'});
      }
      return [...best.values()].sort((a,b)=>b.score-a.score).slice(0,m.limit||10);
    }
    throw Error('Unsupported worker action');
  }finally{index.close();}
}
function shutdown(){if(stopping)return;stopping=true;sequence=sequence.then(()=>extractor?.dispose?.()).finally(()=>process.exit(0));}
process.on('disconnect',shutdown);
process.on('message',m=>{if(m?.action==='shutdown')return shutdown();if(stopping||!Number.isInteger(m?.id))return;sequence=sequence.then(async()=>{try{const result=await handle(m);if(process.connected)process.send({id:m.id,result},()=>{});}catch(e){if(process.connected)process.send({id:m.id,error:e.message},()=>{});}});});
