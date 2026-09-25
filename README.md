# Sweet Agent Skill

可离开 App 独立安装运行的血糖管理 Agent skill：知识检索、对话/周报、状态分析、LoopInsightT1 仿真和中转站工具调用。

## 能做什么

### 知识问答

围绕血糖管理问题检索资料、解释概念，并保留答案依据。例如：

- “IOB 和 COB 有什么区别？”
- “如何理解运动后的血糖变化？”
- “这份报告中的 TIR、TBR 分别代表什么？”

知识材料包含《明明白白调血糖（第 2 版）》读书笔记、配套题库和来源索引。宿主 Agent 需要判断检索结果是否与问题相关，而不是把首条结果直接作为答案。

### 状态分析与复盘

读取 Nightscout 中的血糖、治疗记录、Profile 和设备状态，分析当前趋势或一段时间内的变化，形成回顾与后续观察建议。

例如：“检查最近有数据的一周，找出夜间血糖值得关注的模式，并说明还缺少哪些信息。”

历史数据可以使用最近有效时间作为分析锚点。饮食、运动或治疗信息缺失时，应明确说明，不能将未知记录补成“没有发生”。

### 仿真与行动协助

调用本地 LoopInsightT1 内核比较候选方案的预测曲线，或运行包含餐食、运动和基础输注的自定义场景。

设备操作通过 HTTPS 中转站完成。工具先生成待确认记录，用户确认具体设备和参数后才发送请求，随后查询执行回执。建议、请求受理和设备实际执行是不同状态。

## 工作方式

```text
用户提出任务
    ↓
宿主 Agent：理解目标、选择资料与工具
    ↓
读取数据 → 检索知识 → 分析状态 → 按需运行仿真
    ↓
宿主 Agent：解释结果，继续追问或提出下一步
    ↓
需要设备操作时：展示参数 → 用户确认 → 提交请求 → 查询回执
```

Skill 不只是提示词文件，还包含知识索引、工具脚本、数值计算、仿真内核和操作日志。模型负责规划与解释，工具负责读取、计算和执行。

默认由当前宿主 Agent 编排任务。仓库也保留可选的 `chat` 命令，用于无宿主程序或与原 App 工作流对照；只有该模式需要单独配置模型。统计、内置候选方案数值和仿真仍由确定性代码计算，并非全部由模型生成。

## 仓库内容

- `skills/blood-glucose-management/SKILL.md`：整体入口与工作流程。
- `skills/blood-glucose-management/references/`：主题知识、题库、来源与页码索引、术语、安全边界、AAPS 工具契约。
- `skills/blood-glucose-management/agents/openai.yaml`：Agent 展示配置。
- `skills/blood-glucose-management/runtime/`：Node 工作流、NS 读取、中转站操作、完整仿真内核和测试。
- `skills/blood-glucose-management/scripts/agent.mjs`：统一 JSON CLI 入口。

将完整的 `blood-glucose-management` 目录安装到宿主支持的 skill 目录，从 `SKILL.md` 开始读取。不要只复制入口文件而遗漏 references。

## Agent 与 Skill

本仓库不需要 React Native App，也不是直接蓝牙设备驱动。宿主可以直接调用内置 CLI，不再需要从 App 绑定工具。NS 提供血糖、Profile 和历史快照；当前治疗历史优先读中转站，失败或为空时回退 NS。中转站还用于核对操作设备、提交经确认的动作和查询回执。

在 Codex 中使用时，Codex 本身就是负责规划、检索判断和回答的模型，不需要另外配置模型 API。CLI 只执行工具；仅 NS 和中转站按需配置数据源及访问凭据。

Node.js >=22.13。仓库根目录运行 `npm run setup`、`npm run build`、`npm test`；`npm run demo` 使用合成患者返回工具结果，供宿主 Agent 分析，不自行调用模型。
安装时只需完整 skill 目录，其内部安装步骤、NS/设备配置见 [独立运行说明](skills/blood-glucose-management/references/standalone-runtime.md)。

