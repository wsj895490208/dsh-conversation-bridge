import {join,resolve,isAbsolute} from 'node:path';
import {homedir} from 'node:os';
import {existsSync} from 'node:fs';
import {readJson,writeJson,requireValue} from './util.mjs';
export function locationFile(env=process.env,userHome=homedir(),profile='desktop'){
  requireValue(/^[a-zA-Z0-9_-]+$/.test(profile),'invalid_profile','配置名称无效');
  return join(env.DSH_HOME?.trim()||join(userHome,'.dsh'),'conversation-bridge','locations',profile+'.json');
}
export function readLocation(file){const saved=existsSync(file)?readJson(file):{};requireValue(!saved.dataDir||isAbsolute(saved.dataDir),'invalid_path','已保存的数据目录不是绝对路径');return saved;}
export function saveLocation(file,{dataDir,modelCache=''}){requireValue(isAbsolute(dataDir)&&(!modelCache||isAbsolute(modelCache)),'invalid_path','请选择绝对目录');const value={dataDir:resolve(dataDir),modelCache:modelCache?resolve(modelCache):'',savedAt:new Date().toISOString()};writeJson(file,value);return value;}
