import {resolve} from 'node:path';
import {ensureModel} from '../plugin/src/models.mjs';
const cache=process.argv[2]||resolve(import.meta.dirname,'../data/models');
let last='';await ensureModel(cache,{progress:p=>{const mark=p.file+':'+Math.floor(p.bytes/10485760)+':'+p.verified;if(mark!==last){last=mark;console.log(JSON.stringify(p));}}});console.log('LOCAL_MODEL_VERIFIED');
