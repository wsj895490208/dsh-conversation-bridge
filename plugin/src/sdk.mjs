import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {requireValue} from './util.mjs';

export function packageLoader(moduleRoot) {
  // moduleRoot is an explicit test adapter, never derived from user data paths.
  const load=moduleRoot?async(name,subpath)=>import(pathToFileURL(join(moduleRoot,name,subpath==='package.json'?'package.json':subpath?'lib/types/'+subpath+'.js':'lib/index.js')),subpath==='package.json'?{with:{type:'json'}}:undefined):async(name,subpath)=>import('@deepseek-ai/'+name+(subpath?'/'+subpath:''),subpath==='package.json'?{with:{type:'json'}}:undefined);
  return load;
}
export async function checkCompatibility(load) {
  const {default:meta}=await load('dsh-session','package.json');
  requireValue(meta.version==='0.2.1-rc.3','unsupported_host','当前只验证过 DSH 0.2.1-rc.3，已停止导入',{version:meta.version});
  const [{BasicCompactionEngine},{sessionFormatCatalog},{Session}] = await Promise.all([load('dsh-compaction-basic'),load('dsh-session-format-catalog'),load('dsh-session')]);
  requireValue(BasicCompactionEngine?.prototype.summarize && BasicCompactionEngine?.prototype.compactIfNeeded && sessionFormatCatalog?.encodeCurrentHeader && Session?.fromRestore,'unsupported_host','宿主会话或压缩接口不兼容');
  return {compatible:true,harness:'0.2.1-rc.3',nativeFormat:4};
}
