import { DatabaseSync } from 'node:sqlite';
import { fork } from 'node:child_process';
import { directory, hash, requireValue } from './util.mjs';
import { dirname,resolve } from 'node:path';
import {modelFingerprint} from './models.mjs';
const inferMetadata = d => ({category:d.role==='assistant'?'assistant_expression':'episode',status:'historical'});
function recentTurns(messages,count){return messages.slice(-count*2);}

export const modelId='sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2';
export function terms(text) {const clean=String(text).toLowerCase();const set=new Set(clean.match(/[a-z0-9_]{2,}/g)||[]);for(const part of clean.match(/[\u3400-\u9fff]+/gu)||[]){for(let i=0;i<part.length-1;i++)set.add(part.slice(i,i+2));if(part.length===1)set.add(part);}return [...set];}
export function chunks(text,size=1000,overlap=120) {const out=[];for(let i=0;i<text.length;i+=size-overlap)out.push(text.slice(i,i+size));return out.length?out:[''];}
export class MemoryIndex {
  constructor(file){directory(dirname(file));this.file=file;this.db=new DatabaseSync(file);this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000;
    CREATE TABLE IF NOT EXISTS docs(id TEXT PRIMARY KEY,node TEXT,role TEXT,time TEXT,kind TEXT,body TEXT,original TEXT,active INTEGER DEFAULT 1,source TEXT);
    CREATE TABLE IF NOT EXISTS vectors(id TEXT,chunk INTEGER,body TEXT,vector BLOB,sourceHash TEXT,PRIMARY KEY(id,chunk));
    CREATE TABLE IF NOT EXISTS tokens(term TEXT,id TEXT,PRIMARY KEY(term,id)); CREATE INDEX IF NOT EXISTS token_doc ON tokens(id);
    CREATE TABLE IF NOT EXISTS tombstones(id TEXT PRIMARY KEY,reason TEXT);
    CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT);
    CREATE TABLE IF NOT EXISTS memory_metadata(id TEXT PRIMARY KEY,body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS recent_messages(id TEXT PRIMARY KEY,seq INTEGER,body TEXT NOT NULL);`);if(!this.db.prepare('PRAGMA table_info(vectors)').all().some(c=>c.name==='sourceHash'))this.db.exec('ALTER TABLE vectors ADD COLUMN sourceHash TEXT');}
  vectorModel(){return this.db.prepare('SELECT value FROM meta WHERE key=?').get('embeddingFingerprint')?.value||null;}
  prepareVectorModel(fingerprint=modelFingerprint){const previous=this.vectorModel();if(previous===fingerprint)return false;this.db.exec('BEGIN IMMEDIATE');try{this.db.exec('DELETE FROM vectors');this.db.prepare('INSERT OR REPLACE INTO meta VALUES(?,?)').run('embeddingFingerprint',fingerprint);this.db.exec('COMMIT');return true;}catch(error){this.db.exec('ROLLBACK');throw error;}}
  insert(doc){if(this.db.prepare('SELECT 1 FROM docs WHERE id=?').get(doc.id))return;this.db.prepare('INSERT INTO docs VALUES(?,?,?,?,?,?,?,1,?)').run(doc.id,doc.node||doc.id,doc.role,doc.time||'',doc.kind|| (doc.role==='user'?'user_statement':'assistant_expression'),doc.body,doc.original??doc.body,doc.source||'history');this.tokenize(doc.id,doc.body);if(doc.source==='extracted'){const blocked=String(doc.node).split(',').some(node=>this.db.prepare('SELECT 1 FROM tombstones t JOIN docs d ON d.id=t.id WHERE d.node=?').get(node));if(blocked){this.db.prepare('UPDATE docs SET active=0 WHERE id=?').run(doc.id);this.db.prepare('INSERT OR REPLACE INTO tombstones VALUES(?,?)').run(doc.id,'来源已停用');}}}
  tokenize(id,body){this.db.prepare('DELETE FROM tokens WHERE id=?').run(id);const add=this.db.prepare('INSERT OR IGNORE INTO tokens VALUES(?,?)');for(const term of terms(body))add.run(term,id);}
  seed(messages,body){this.db.exec('BEGIN');try{for(const m of messages)this.insert({id:`node-${m.nodeId}`,node:m.nodeId,role:m.role,time:m.time,body:body(m)});this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}}
  get(id){const d=this.db.prepare('SELECT * FROM docs WHERE id=?').get(id);requireValue(d,'not_found','记忆不存在');return {...d,active:!!d.active};}
  list({query='',limit=50,offset=0,includeInactive=false}={}) {if(query)return this.lexical(query,limit,includeInactive);return this.db.prepare(`SELECT * FROM docs ${includeInactive?'':'WHERE active=1 AND id NOT IN (SELECT id FROM tombstones)'} ORDER BY rowid DESC LIMIT ? OFFSET ?`).all(Math.min(limit,200),offset);}
  lexical(query,limit=5,includeInactive=false){
    const stop=new Set(['什么','怎样','如何','这个','那个','我们','你们','我曾','在哪','哪条','一件','有关','事情','对话','消息','时候','怎样','我的','你的']);
    const ts=terms(query).filter(t=>!stop.has(t));if(!ts.length)return [];const placeholders=ts.map(()=>'?').join(',');const active=includeInactive?'':'AND d.active=1 AND d.id NOT IN (SELECT id FROM tombstones)';
    const total=this.db.prepare('SELECT COUNT(*) n FROM docs').get().n||1,average=this.db.prepare('SELECT COUNT(*) n FROM tokens').get().n/total||1;
    const frequency=new Map(ts.map(t=>[t,this.db.prepare('SELECT COUNT(*) n FROM tokens WHERE term=?').get(t).n]));
    const rows=this.db.prepare(`SELECT d.*,GROUP_CONCAT(t.term,'|') matched,(SELECT COUNT(*) FROM tokens x WHERE x.id=d.id) length FROM docs d JOIN tokens t ON t.id=d.id WHERE t.term IN (${placeholders}) ${active} GROUP BY d.id`).all(...ts);
    return rows.map(row=>{let score=0;for(const term of row.matched.split('|')){const df=frequency.get(term);score+=Math.log(1+(total-df+0.5)/(df+0.5))*2.2/(1+1.2*(0.25+0.75*row.length/average));}return {...row,matched:undefined,length:undefined,score,channel:'中文全文'};}).sort((a,b)=>b.score-a.score).slice(0,Math.min(limit,200));
  }
  correct(id,{body,kind,active,reason}){
    const d=this.get(id);requireValue(body===undefined||typeof body==='string'&&body.length<100000,'invalid_memory','记忆正文无效');this.db.exec('BEGIN IMMEDIATE');
    try{
      const related=this.db.prepare('SELECT id FROM docs WHERE node=?').all(d.node);
      if(active!==undefined)for(const row of related){this.db.prepare('UPDATE docs SET active=? WHERE id=?').run(Number(!!active),row.id);if(active===false)this.db.prepare('INSERT OR REPLACE INTO tombstones VALUES(?,?)').run(row.id,reason||'用户停用此来源');else this.db.prepare('DELETE FROM tombstones WHERE id=?').run(row.id);}
      this.db.prepare('UPDATE docs SET body=?,kind=? WHERE id=?').run(body??d.body,kind??d.kind,id);
      if(body!==undefined){this.tokenize(id,body);this.db.prepare('DELETE FROM vectors WHERE id=?').run(id);}
      this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e;}return this.get(id);
  }
  stats(){return {...this.db.prepare('SELECT COUNT(*) total,SUM(active) active FROM docs').get(),vectors:this.db.prepare('SELECT COUNT(*) n FROM vectors').get().n,indexed:this.db.prepare('SELECT COUNT(DISTINCT id) n FROM vectors').get().n,disabled:this.db.prepare('SELECT COUNT(*) n FROM tombstones').get().n};}
  metadata(doc){const row=this.db.prepare('SELECT body FROM memory_metadata WHERE id=?').get(doc.id);return row?JSON.parse(row.body):inferMetadata(doc);}
  setMetadata(id,value){const doc=this.get(id),current=this.metadata(doc),next={...current,...value};requireValue(['historical','current','superseded','unreviewed'].includes(next.status),'invalid_memory','记忆时间状态无效');requireValue(['state_claim','episode','stable_fact','preference','assistant_expression','draft','idea'].includes(next.category),'invalid_memory','记忆类别无效');for(const k of ['validFrom','validUntil'])requireValue(!next[k]||Number.isFinite(Date.parse(next[k])),'invalid_memory','记忆时间格式无效');if(next.supersededBy)requireValue(next.supersededBy!==id&&this.get(next.supersededBy),'invalid_memory','取代来源无效');this.db.prepare('INSERT OR REPLACE INTO memory_metadata VALUES(?,?)').run(id,JSON.stringify(next));return next;}
  health(){let documents=0,covered=0,expected=0,missing=0,stale=0;for(const doc of this.db.prepare('SELECT * FROM docs WHERE active=1 AND id NOT IN (SELECT id FROM tombstones)').iterate()){documents++;const pieces=chunks(doc.body),digest=hash(doc.body),rows=this.db.prepare('SELECT chunk,body,sourceHash,length(vector) bytes FROM vectors WHERE id=?').all(doc.id);expected+=pieces.length;let valid=0;for(let i=0;i<pieces.length;i++)if(rows.some(v=>v.chunk===i&&v.body===pieces[i]&&v.sourceHash===digest&&v.bytes===384*4))valid++;missing+=pieces.length-valid;if(valid===pieces.length)covered++;stale+=rows.filter(v=>v.sourceHash!==digest||v.body!==pieces[v.chunk]||v.bytes!==384*4).length;}const fingerprint=this.vectorModel(),modelMatches=fingerprint===modelFingerprint;return {documents,coveredDocuments:covered,expectedChunks:expected,missingChunks:missing,staleChunks:stale,...this.stats(),modelMatches,embeddingFingerprint:fingerprint,expectedFingerprint:modelFingerprint,ready:documents>0&&missing===0&&stale===0&&modelMatches};}
  remember(message,seq){this.db.prepare('INSERT OR REPLACE INTO recent_messages VALUES(?,?,?)').run(message.id,seq,JSON.stringify(message));const keep=new Set(recentTurns(this.recent(),100).map(m=>m.id));for(const row of this.db.prepare('SELECT id FROM recent_messages').all())if(!keep.has(row.id))this.db.prepare('DELETE FROM recent_messages WHERE id=?').run(row.id);}
  recent(){return this.db.prepare('SELECT body FROM recent_messages ORDER BY seq').all().map(r=>JSON.parse(r.body));}
  snapshot(file){this.db.exec('PRAGMA wal_checkpoint(FULL)');this.db.exec(`VACUUM INTO '${file.replaceAll("'","''")}'`);}
  close(){this.db.close();}
}
