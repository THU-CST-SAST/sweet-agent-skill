# Sweetonline Agent Skill

独立保存血糖管理 Agent 的知识检索、分析与工具使用契约。

## 内容

- `skills/blood-glucose-management/SKILL.md`：整体入口与工作流程。
- `skills/blood-glucose-management/references/`：主题知识、题库、来源与页码索引、术语、安全边界、AAPS 工具契约。
- `skills/blood-glucose-management/agents/openai.yaml`：Agent 展示配置。

将完整的 `blood-glucose-management` 目录安装到宿主支持的 skill 目录，从 `SKILL.md` 开始读取。不要只复制入口文件而遗漏 references。

## 工具运行边界

本仓库独立于 React Native App，但不是独立设备驱动或网络服务。宿主须绑定 `references/15-aaps-agent-tools.md` 中的结构化工具：读取 Nightscout，按用户逐次确认发送治疗动作，并通过中转站审计查询真实执行回执。

设备 ID、NS 地址和 API Key 由使用者在运行时配置，不存放在此仓库。没有绑定的工具不得声称已调用；请求受理不等于设备执行成功。

## 来源

从 `sweetonline-drgluapp` 的 `skills/blood-glucose-management` 原样抽取；该目录最近一次修改提交为 `2966549`（`feat(agent): fold AAPS tools into glucose skill`）。本次不改变 skill 的知识内容与安全规则，不携带 App 历史、患者数据、账号密码或密钥。

本资料用于知识解释和决策支持，不代表经临床验证的处方。引用材料保留原来源归属；此私有归档不授予第三方材料的再分发权利。
