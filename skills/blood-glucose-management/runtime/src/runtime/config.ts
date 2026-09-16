import os from 'node:os';
import path from 'node:path';
export interface RuntimeConfig {
  stateDir?: string;
  model?: {baseUrl:string; model:string; apiKey:string; enabled?:boolean};
  nightscout?: {url:string; apiToken?:string; authMode?:'api-secret'|'token'; allowLocalHttp?:boolean};
  relay?: {baseUrl:string; deviceId:string; aiKey:string};
}
export function stateDirectory(config:RuntimeConfig){return config.stateDir||path.join(os.homedir(),'.local/share/sweetonline-agent');}
export function configFromEnv(env:NodeJS.ProcessEnv=process.env):RuntimeConfig {
  return {
    stateDir:env.AGENT_STATE_DIR,
    ...(env.LLM_API_KEY?{model:{baseUrl:env.LLM_BASE_URL||'https://api.deepseek.com',model:env.LLM_MODEL||'deepseek-chat',apiKey:env.LLM_API_KEY}}:{}),
    ...(env.NIGHTSCOUT_URL?{nightscout:{url:env.NIGHTSCOUT_URL,apiToken:env.NIGHTSCOUT_TOKEN,authMode:env.NIGHTSCOUT_AUTH_MODE==='token'?'token':'api-secret'}}:{}),
    ...(env.AAPS_DEVICE_ID&&env.AAPS_AI_KEY?{relay:{baseUrl:env.AAPS_RELAY_URL||'https://ai-server.phpjxc.com',deviceId:env.AAPS_DEVICE_ID,aiKey:env.AAPS_AI_KEY}}:{}),
  };
}
export function requireHttps(value:string,allowLocalHttp=false){
  const url=new URL(value);
  if(url.username||url.password||url.search||url.hash)throw Error('Service URL must not contain credentials, query parameters or fragments');
  if(url.protocol!=='https:'&&!(allowLocalHttp&&url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw Error('HTTPS is required');
  return url.href.replace(/\/+$/,'');
}
