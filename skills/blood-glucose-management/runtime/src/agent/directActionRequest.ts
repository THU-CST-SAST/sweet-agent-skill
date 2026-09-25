import type { AapsToolCall } from './aapsTools';

export type DirectActionRequest =
  | {kind: 'reply'; text: string}
  | {kind: 'action'; call: AapsToolCall; description: string};

export function resolveDirectActionRequest(query: string): DirectActionRequest | null {
  const text = query.trim();
  const basal = /基础率|temp\s*basal/i.test(text);
  const bolus = /(?:注射|输注|打针|帮我打)/i.test(text) || /(?:提交|执行|发送|给我|deliver).*bolus/i.test(text);
  const carbs = /(?:记录|录入).*(?:碳水|克|g)/i.test(text);
  if (!((basal && /设置|修改|调整|上调|下调|提高|降低|设为|取消|停止/.test(text)) || bolus || carbs)) return null;
  if (/什么是|是什么|定义|原理|如何|怎么|为什么|建议|是否|能否|应该|怎么办|分析|仿真|安全吗|危险|低血糖|昏迷|酮体|然后|并且|同时|先.*再|记录.*历史|注射记录/.test(text)) return null;
  if (/(?:读取|查询|查看|列出).*并/.test(text)) return null;
  if (/不要|不执行|只查询|只读取|别|假设|例如|举例|如果/.test(text)) {
    return {kind:'reply', text:'本轮不执行设备操作，没有发送治疗命令。请明确要查询的内容。'};
  }
  const reply = (message: string): DirectActionRequest => ({kind:'reply',text:`${message}\n尚未发送任何命令。参数明确后会先展示精确动作，等你确认。`});
  const action = (name: AapsToolCall['name'], args: Record<string, unknown>, description: string): DirectActionRequest => ({
    kind:'action',call:{id:`direct-${name}-${Date.now()}`,name,arguments:{...args,reason:text,confidence:1}},description,
  });
  if (basal) {
    if (/永久|长期|修改.*Profile|修改.*配置/i.test(text)) return reply('当前工具只支持临时基础率，不修改长期 Profile。');
    if (!/临时|temp\s*basal/i.test(text)) return reply('请明确是否调整“临时基础率”，以及持续多久。若要上调或下调百分比，还需说明相对 Profile 计划基础率，还是当前正在执行的基础率。');
    if (/取消|停止/.test(text)) return action('aaps_cancel_temp_basal',{},'取消当前临时基础率');
    const duration = text.match(/(?:持续|维持|执行|时长|时间)?\s*(\d+(?:\.\d+)?)\s*(分钟|小时|min(?:utes?)?|hours?)/i);
    if (!duration) return reply('临时基础率要持续多久？请同时明确最终百分比（相对 Profile 计划基础率）或绝对基础率 U/h。');
    const durationMinutes = Number(duration[1]) * (/小时|hour/i.test(duration[2])?60:1);
    if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) return reply('持续时间必须是大于 0 的整数分钟。');
    const percent = text.match(/(-?\d+(?:\.\d+)?)\s*[%％]/);
    const rate = text.match(/(-?\d+(?:\.\d+)?)\s*(?:U\s*\/\s*h|单位\s*\/\s*小时)/i);
    if (percent && rate) return reply('百分比和绝对基础率只能选择一种，请明确最终要执行的方式。');
    if (percent) {
      if (!/Profile|计划|预设/i.test(text)) return reply('请明确百分比相对 Profile 计划基础率；“相对当前执行值”的调整不能直接当作 Profile 百分比。');
      if (/相对当前|当前(?:正在)?(?:基础率|执行值|执行的基础率)|当前值/.test(text)) return reply('参照值不明确。请只指定相对 Profile 计划基础率的最终百分比，或直接提供绝对值 U/h。');
      const amount = Number(percent[1]);
      const up = /上调|提高|增加/.test(text), down = /下调|降低|减少/.test(text);
      if (up && down) return reply('调整方向不明确，请提供一个最终百分比。');
      const target = up ? 100 + amount : down ? 100 - amount : amount;
      if (amount < 0 || !Number.isFinite(target) || target < 0) return reply('百分比无效，请提供非负的最终百分比。');
      if (!Number.isInteger(target)) return reply('当前中转站命令无法明确区分小数百分比和绝对基础率，请提供整数百分比或绝对值 U/h。');
      return action('aaps_temp_basal_percent',{percent:target,durationMinutes},`临时基础率设为 Profile 计划基础率的 ${target}%，持续 ${durationMinutes} 分钟`);
    }
    if (rate) {
      if (/上调|提高|增加|下调|降低|减少/.test(text)) return reply('绝对基础率请提供调整后的最终值 U/h，不自动推算当前执行值。');
      const rateUph=Number(rate[1]);
      if (!Number.isFinite(rateUph)||rateUph<0) return reply('绝对基础率须为非负数，单位 U/h。');
      // Integer absolute BASAL commands are ambiguous in the existing relay protocol.
      if(Number.isInteger(rateUph))return reply('当前中转站整数绝对基础率的编码存在歧义，暂不生成该命令；可以明确使用 Profile 百分比方式。');
      return action('aaps_temp_basal_absolute',{rateUph,durationMinutes},`临时基础率 ${rateUph} U/h，持续 ${durationMinutes} 分钟`);
    }
    return reply('请提供临时基础率最终百分比（相对 Profile）或绝对值 U/h。');
  }
  if (bolus) {
    const amount=text.match(/(-?\d+(?:\.\d+)?)\s*(?:U\b|单位)/i);
    if(!amount||Number(amount[1])<=0)return reply('请明确大剂量数值和单位 U，不自动计算或补齐剂量。');
    return action('aaps_bolus',{insulinU:Number(amount[1])},`提交用户指定的大剂量 ${Number(amount[1])} U`);
  }
  const amount=text.match(/(-?\d+(?:\.\d+)?)\s*(?:克|g\b)/i);
  if(!amount||Number(amount[1])<=0)return reply('请提供要记录的碳水克数。');
  return action('aaps_record_carbs',{carbsG:Number(amount[1])},`记录用户指定的碳水 ${Number(amount[1])} g`);
}
