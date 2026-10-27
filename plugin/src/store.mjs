import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { directory, json, parse, id, requireValue } from './util.mjs';

export class Store {
  constructor(root) {
    this.root=root; directory(root); this.db=new DatabaseSync(join(root,'registry.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(kind,id));
      CREATE TABLE IF NOT EXISTS usage(day TEXT,bucket TEXT,input INTEGER DEFAULT 0,output INTEGER DEFAULT 0,PRIMARY KEY(day,bucket));
      CREATE TABLE IF NOT EXISTS audit(seq INTEGER PRIMARY KEY,at TEXT,action TEXT,body TEXT);`);
    this.db.exec('CREATE TABLE IF NOT EXISTS reservations(id INTEGER PRIMARY KEY,day TEXT,bucket TEXT,input INTEGER,output INTEGER,actualInput INTEGER,actualOutput INTEGER,status TEXT,runId TEXT,jobId TEXT)');
  }
  get(kind,key,required=true) {const row=this.db.prepare('SELECT body FROM records WHERE kind=? AND id=?').get(kind,String(key)); requireValue(row||!required,'not_found','记录不存在',{kind,id:key});return row?parse(row.body):null;}
  all(kind) {return this.db.prepare('SELECT body FROM records WHERE kind=? ORDER BY rowid DESC').all(kind).map(r=>parse(r.body));}
  put(kind,value) {requireValue(value.id,'invalid_record','记录缺少标识');this.db.prepare('INSERT INTO records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body').run(kind,value.id,json(value));return value;}
  patch(kind,key,patch) {return this.put(kind,{...this.get(kind,key),...patch,updatedAt:new Date().toISOString()});}
  create(kind,body) {return this.put(kind,{id:id(kind),createdAt:new Date().toISOString(),...body});}
  audit(action,body) {this.db.prepare('INSERT INTO audit(at,action,body) VALUES(?,?,?)').run(new Date().toISOString(),action,json(body));}
  transaction(callback) {this.db.exec('BEGIN IMMEDIATE');try{const r=callback();this.db.exec('COMMIT');return r;}catch(e){this.db.exec('ROLLBACK');throw e;}}
  usage(bucket,day=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'})) {return this.db.prepare('SELECT input,output FROM usage WHERE day=? AND bucket=?').get(day,bucket)||{input:0,output:0};}
  reserve(bucket,input,output,limits,context={}) {const day=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});return this.transaction(()=>{const used=this.usage(bucket,day);requireValue(used.input+input<=limits.input&&used.output+output<=limits.output,'quota_exceeded','辅助调用额度已用尽，任务已暂停',{bucket,used,limits});this.db.prepare('INSERT INTO usage VALUES(?,?,?,?) ON CONFLICT(day,bucket) DO UPDATE SET input=input+excluded.input,output=output+excluded.output').run(day,bucket,input,output);const row=this.db.prepare('INSERT INTO reservations(day,bucket,input,output,status,runId,jobId) VALUES(?,?,?,?,?,?,?)').run(day,bucket,input,output,'reserved',context.runId||null,context.jobId||null);return {id:Number(row.lastInsertRowid),day,bucket,input,output};});}
  reconcile(reservation,actual) {if(!actual||!Number.isFinite(actual.input)||!Number.isFinite(actual.output)){if(reservation.id)this.db.prepare("UPDATE reservations SET status='unknown' WHERE id=? AND status='reserved'").run(reservation.id);return;}this.transaction(()=>{const row=reservation.id?this.db.prepare('SELECT status FROM reservations WHERE id=?').get(reservation.id):null;if(row?.status==='actual')return;this.db.prepare('UPDATE usage SET input=input+?,output=output+? WHERE day=? AND bucket=?').run(actual.input-reservation.input,actual.output-reservation.output,reservation.day,reservation.bucket);if(reservation.id)this.db.prepare("UPDATE reservations SET actualInput=?,actualOutput=?,status='actual' WHERE id=?").run(actual.input,actual.output,reservation.id);});}
  usageDetails(bucket){const day=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});const rows=this.db.prepare('SELECT * FROM reservations WHERE day=? AND bucket=?').all(day,bucket);const sum=(status,key)=>rows.filter(r=>r.status===status).reduce((n,r)=>n+(r[key]||0),0);const used=this.usage(bucket,day),tracked=rows.reduce((n,r)=>n+(r.status==='actual'?r.actualOutput:r.output),0);return {charged:used,actual:{input:sum('actual','actualInput'),output:sum('actual','actualOutput')},reserved:{input:sum('reserved','input'),output:sum('reserved','output')},unknown:{input:sum('unknown','input'),output:sum('unknown','output')},legacyUnverifiedOutput:Math.max(0,used.output-tracked)};}
  checkpoint() {this.db.exec('PRAGMA wal_checkpoint(FULL)');}
  backup(path) {this.checkpoint();this.db.exec(`VACUUM INTO '${String(path).replaceAll("'","''")}'`);}
  close() {this.checkpoint();this.db.close();}
}
