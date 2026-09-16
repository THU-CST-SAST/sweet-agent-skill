import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,chmodSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
function canonical(value:any):string {
  if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')}}`;
  return JSON.stringify(value);
}
export class Journal {
  private db:DatabaseSync;
  constructor(dir:string){
    mkdirSync(dir,{recursive:true,mode:0o700});chmodSync(dir,0o700);
    const filename=path.join(dir,'runtime.sqlite');this.db=new DatabaseSync(filename);chmodSync(filename,0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS actions(id TEXT PRIMARY KEY,call_id TEXT NOT NULL,binding TEXT NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL,result TEXT,created INTEGER NOT NULL,UNIQUE(binding,call_id));
      CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,history TEXT NOT NULL);`);
  }
  prepare(call:any,binding:string){
    const payload=canonical(JSON.parse(JSON.stringify(call))),old=this.db.prepare('SELECT * FROM actions WHERE binding=? AND call_id=?').get(binding,call.id) as any;
    if(old){if(old.payload!==payload)throw Error('Call ID reused with different arguments');return old;}
    const id=randomUUID();
    this.db.prepare('INSERT INTO actions VALUES(?,?,?,?,?,?,?) ON CONFLICT(binding,call_id) DO NOTHING').run(id,call.id,binding,payload,'awaiting_confirmation',null,Date.now());
    const row=this.db.prepare('SELECT * FROM actions WHERE binding=? AND call_id=?').get(binding,call.id) as any;
    if(row.payload!==payload)throw Error('Call ID reused with different arguments');return row;
  }
  get(id:string,binding:string){const row=this.db.prepare('SELECT * FROM actions WHERE id=? AND binding=?').get(id,binding) as any;if(!row)throw Error('Unknown confirmation or target device changed');return row;}
  claim(id:string,binding:string){
    const row=this.get(id,binding);
    if(row.status!=='awaiting_confirmation')return false;
    if(Date.now()-Number(row.created)>15*60000)throw Error('Confirmation expired; create a fresh request');
    return this.db.prepare("UPDATE actions SET status='sending' WHERE id=? AND binding=? AND status='awaiting_confirmation'").run(id,binding).changes===1;
  }
  finish(id:string,result:any){this.db.prepare('UPDATE actions SET status=?,result=? WHERE id=?').run(result.executionStatus,JSON.stringify(result),id);}
  history(id:string){const r=this.db.prepare('SELECT history FROM sessions WHERE id=?').get(id) as any;return r?JSON.parse(r.history):[];}
  saveHistory(id:string,history:any[]){this.db.prepare('INSERT INTO sessions VALUES(?,?) ON CONFLICT(id) DO UPDATE SET history=excluded.history').run(id,JSON.stringify(history.slice(-24)));}
  close(){this.db.close();}
}
