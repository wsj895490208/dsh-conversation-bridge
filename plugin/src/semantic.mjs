import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
export class SemanticWorker{
  constructor(modelCache,{execPath=process.execPath}={}){this.modelCache=modelCache;this.execPath=execPath;this.pending=new Map();this.seq=0;}
  start(){
    if(this.child)return this.child;
    const env={...process.env,ELECTRON_RUN_AS_NODE:'1'};delete env.NODE_OPTIONS;
    const child=fork(fileURLToPath(new URL('./semantic-worker.mjs',import.meta.url)),[this.modelCache],{execPath:this.execPath,execArgv:[],env,windowsHide:true,serialization:'json',stdio:['ignore','ignore','pipe','ipc']});
    this.child=child;let stderr='';child.stderr.on('data',b=>{stderr=(stderr+b).slice(-4096);});
    child.on('message',m=>{const p=this.pending.get(m?.id);if(!p||p.child!==child)return;this.pending.delete(m.id);m.error?p.reject(new Error(m.error)):p.resolve(m.result);});
    const fail=e=>{if(this.child===child)this.child=null;for(const [id,p]of this.pending)if(p.child===child){this.pending.delete(id);p.reject(e);}};
    child.on('error',fail);child.on('exit',(code,signal)=>fail(new Error(`向量进程退出（${code??signal}）${stderr}`)));
    return child;
  }
  call(action,data={}){if(this.stopping)return Promise.reject(new Error('向量进程正在停止'));const child=this.start(),id=++this.seq;return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject,child});child.send({id,action,...data},e=>{if(e&&this.pending.get(id)?.child===child){this.pending.delete(id);reject(e);}});});}
  async stop(){if(this.stopping)return this.stopping;const child=this.child;if(!child)return;this.stopping=new Promise(resolve=>{let timer;const done=()=>{clearTimeout(timer);resolve();};child.once('exit',done);if(child.exitCode!==null)return done();timer=setTimeout(()=>child.kill(),10000);timer.unref();if(child.connected)child.send({action:'shutdown'},e=>{if(e)child.kill();});else child.kill();}).finally(()=>{this.child=null;this.stopping=null;});return this.stopping;}
}
