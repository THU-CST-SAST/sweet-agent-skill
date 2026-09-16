import { storage } from '../services/storage';

const STORAGE_KEY = 'agent_model_config_v1';

export const AGENT_MODEL_BASE_URL = 'https://lab.cs.tsinghua.edu.cn/ai-platform/sub2api/v1';
export const AGENT_MODEL_NAME = 'k3';

export interface AgentModelConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
  enabled: boolean;
}

export function normalizeAgentModelBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  if (!normalized.startsWith('https://')) {
    throw new Error('服务地址必须使用 HTTPS');
  }
  return normalized;
}

export async function loadAgentModelConfig(): Promise<AgentModelConfig | null> {
  const raw = await storage.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    const saved = JSON.parse(raw) as Partial<AgentModelConfig>;
    if (typeof saved.apiKey !== 'string') return null;
    let baseUrl = AGENT_MODEL_BASE_URL;
    if (typeof saved.baseUrl === 'string' && saved.baseUrl.trim()) {
      try {
        baseUrl = normalizeAgentModelBaseUrl(saved.baseUrl);
      } catch {
        baseUrl = AGENT_MODEL_BASE_URL;
      }
    }
    return {
      baseUrl,
      model: typeof saved.model === 'string' && saved.model.trim()
        ? saved.model.trim()
        : AGENT_MODEL_NAME,
      apiKey: saved.apiKey.trim(),
      enabled: saved.enabled !== false,
    };
  } catch {
    return null;
  }
}

export async function saveAgentModelApiKey(
  apiKey: string,
  model = AGENT_MODEL_NAME,
  baseUrl = AGENT_MODEL_BASE_URL,
): Promise<AgentModelConfig> {
  const normalizedKey = apiKey.trim();
  if (!normalizedKey) throw new Error('请输入 API Key');
  const normalizedModel = model.trim();
  if (!normalizedModel) throw new Error('请选择模型');

  const config: AgentModelConfig = {
    baseUrl: normalizeAgentModelBaseUrl(baseUrl),
    model: normalizedModel,
    apiKey: normalizedKey,
    enabled: true,
  };
  await storage.setItem(STORAGE_KEY, JSON.stringify(config));
  return config;
}

export async function clearAgentModelConfig(): Promise<void> {
  await storage.removeItem(STORAGE_KEY);
}

export function hasUsableAgentModelConfig(
  config: AgentModelConfig | null,
): config is AgentModelConfig {
  return Boolean(config?.enabled && config.apiKey.trim());
}
