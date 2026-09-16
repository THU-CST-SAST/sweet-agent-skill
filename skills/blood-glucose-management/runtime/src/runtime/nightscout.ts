import {createHash} from 'node:crypto';
import type {RuntimeConfig} from './config';
import {requireHttps} from './config';

export function recordTime(r:any):number {
  for(const v of [r.date,r.timestamp,r.created_at,r.dateString,r.mills]){
    if(v==null||v==='')continue;
    const t=typeof v==='number'?v:Date.parse(v);
    if(Number.isFinite(t)&&t>0)return Math.trunc(t);
  }
  return NaN;
}
export function normalizeGlucose(records:any[]){
  const seen=new Set<string>();
  return records.filter(r=>r.isValid!==false).flatMap(r=>{
    const date=recordTime(r),raw=Number(r.sgv),sgv=/mmol/i.test(r.units||'')?raw*18:raw;
    if(!Number.isFinite(date)||!Number.isFinite(sgv)||sgv<=0)return [];
    const key=`${date}:${sgv}`;if(seen.has(key))return [];seen.add(key);
    return [{...r,date,sgv,units:'mg/dl',sourceGlucose:{value:r.sgv,units:r.units??'mg/dl'},dateString:new Date(date).toISOString()}];
  }).sort((a,b)=>a.date-b.date);
}
export class NightscoutReader {
  private base:string;
  constructor(private config:NonNullable<RuntimeConfig['nightscout']>,private fetcher:typeof fetch=fetch){this.base=requireHttps(config.url,config.allowLocalHttp);}
  async request(collection:string,params:Record<string,string|number>={}){
    const url=new URL(`${this.base}/api/v1/${collection}.json`);
    for(const [k,v] of Object.entries(params))url.searchParams.set(k,String(v));
    const headers:Record<string,string>={Accept:'application/json'};
    if(this.config.apiToken){
      if(this.config.authMode==='token')headers['Authorization']=`Bearer ${this.config.apiToken}`;
      else headers['api-secret']=createHash('sha1').update(this.config.apiToken).digest('hex');
    }
    const r=await this.fetcher(url,{headers,redirect:'error',signal:AbortSignal.timeout(20000)});
    if(!r.ok)throw Error(`Nightscout ${collection}: HTTP ${r.status}`);
    const data=await r.json();
    if(!Array.isArray(data))throw Error(`Nightscout ${collection}: expected an array`);
    return data;
  }
  async range(collection:string,start:number,end:number,depth=0):Promise<any[]>{
    if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>31*86400000+1)throw Error('NS range must be positive and at most 31 days');
    const field=collection==='entries'?'date':'created_at';
    const bound=(v:number)=>field==='date'?v:new Date(v).toISOString();
    const rows=await this.request(collection,{count:1000,[`find[${field}][$gte]`]:bound(start),[`find[${field}][$lt]`]:bound(end)});
    if(rows.length>=1000){
      if(depth>=20||end-start<1000)throw Error(`Nightscout ${collection}: result limit exceeded`);
      const middle=Math.floor((start+end)/2);
      return [...await this.range(collection,start,middle,depth+1),...await this.range(collection,middle,end,depth+1)];
    }
    return rows.filter(r=>r.isValid!==false&&recordTime(r)>=start&&recordTime(r)<end).sort((a,b)=>recordTime(a)-recordTime(b));
  }
  async snapshot(input:{asOf?:string;historyMinutes?:number}={}){
    const warnings:string[]=[];
    const unavailableCollections:string[]=[];
    const latest=input.asOf==='latest'?normalizeGlucose(await this.request('entries',{count:1,'find[date][$gte]':0})).at(-1)?.date:null;
    const end=latest??(input.asOf&&input.asOf!=='latest'?Date.parse(input.asOf):Date.now());
    if(input.asOf==='latest'&&latest==null)throw Error('NS has no latest glucose');
    const minutes=input.historyMinutes??1440;
    if(!Number.isFinite(minutes)||minutes<=0||minutes>31*24*60)throw Error('historyMinutes must be in (0,44640]');
    const start=end-minutes*60000;
    const optional=async(name:string,fn:()=>Promise<any[]>)=>{try{return await fn();}catch(e){unavailableCollections.push(name);warnings.push(`${name}: ${(e as Error).message}`);return [];}};
    const entries=normalizeGlucose(await this.range('entries',start,end+1));
    const treatments=await optional('treatments',()=>this.range('treatments',start,end+1));
    // Select configuration and device state as of the anchor, never from its future.
    const profiles=await optional('profiles',()=>this.request('profile',{count:1000}));
    const applicable=profiles.filter(p=>{const t=Date.parse(p.startDate||p.created_at||'');return Number.isFinite(t)&&t<=end;}).sort((a,b)=>Date.parse(b.startDate||b.created_at)-Date.parse(a.startDate||a.created_at));
    if(profiles.length>=1000)warnings.push('Profile history reached 1000 records; older coverage may be incomplete');
    const devices=await optional('devicestatus',()=>this.range('devicestatus',Math.max(start,end-24*3600000),end+1));
    const deviceStatus=devices.filter(d=>d.openaps||d.loop).at(-1)??devices.at(-1)??null;
    if(!applicable.length)warnings.push('No dated Profile active at the requested time');
    return {entries,treatments,profile:applicable[0]??null,deviceStatus,asOf:new Date(end).toISOString(),rangeStart:new Date(start).toISOString(),sourceUrl:this.base,warnings,unavailableCollections};
  }
}
