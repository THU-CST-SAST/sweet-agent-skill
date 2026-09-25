// Read intent is independent of the clinical report route and model availability.
export function isHistoryReadRequest(query: string): boolean {
  return /治疗历史|治疗记录|注射记录|碳水记录|输注记录|历史.*(?:治疗|胰岛素|碳水)/i.test(query)
    || /(?:读取|查询|查看|列出|查一下|看看)[\s\S]*(?:记录|历史)/i.test(query)
    || /(?:read|show|fetch|list|check)[\s\S]*(?:history|records|treatments)/i.test(query);
}

export function requestedHistoryMinutes(query: string): number | undefined {
  const explicit = query.match(/historyMinutes\s*[=:：]\s*(\d+)/i);
  if (explicit) return Number(explicit[1]);
  const period = query.match(/(?:最近|过去|近|last|past)\s*(\d+(?:\.\d+)?)\s*(分钟|小时|天|日|周|minutes?|hours?|days?|weeks?)/i);
  if (period) {
    const unit = period[2].toLowerCase();
    const factor = /分钟|minute/.test(unit) ? 1 : /小时|hour/.test(unit) ? 60 : /周|week/.test(unit) ? 10080 : 1440;
    return Number(period[1]) * factor;
  }
  if (/(?:最近|过去|近)\s*(?:一|1)\s*周|最近一周|周报/i.test(query)) return 10080;
  if (/(?:最近|过去|近)\s*(?:一|1)\s*天/.test(query)) return 1440;
  return undefined;
}

export function isExplicitReadOnly(query: string): boolean {
  return /只(?:查询|读取|查看)|不(?:要)?执行(?:任何)?治疗|read[ -]?only/i.test(query);
}
