import {Worker} from 'node:worker_threads';
import {BridgeError} from './util.mjs';

// Parsing has no model/native ML dependency. Keep it off the host event loop,
// with explicit cancellation, timeout, and clean-exit handling.
export function runImportWorker(action,data,{signal,timeoutMs=120000,entry=new URL('./import-worker.mjs',import.meta.url)}={}){
  if(signal?.aborted)return Promise.reject(new BridgeError('job_paused','本地解析已暂停，原件保留'));
  return new Promise((resolve,reject)=>{
    let worker,timer,settled=false;
    const finish=(error,result)=>{
      if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);
      if(error){worker?.terminate().catch(()=>{});reject(error);}else resolve(result);
    };
    const abort=()=>finish(new BridgeError('job_paused','本地解析已暂停，原件保留'));
    try{
      worker=new Worker(entry,{workerData:{action,...data},execArgv:[]});
      worker.once('message',message=>message?.ok?finish(null,message.result):finish(new BridgeError(message?.code||'invalid_export',message?.message||'导出解析失败')));
      worker.once('error',error=>finish(error));
      worker.once('exit',code=>finish(new BridgeError('parse_worker_exit',`解析进程在返回结果前退出（${code}），可重试`)));
      signal?.addEventListener('abort',abort,{once:true});
      timer=setTimeout(()=>finish(new BridgeError('parse_timeout','本地解析超时，任务已停止；原件保留，可重试',{timeoutMs})),timeoutMs);
      if(signal?.aborted)abort();
    }catch(error){finish(error);}
  });
}
