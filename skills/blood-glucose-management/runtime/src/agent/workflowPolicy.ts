import type {AgentTaskRoute} from './types';

// Direct commands have already been resolved before this decision is used.
export function needsTaskPlanning(query: string, route: AgentTaskRoute): boolean {
  if (route !== 'rag_qa') return true;
  if (/什么是|是什么|定义|原理|为什么|如何|怎么|介绍|解释|what is|why|how does/i.test(query)) return false;
  return /读取|查询|查看|调取|列出|记录|录入|设置|调整|上调|下调|注射|输注|取消|停止|分析|对比|比较|建议|执行|read|fetch|set|inject/i.test(query);
}
