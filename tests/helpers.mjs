import {mkdtempSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {setTimeout} from 'node:timers/promises';
import {MemoryIndex,chunks} from '../plugin/src/memory.mjs';
import {hash} from '../plugin/src/util.mjs';
export function temp(prefix='case-'){const parent=resolve(import.meta.dirname,'.tmp');mkdirSync(parent,{recursive:true});return mkdtempSync(join(parent,prefix));}
export function corpus(turns=3,size=1){const mapping={root:{id:'root',parent:null,children:['1'],message:null}};for(let n=1;n<=turns*2;n++)mapping[n]={id:String(n),parent:n===1?'root':String(n-1),children:n===turns*2?[]:[String(n+1)],message:{inserted_at:'2020-01-01T00:00:00Z',fragments:[{type:n%2?'REQUEST':'RESPONSE',content:`NODE-${n} `+'synthetic history words '.repeat(size)+(n===turns*2?' FUTURE-TAIL-MARKER':'')}]}};return[{id:'synthetic',title:'Synthetic conversation',mapping}];}
export class FakeSemantic{
  constructor(){this.calls=0;}
  async call(action,args={}){if(action==='barrier')return{idle:true};if(action==='search')return[];if(action==='batch'){this.calls++;const index=new MemoryIndex(args.file);try{index.prepareVectorModel();const docs=index.db.prepare('SELECT * FROM docs ORDER BY rowid LIMIT ? OFFSET ?').all(args.limit,args.offset||0);for(const d of docs)for(const [n,body]of chunks(d.body).entries())index.db.prepare('INSERT OR REPLACE INTO vectors VALUES(?,?,?,?,?)').run(d.id,n,body,Buffer.alloc(384*4),hash(d.body));return{nextOffset:(args.offset||0)+docs.length,done:docs.length<args.limit};}finally{index.close();}}throw Error(action);}
  async stop(){}
}
export async function finish(service,job){service.kick();for(let n=0;n<12000;n++){const current=service.store.get('job',job.id);if(!['queued','running'].includes(current.status))return current;await setTimeout(5);}throw Error('Timed out waiting for synthetic job');}
