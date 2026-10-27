import {existsSync,readFileSync,renameSync,unlinkSync,createWriteStream} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {pipeline} from 'node:stream/promises';
import {Readable} from 'node:stream';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {directory,hash,requireValue,writeJson} from './util.mjs';
export const modelPin=JSON.parse(readFileSync(new URL('../locks/model.json',import.meta.url),'utf8'));
const verified=new Set();
export async function verifyModel(cache){
  const folder=join(cache,'multilingual-minilm');
  for(const [name,expected] of Object.entries(modelPin.files)){
    const file=join(folder,name);
    if(!existsSync(file)||hash(await readFile(file))!==expected.sha256)return false;
  }
  return true;
}
export async function ensureModel(cache,{signal,progress=()=>{}}={}){
  if(verified.has(cache))return;
  const folder=directory(join(cache,'multilingual-minilm'));
  for(const [name,expected] of Object.entries(modelPin.files)){
    signal?.throwIfAborted();const file=join(folder,name);
    if(existsSync(file)&&hash(await readFile(file))===expected.sha256){progress({file:name,bytes:expected.bytes,total:expected.bytes,verified:true});continue;}
    directory(dirname(file));const part=file+'.part';let bytes=0;const digest=createHash('sha256');
    try{
      progress({file:name,bytes:0,total:expected.bytes,verified:false});
      const response=await fetch(`https://huggingface.co/${modelPin.id}/resolve/${modelPin.revision}/${name}`,{signal});
      requireValue(response.ok,'model_download_failed',`模型下载失败（${response.status}），可以重试`,{file:name});
      await pipeline(Readable.from((async function*(){for await(const chunk of response.body){signal?.throwIfAborted();bytes+=chunk.length;requireValue(bytes<=expected.bytes,'model_integrity','模型下载长度超出清单');digest.update(chunk);progress({file:name,bytes,total:expected.bytes,verified:false});yield chunk;}})()),createWriteStream(part),{signal});
      requireValue(bytes===expected.bytes&&digest.digest('hex')===expected.sha256,'model_integrity','模型校验失败，未使用下载内容',{file:name});
      renameSync(part,file);
    }catch(error){if(existsSync(part))unlinkSync(part);throw error;}
  }
  writeJson(join(cache,'verified-model.json'),{...modelPin,verifiedAt:new Date().toISOString()});verified.add(cache);
}
