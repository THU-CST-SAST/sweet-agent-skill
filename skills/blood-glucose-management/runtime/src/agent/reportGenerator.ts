import type { AgentStateSnapshot, AgentTaskRoute } from './types';

const TREND_LABELS: Record<string, string> = {
  rapidly_rising: '快速上升',
  rising: '上升',
  gently_rising: '缓慢上升',
  stable: '平稳',
  gently_falling: '缓慢下降',
  falling: '下降',
  rapidly_falling: '快速下降',
  unknown: '趋势未知',
};

export function generateDeterministicNarrative(
  route: AgentTaskRoute,
  state: AgentStateSnapshot,
): string {
  if (state.dataQuality.status === 'insufficient') {
    return `这个时间窗只有 ${state.dataQuality.validReadings} 个有效血糖点，暂时不足以可靠分析。请先同步更多数据。`;
  }
  if (route === 'current_state') return currentStateText(state);
  if (route === 'daily_report') return periodReportText('今日', state);
  if (route === 'weekly_report') return periodReportText('近 7 天', state);
  return '我会根据已审核知识库回答；涉及当前血糖状态时，会同时引用确定性代码计算出的数据特征。';
}

function currentStateText(state: AgentStateSnapshot): string {
  const glucose = state.glucose;
  const slope = formatNumber(glucose.slope30Min, 2);
  const projection = glucose.projected30MinMgdl === null
    ? '无法形成 30 分钟线性外推'
    : `按当前线性趋势外推约 ${glucose.projected30MinMgdl} mg/dL`;
  return [
    `当前最新血糖为 ${formatNumber(glucose.currentMgdl, 0)} mg/dL，30 分钟趋势为${TREND_LABELS[glucose.trend]}。`,
    `趋势来自最近 ${glucose.trendSampleCount} 个点的线性回归，斜率 ${slope} mg/dL/min；${projection}。`,
    `过去 24 小时 TIR ${formatPercent(glucose.tirPercent)}，低于范围 ${formatPercent(glucose.tbrPercent)}，高于范围 ${formatPercent(glucose.tarPercent)}，CV ${formatPercent(glucose.cvPercent)}。`,
    `数据覆盖率 ${state.dataQuality.coveragePercent}%，质量状态：${qualityLabel(state.dataQuality.status)}。`,
  ].join('\n\n');
}

function periodReportText(label: string, state: AgentStateSnapshot, includeRecommendations = false): string {
  const glucose = state.glucose;
  const risks = state.riskFlags.length ? state.riskFlags.join('、') : '未触发代码级风险标记';
  const lines = [
    `${label}数据摘要：共 ${state.sourceCounts.glucose} 个有效血糖点，覆盖率 ${state.dataQuality.coveragePercent}%。`,
    `平均血糖 ${formatNumber(glucose.meanMgdl, 1)} mg/dL，范围 ${formatNumber(glucose.minMgdl, 0)}–${formatNumber(glucose.maxMgdl, 0)} mg/dL，标准差 ${formatNumber(glucose.standardDeviationMgdl, 1)}，CV ${formatPercent(glucose.cvPercent)}。`,
    `TIR ${formatPercent(glucose.tirPercent)}，TBR ${formatPercent(glucose.tbrPercent)}，TAR ${formatPercent(glucose.tarPercent)}。`,
    `治疗记录：碳水 ${state.treatments.carbsTotalG} g / ${state.treatments.carbCount} 次，bolus ${state.treatments.bolusTotalU} U / ${state.treatments.bolusCount} 次。`,
    `风险标记：${risks}。这些标记由固定阈值和数值计算生成，不是大模型猜测。`,
  ];
  if (includeRecommendations) {
    lines.push(`后续建议：\n${generateFollowUpRecommendations(state).map(item => `• ${item}`).join('\n')}`);
  }
  return lines.join('\n\n');
}

export function generateFollowUpRecommendations(state: AgentStateSnapshot): string[] {
  const recommendations: string[] = [];
  if (state.dataQuality.status !== 'good') {
    recommendations.push(
      `先改善数据连续性：本周覆盖率 ${state.dataQuality.coveragePercent}%，重点检查超过 20 分钟的数据中断和过期读数。`,
    );
  }
  if ((state.glucose.tbrPercent ?? 0) > 4) {
    recommendations.push(
      `低血糖时间占比 ${formatPercent(state.glucose.tbrPercent)}，优先复盘低值发生的时段、活动胰岛素和进食记录，并与专业人员核对既有方案。`,
    );
  }
  if ((state.glucose.tarPercent ?? 0) > 25) {
    recommendations.push(
      `高血糖时间占比 ${formatPercent(state.glucose.tarPercent)}，按餐后、夜间和持续高值分组复盘，不依据周报直接修改剂量。`,
    );
  }
  if ((state.glucose.cvPercent ?? 0) >= 36) {
    recommendations.push(
      `血糖变异系数 ${formatPercent(state.glucose.cvPercent)}，波动偏大，下一周优先记录高波动时段对应的进食、运动和治疗事件。`,
    );
  }
  if (state.treatments.carbCount === 0) {
    recommendations.push('本周没有可用的碳水记录；后续结论应标记这一限制，不反推或虚构历史进食。');
  }
  if (!recommendations.length) {
    recommendations.push('本周主要指标未触发固定风险阈值；继续保持记录，并观察是否存在重复出现的餐后或夜间模式。');
  }
  recommendations.push('以上是数据复盘建议，不构成自动治疗指令；涉及剂量或处置时仍需人工确认。');
  return recommendations;
}

function formatNumber(value: number | null, digits: number): string {
  return value === null ? '—' : value.toFixed(digits);
}

function formatPercent(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}%`;
}

function qualityLabel(value: AgentStateSnapshot['dataQuality']['status']): string {
  return value === 'good' ? '良好' : value === 'partial' ? '部分缺失' : '不足';
}