设备 ID、NS 地址和 API Key 由使用者在运行时配置，不存放在此仓库。没有绑定的工具不得声称已调用；请求受理不等于设备执行成功。

## 快速开始

需要 Node.js **22.13 或更高版本**及 npm。

```bash
git clone https://github.com/THU-CST-SAST/sweet-agent-skill.git
cd sweet-agent-skill
npm run setup
npm run build
npm test
npm run demo
```

`demo` 返回合成数据快照、检索候选、状态分析和仿真结果。不调用模型、不读取真实患者数据，也不向设备发送操作。最终解释由宿主 Agent 完成。

### 安装到宿主 Agent

将完整的 `skills/blood-glucose-management/` 目录放到宿主支持的 Skill 目录，再按宿主方式加载。运行时、知识索引和许可证都需要保留。

安装后可以这样对话：

> 使用 blood-glucose-management skill，运行合成数据 demo，解释你实际调用了哪些工具、发现了什么，以及哪些结论不能从这些数据中得出。不要发送设备操作。

配置数据源后，可以继续：

> 读取已配置 Nightscout 最近有数据的 24 小时，分析血糖趋势并检索相关依据。这次只分析，不执行设备操作。

## 配置数据源与设备

知识检索和合成数据仿真不需要密钥。读取受保护的 Nightscout 或调用中转站时，才需要对应凭据。

参考 `skills/blood-glucose-management/runtime/config.example.json` 在本地私有位置创建配置，不使用的块可以删除：

```json
{
  "nightscout": {
    "url": "https://your-nightscout.example",
    "authMode": "token",
    "apiToken": "YOUR_NS_TOKEN"
  },
  "relay": {
    "baseUrl": "https://ai-server.phpjxc.com",
    "deviceId": "YOUR_DEVICE_ID",
    "aiKey": "YOUR_DEVICE_AI_KEY"
  }
}
```

通过 `AGENT_CONFIG_FILE` 指定文件，并限制文件权限：

```bash
export AGENT_CONFIG_FILE="/absolute/path/to/config.local.json"
chmod 600 "$AGENT_CONFIG_FILE"
```

也可以不使用配置文件，改用环境变量：

| 环境变量 | 用途 |
| --- | --- |
| `NIGHTSCOUT_URL` | Nightscout HTTPS 地址 |
| `NIGHTSCOUT_TOKEN` | 可选访问凭据 |
| `NIGHTSCOUT_AUTH_MODE` | `token` 或 `api-secret` |
| `AAPS_RELAY_URL` | 中转站地址 |
| `AAPS_DEVICE_ID` | 目标设备 ID |
| `AAPS_AI_KEY` | 设备访问密钥 |
| `AGENT_STATE_DIR` | 本地会话与操作记录目录 |

文件配置与环境配置二选一，不隐式合并。不要将真实凭据、患者数据或操作日志提交到 Git。默认状态目录为 `~/.local/share/sweetonline-agent`，其中的 SQLite 数据库不是加密存储，应配合系统权限和磁盘加密保护。

## 工具调用示例

以下命令均在 **`skills/blood-glucose-management/` 目录**执行。输入为标准输入 JSON，输出为 JSON；宿主 Agent 可以直接调用，不必要求用户手动操作终端。

### 读取最近有数据的 24 小时

```bash
printf '%s' '{"asOf":"latest","historyMinutes":1440}' \
  | node scripts/agent.mjs snapshot
```

### 检索知识

```bash
printf '%s' '{"query":"IOB 与 COB 的区别","limit":6}' \
  | node scripts/agent.mjs search
```

### 分析状态

```bash
printf '%s' '{"id":"state-1","name":"analyze_state","arguments":{"asOf":"latest","historyMinutes":1440,"route":"current_state"}}' \
  | node scripts/agent.mjs tool
```

