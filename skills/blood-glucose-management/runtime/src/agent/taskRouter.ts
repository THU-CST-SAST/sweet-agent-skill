import type { AgentTaskRoute } from './types';

const ROUTE_PATTERNS: Array<{ route: AgentTaskRoute; patterns: RegExp[] }> = [
  {
    route: 'weekly_report',
    patterns: [/周报/, /本周/, /最近一周/, /过去(7|七)天/, /weekly/i],
  },
  {
    route: 'daily_report',
    patterns: [
      /日报/,
      /今日总结/,
      /今天.*(复盘|总结|报告|血糖.*怎么样)/,
      /昨天.*(复盘|总结|数据|报告|血糖.*怎么样)/,
      /today.*(glucose|summary|report)/i,
      /daily/i,
    ],
  },
  {
    route: 'current_state',
    patterns: [
      /(建议|怎么办|怎么处理|下一步).*(血糖|状态|现在|当前)/,
      /(血糖|状态|现在|当前).*(建议|怎么办|怎么处理|下一步)/,
      /当前状态/,
      /现在.*血糖/,
      /目前.*血糖/,
      /血糖.*趋势/,
      /血糖.*(怎样|怎么样|如何|情况)/,
      /(看|查|检查|分析).*血糖/,
      /血糖.*(高|低|稳定|波动)/,
      /正在.*(升|降)/,
      /current state/i,
      /glucose.*(now|current|trend|status)/i,
    ],
  },
];

export function routeAgentTask(
  query: string,
  forcedRoute?: AgentTaskRoute,
): AgentTaskRoute {
  if (forcedRoute) return forcedRoute;
  const normalized = query.trim();
  for (const candidate of ROUTE_PATTERNS) {
    if (candidate.patterns.some(pattern => pattern.test(normalized))) {
      return candidate.route;
    }
  }
  return 'rag_qa';
}
