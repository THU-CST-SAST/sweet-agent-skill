import type {AapsToolCall, AapsToolProvider} from './aapsTools';

export interface ActionDraft {
  operation: 'basal' | 'bolus' | 'carbs' | 'cancel_basal';
  temporary?: boolean;
  durationMinutes?: number;
  mode?: 'relative_percent' | 'percent' | 'absolute';
  reference?: 'current' | 'profile';
  amount?: number;
  direction?: 'increase' | 'decrease';
  updatedAt: string;
  deviceId?: string;
}

export interface ActionInterpretation {
  intent: 'action' | 'update' | 'cancel' | 'other';
  operation?: ActionDraft['operation'];
  // Values are extracted from quoted user text by code, never supplied as a dose by the model.
  evidence?: {duration?: string; amount?: string; reference?: string; temporary?: string};
}

export function numberText(input: string): string {
  const digits: Record<string, number> = {零:0,一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9};
  const convert=(token:string):number=>{
    let total=0,current=0;
    for(const char of token){
      if(char==='十'||char==='百'){total+=(current||1)*(char==='十'?10:100);current=0;}
      else current=digits[char];
    }
    return total+current;
  };
  return input.replace(/百分之([零一二两三四五六七八九十百]+)/g,(_,n)=>`${convert(n)}%`)
    .replace(/([零一二两三四五六七八九十百]+)个?半小时/g,(_,n)=>`${convert(n)+0.5}小时`)
    .replace(/半个?小时|半小时/g,'0.5小时')
    .replace(/([零一二两三四五六七八九十百]+)(?=\s*(?:个)?(?:小时|分钟|天|日|周|克|单位|U|[%％]))/g,(_,n)=>String(convert(n)))
    .replace(/(\d+)\s*个\s*小时/g,'$1小时');
}

export function isActionConversation(query:string, draft?:ActionDraft): boolean {
  if (/是什么|什么是|如何|怎么|为什么|建议|分析|仿真|如果|假设|例如|历史|记录.*(?:查|看)|注射记录/.test(query)) return false;
  if (draft && (/^(?:算了|取消|不做了|先不操作)[。！!\s]*$/.test(query)
    || /小时|分钟|持续|相对|参照|Profile|计划基础率|当前执行|确认|改成|设为/i.test(query))) return true;
  return /基础率.*(?:上调|下调|提高|降低|调整|设为)|(?:调整|设置|取消|停止).*基础率|(?:记录|录入).*碳水|^(?:请|帮我|给设备)?\s*(?:注射|输注|打)\s*[\d零一二两三四五六七八九]/.test(query);
}

export function mergeActionDraft(query:string, previous:ActionDraft|undefined, model:ActionInterpretation|null, now:Date):ActionDraft|null {
  if (model?.intent==='other') return null;
  const text=numberText(query);
  if(/不执行|只查询|只读取|不要|别|已经|刚刚.*(?:注射|输注)|打过|注射过|应该|是否|建议|可以吗|如何|怎么|如果|假设|例如/.test(text))return null;
  const operation:ActionDraft['operation']|undefined = /取消|停止/.test(text)&&/临时基础率/.test(text)?'cancel_basal'
    :/基础率/.test(text)?'basal':/(?:记录|录入).*碳水/.test(text)?'carbs'
    :/注射|输注|(?:帮我)?打\s*\d/.test(text)?'bolus':model?.operation??previous?.operation;
  if(!operation)return null;
  const draft:ActionDraft={...(previous?.operation===operation?previous:{}),operation,updatedAt:now.toISOString()};
  // Model evidence must be verbatim in the latest user message. Context is already in the draft.
  const evidence=(name:keyof NonNullable<ActionInterpretation['evidence']>)=>{
    const quote=model?.evidence?.[name];
    return typeof quote==='string'&&quote.length>0&&query.includes(quote)?numberText(quote):text;
  };
  const duration=evidence('duration').match(/(-?\d+(?:\.\d+)?)\s*(分钟|小时)/);
  if(duration)draft.durationMinutes=Number(duration[1])*(duration[2]==='小时'?60:1);
  if(/临时/.test(evidence('temporary')))draft.temporary=true;
  if(/永久|长期/.test(evidence('temporary')))draft.temporary=false;
  if(/当前执行|当前正在|当前值|当前基础率/.test(evidence('reference')))draft.reference='current';
  else if(/profile|计划|预设/i.test(evidence('reference')))draft.reference='profile';
  const amount=evidence('amount');
  const percent=amount.match(/(-?\d+(?:\.\d+)?)\s*[%％]/);
  const rate=amount.match(/(-?\d+(?:\.\d+)?)\s*U\s*\/\s*h/i);
  if(operation==='basal'){
    if(percent){draft.amount=Number(percent[1]);draft.mode=/上调|提高|增加|下调|降低|减少/.test(text)?'relative_percent':'percent';}
    if(rate){draft.amount=Number(rate[1]);draft.mode='absolute';delete draft.reference;}
    if(/上调|提高|增加/.test(text))draft.direction='increase';
    if(/下调|降低|减少/.test(text))draft.direction='decrease';
  }else{
    const value=amount.match(operation==='carbs'?/(-?\d+(?:\.\d+)?)\s*(?:克|g\b)/i:/(-?\d+(?:\.\d+)?)\s*(?:U\b|单位)/i);
    if(value)draft.amount=Number(value[1]);
  }
  return draft;
}

