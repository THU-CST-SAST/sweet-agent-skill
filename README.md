# Sweetonline Agent Skill

可离开 App 独立安装运行的血糖管理 Agent skill：知识检索、对话/周报、状态分析、LoopInsightT1 仿真和中转站工具调用。

## 内容

- `skills/blood-glucose-management/SKILL.md`：整体入口与工作流程。
- `skills/blood-glucose-management/references/`：主题知识、题库、来源与页码索引、术语、安全边界、AAPS 工具契约。
- `skills/blood-glucose-management/agents/openai.yaml`：Agent 展示配置。
- `skills/blood-glucose-management/runtime/`：Node 工作流、NS 读取、中转站操作、完整仿真内核和测试。
- `skills/blood-glucose-management/scripts/agent.mjs`：统一 JSON CLI 入口。

将完整的 `blood-glucose-management` 目录安装到宿主支持的 skill 目录，从 `SKILL.md` 开始读取。不要只复制入口文件而遗漏 references。

## 工具运行边界

本仓库不需要 React Native App，也不是直接蓝牙设备驱动。宿主可以直接调用内置 CLI，不再需要从 App 绑定工具；NS 用于读取，HTTPS 中转站用于经确认的动作与审计回执。

Node.js >=22.13。仓库根目录运行 `npm run setup`、`npm run build`、`npm test`；`npm run demo` 使用合成患者验证完整本地流程。
安装时只需完整 skill 目录，其内部安装步骤、模型/NS/设备配置见 [独立运行说明](skills/blood-glucose-management/references/standalone-runtime.md)。

设备 ID、NS 地址和 API Key 由使用者在运行时配置，不存放在此仓库。没有绑定的工具不得声称已调用；请求受理不等于设备执行成功。

## 来源

原知识 skill 来自 App 的 `2966549`。可执行 runtime 从 `feature/integrated-agent-simulation` 当前工作树抽取，包含尚未提交的工作流修改；逐文件来源见 runtime/source-manifest.json。仿真、统计、候选数值算法未改写，平台边界适配详见 [验证记录](docs/standalone-runtime-verification.md)。
测试固定数据均为合成数据；真实测试日志、患者数据、配置密钥和数据库不进入版本库。保留 vendored 内核许可证。

本资料用于知识解释和决策支持，不代表经临床验证的处方。引用材料保留原来源归属；此私有归档不授予第三方材料的再分发权利。
