import {readFileSync,createReadStream} from 'node:fs';
import {hash,requireValue} from './util.mjs';
export function imageType(bytes){if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';if(bytes.subarray(0,6).toString().startsWith('GIF8'))return 'image/gif';if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')return 'image/webp';return null;}
export async function attachImported(service,candidate,items){
  for(const item of items.filter(a=>a.status==='available')){
    const bytes=readFileSync(item.path);requireValue(hash(bytes)===item.sha256,'attachment_integrity','附件哈希发生变化');const mediaType=imageType(bytes);
    const ref=mediaType?{type:'image',attachment:await service.saveImage({data:new Uint8Array(bytes),mediaType,name:item.file_name})}:{type:'file',attachment:await service.saveFileStream({data:createReadStream(item.path),name:item.file_name})};
    for(const event of candidate.events)if(event.type==='user/message'&&item.nodes.some(n=>event.data.id.endsWith('-node-'+n))&&!event.data.content.some(b=>b.type===ref.type&&b.attachment?.id===ref.attachment?.id))event.data.content.push(ref);
  }
}