export async function prepareActionDraft(draft:ActionDraft, provider:AapsToolProvider|null, now:Date):Promise<{text:string;call?:AapsToolCall;description?:string;draft:ActionDraft}> {
  const known=[draft.operation==='basal'?'临时基础率操作':draft.operation,
    draft.durationMinutes!==undefined?`持续 ${draft.durationMinutes} 分钟`:null,
    draft.reference?`参照：${draft.reference==='current'?'当前执行值':'Profile 计划值'}`:null,
    draft.amount!==undefined?`用户指定数值：${draft.amount}`:null].filter(Boolean).join('；');
  const stop=(reason:string)=>({text:`已保留：${known}。\n${reason}\n尚未发送命令。`,draft});
  if(draft.operation==='basal'){
    if(draft.temporary!==true)return stop(`请明确是否设置临时基础率${draft.durationMinutes===undefined?'以及持续多久':''}；本工具不修改永久 Profile。`);
    if(draft.durationMinutes===undefined)return stop('还缺持续时间，请补充持续多久。');
    if(!Number.isInteger(draft.durationMinutes)||draft.durationMinutes<=0||draft.durationMinutes>1440)return stop('当前工具持续时间须为 1–1440 分钟内的整数。');
    if(draft.amount===undefined||!draft.mode)return stop('还缺调整幅度或最终绝对基础率。');
    if(draft.mode==='relative_percent'&&!draft.direction)return stop('还缺调整方向，上调还是下调？');
    if(draft.mode!=='absolute'&&!draft.reference)return stop('还缺参照：相对当前执行值，还是 Profile 计划值？');
  }
  if(draft.operation!=='cancel_basal'&&(draft.amount===undefined||!Number.isFinite(draft.amount)||draft.amount<0))return stop('操作数值缺失或无效。');
  if((draft.operation==='carbs'||draft.operation==='bolus')&&draft.amount===0)return stop('该操作数值必须大于零。');
  if(!provider)return stop('无法核对目标设备：中转站未配置。');
  let status;
  try{status=await provider.invoke({id:'action-preflight',name:'aaps_read_pump_status',arguments:{requireRelay:true}});}catch{return stop('目标设备状态读取失败，请重试；已保留上述参数。');}
  const data=status.data;
  if(status.status!=='succeeded'||data?.source!=='aaps_relay')return stop('未取得同一目标设备的中转站状态，不能把 NS 状态自动当作该设备状态。');
  const target=data.device_id;
  if(typeof target!=='string')return stop('中转站状态缺少设备标识，无法核对目标。');
  if(draft.deviceId&&draft.deviceId!==target)return stop('目标设备发生变化，已保留参数但不会迁移到另一台设备，请重新发起操作。');
  draft={...draft,deviceId:target};
  if(data.offline===true||data.pump_connected===false)return stop('中转站报告设备离线或泵未连接，暂不生成可执行动作。');
  const lastSeen=Date.parse(String(data.last_seen??''));
  if(!Number.isFinite(lastSeen)||now.getTime()-lastSeen>5*60000||lastSeen>now.getTime()+60000)return stop('目标设备状态缺少有效时间戳或已过期，请先刷新设备状态；参数已保留。');
  if(draft.operation!=='carbs' && data.pump_connected!==true)return stop('目标设备没有提供明确的泵连接状态，尚不能完成设备核对。');
  let name:AapsToolCall['name'];let args:Record<string,unknown>;let description:string;
  if(draft.operation==='basal'){
    if(draft.mode!=='absolute'&&draft.reference==='current'){
      // No guessed aliases or suggested rates: only an explicitly verified current-rate field is accepted.
      const rate=data.currentBasalUph;
      const at=Date.parse(String(data.currentBasalAt??''));
      if(typeof rate!=='number'||!Number.isFinite(rate)||rate<0||!Number.isFinite(at)||now.getTime()-at>5*60000||at>now.getTime()){
        return stop('已查询中转站，但返回中没有可核验的当前执行基础率及其时间戳。缺的是这个读数，不是持续时间；不能用 Profile 值或建议值替代。');
      }
      if(draft.mode==='relative_percent'&&!draft.direction)return stop('还缺调整方向：上调还是下调？');
      const factor=draft.mode==='relative_percent'?1+(draft.direction==='decrease'?-1:1)*draft.amount!/100:draft.amount!/100;
      const rateUph=Math.round(rate*factor*1e6)/1e6;
      if(rateUph<0||Number.isInteger(rateUph))return stop('计算结果暂不能用当前中转站绝对基础率命令无歧义地表示，请核对接口能力。');
      name='aaps_temp_basal_absolute';args={rateUph,durationMinutes:draft.durationMinutes};
      description=`基于设备当前执行值 ${rate} U/h（${data.currentBasalAt}），设为 ${rateUph} U/h，持续 ${draft.durationMinutes} 分钟`;
    }else if(draft.mode==='absolute'){
      if(Number.isInteger(draft.amount))return stop('当前中转站整数绝对基础率命令存在编码歧义，未生成命令。');
      name='aaps_temp_basal_absolute';args={rateUph:draft.amount,durationMinutes:draft.durationMinutes};description=`设为 ${draft.amount} U/h，持续 ${draft.durationMinutes} 分钟`;
    }else{
      if(draft.mode==='relative_percent'&&!draft.direction)return stop('还缺调整方向：上调还是下调？');
      const percent=draft.mode==='relative_percent'?100+(draft.direction==='decrease'?-1:1)*draft.amount!:draft.amount!;
      if(!Number.isInteger(percent)||percent<0)return stop('最终百分比无法通过当前接口校验。');
      name='aaps_temp_basal_percent';args={percent,durationMinutes:draft.durationMinutes};description=`设为 Profile 计划基础率的 ${percent}%，持续 ${draft.durationMinutes} 分钟`;
    }
  }else if(draft.operation==='bolus'){name='aaps_bolus';args={insulinU:draft.amount};description=`用户指定大剂量 ${draft.amount} U`;
  }else if(draft.operation==='carbs'){name='aaps_record_carbs';args={carbsG:draft.amount};description=`记录碳水 ${draft.amount} g`;
  }else{name='aaps_cancel_temp_basal';args={};description='取消临时基础率';}
  const call:AapsToolCall={id:`action-${now.getTime()}`,name,arguments:{...args,expectedDeviceId:target,reason:description,confidence:1}};
  return {draft,call,description:`设备 ${target}：${description}`,text:`待确认：设备 ${target}，${description}。\n已核对参数及目标设备，尚未发送命令，等待用户确认；这不是临床安全保证，执行端仍需进行安全校验。`};
}
