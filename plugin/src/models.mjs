import {existsSync,readFileSync,renameSync,unlinkSync,createWriteStream,createReadStream,statSync} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {Readable} from 'node:stream';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {directory,hash,requireValue,writeJson} from './util.mjs';
export const modelPin=JSON.parse(readFileSync(new URL('../locks/model.json',import.meta.url),'utf8'));
export const bundledModelRoot=fileURLToPath(new URL('../models/',import.meta.url));
export const modelFingerprint=hash(JSON.stringify({files:Object.entries(modelPin.files).map(([name,spec])=>[name,spec.sha256]),pooling:'mean',normalize:true,maxLength:512}));
export function hasBundledModel(){return Object.keys(modelPin.files).every(name=>existsSync(join(bundledModelRoot,'multilingual-minilm',name)));}
async function fileHash(file,signal){const digest=createHash('sha256');for await(const chunk of createReadStream(file,{signal}))digest.update(chunk);return digest.digest('hex');}
export async function verifyModel(cache,{pin=modelPin,signal}={}){
  const folder=join(cache,'multilingual-minilm');
  for(const [name,expected] of Object.entries(pin.files)){
    signal?.throwIfAborted();
    const file=join(folder,name);
    if(!existsSync(file)||statSync(file).size!==expected.bytes||await fileHash(file,signal)!==expected.sha256)return false;
  }
  return true;
}
export async function ensureModel(cache,{signal,progress=()=>{},pin=modelPin,bundledRoot=bundledModelRoot,allowDownload=false,fetcher=globalThis.fetch}={}){
  const folder=directory(join(cache,'multilingual-minilm'));
  for(const [name,expected] of Object.entries(pin.files)){
    requireValue(!name.includes('..')&&!name.startsWith('/')&&!name.includes('\\'),'invalid_model_path','模型清单路径无效');
    signal?.throwIfAborted();const file=join(folder,name);
    if(existsSync(file)&&statSync(file).size===expected.bytes&&await fileHash(file,signal)===expected.sha256){progress({file:name,bytes:expected.bytes,total:expected.bytes,verified:true,source:'cache'});continue;}
    const packaged=bundledRoot&&join(bundledRoot,'multilingual-minilm',name),local=packaged&&existsSync(packaged);
    requireValue(local||allowDownload,'model_missing','安装包缺少本地模型，请重新安装含模型完整版；不会自动访问 Hugging Face');
    directory(dirname(file));const part=file+'.part-'+randomUUID();let bytes=0,lastReported=0;const digest=createHash('sha256'),source=local?'package':'download';
    try{
      progress({file:name,bytes:0,total:expected.bytes,verified:false,source});
      signal?.throwIfAborted();
      let input;
      if(local)input=createReadStream(packaged,{signal});
      else{const response=await fetcher(`https://huggingface.co/${pin.id}/resolve/${pin.revision}/${expected.source||name}`,{signal});requireValue(response.ok,'model_download_failed',`开发模型下载失败（${response.status}），可以重试`,{file:name});input=response.body;}
      await pipeline(Readable.from((async function*(){for await(const chunk of input){signal?.throwIfAborted();bytes+=chunk.length;requireValue(bytes<=expected.bytes,'model_integrity','模型文件长度超出清单');digest.update(chunk);if(bytes-lastReported>=1048576){lastReported=bytes;progress({file:name,bytes,total:expected.bytes,verified:false,source});}yield chunk;}})()),createWriteStream(part),{signal});
      requireValue(bytes===expected.bytes&&digest.digest('hex')===expected.sha256,'model_integrity','模型文件校验失败，请重新安装完整版或重试开发准备',{file:name});
      renameSync(part,file);progress({file:name,bytes,total:expected.bytes,verified:true,source});
    }catch(error){if(existsSync(part))unlinkSync(part);throw error;}
  }
  writeJson(join(cache,'verified-model.json'),{...pin,verifiedAt:new Date().toISOString()});
}