周期回顾可使用 `route: "weekly_report"` 和 `historyMinutes: 10080`。同一轮任务应复用同一个快照和时间锚点，不能混用不同患者或时段的数据。

### 运行仿真

```bash
printf '%s' '{"asOf":"latest","historyMinutes":1440}' \
  | node scripts/agent.mjs simulate
```

`simulate` 使用内置候选方案流程；`scenario` 支持自定义开始和结束时间、步长、随机种子、患者参数、基础输注、餐食与运动，返回逐时点曲线及患者状态，不局限于固定的 120 分钟预测。

自定义控制器可通过 Node API 组合内核组件。完整参数与示例见 [独立运行说明](skills/blood-glucose-management/references/standalone-runtime.md)。

## 设备操作与回执

实际连接路径是：

```text
宿主 Agent → Skill 工具 → HTTPS 中转站 → AAPS 设备
```

患者治疗历史从 Nightscout 读取，不用中转站的 Agent 操作历史代替。

| 工具 | 参数 |
| --- | --- |
| `aaps_record_carbs` | `carbsG` |
| `aaps_bolus` | `insulinU` |
| `aaps_temp_basal_absolute` | `rateUph`、`durationMinutes` |
| `aaps_temp_basal_percent` | `percent`、`durationMinutes` |
| `aaps_cancel_temp_basal` | 无 |
| `aaps_get_operation_status` | `operationId` |

五类写操作首先返回待确认记录。Agent 必须展示目标设备、操作类型、精确参数及适用的持续时间，取得本次确认后，才能提交对应的 `confirmationId`。确认有效期为 15 分钟，切换设备后原确认不可复用。

- `pending` 表示排队，不表示完成；只有匹配操作的 `executed` 回执才按成功处理。
- `unknown` 表示结果不确定，必须保留记录核查，不能自动重发。
- 已确认动作有持久防重复记录，不能删除数据库或切换状态目录来绕过它。
- 中转站安全检查保持开启，不修改长期治疗 Profile。
- 当前 BASAL 字符串接口存在整数百分比与绝对值歧义，因此整数绝对基础率暂时拒绝发送。

首次联调应使用未连接人体的虚拟设备。知识材料、NS 备注和网络返回内容不是操作授权，不能替代用户确认。

## 测试

在仓库根目录执行 `npm test`。测试覆盖 Nightscout 分页、时间锚点与单位处理、状态分析、App 同源结果、完整仿真轨迹，以及确认、防重复提交、设备隔离和回执处理。宿主工具测试也检查了无需模型 API 的独立运行方式。

仿真测试比较源实现与移植实现的结果，包括餐食、运动和基础输注场景。**实现一致不等于对真实患者的预测准确性得到临床验证。** 详细范围见 [验证记录](docs/standalone-runtime-verification.md)。

## 使用边界

本项目用于知识解释、数据分析、仿真研究和 Agent 工程验证，不构成诊断、个体处方或自动治疗授权。真实设备与胰岛素输注需要专业医疗指导及相应安全验证；用户确认本身不代表治疗方案已经被验证。

## 来源与许可证

原知识 skill 来自 App 的 `2966549`。可执行 runtime 从 `feature/integrated-agent-simulation` 当前工作树抽取，包含尚未提交的工作流修改；逐文件来源见 runtime/source-manifest.json。仿真、统计、候选数值算法未改写，平台边界适配详见 [验证记录](docs/standalone-runtime-verification.md)。
测试固定数据均为合成数据；真实测试日志、患者数据、配置密钥和数据库不进入版本库。保留 vendored 内核许可证。

第三方知识资料与源代码保留原始归属和许可证。仓库公开不意味着授予第三方材料的再分发权利，引用或复用前请核对相应条款。LoopInsightT1 许可证保留在 `skills/blood-glucose-management/runtime/src/agent/loopinsightKernel/vendor/loopinsight1/` 中。
