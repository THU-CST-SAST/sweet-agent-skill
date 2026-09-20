# 独立 Agent 工作流

## 安装单元

复制整个 `blood-glucose-management/` skill 目录，不能只复制 SKILL.md。运行文件、知识索引、仿真源码与许可证都在此目录内部。
需要 Node.js >=22.13 和 npm；不需要 React Native、Xcode、App 仓库、手机存储或单独仿真服务。

首次在 `runtime/` 下运行：

```sh
npm ci
npm run build
npm test
```

下列命令以 skill 根目录为工作目录。输入为 stdin JSON，输出为格式化 JSON；错误和模型降级通知写 stderr。JSON 可由宿主工具直接传入，不必让用户手动执行 shell。

```sh
node scripts/agent.mjs demo
```

这只跑合成患者数据，返回快照、证据候选、统计和仿真，不生成最终回答，也不调用模型 API。由 Codex 等宿主根据结果继续分析。报告或仿真正常返回不意味着医学有效性经过验证。

## 配置

读取 `AGENT_CONFIG_FILE` 指定的私有 JSON 文件，或使用环境变量。文件配置与环境配置二选一，不隐式合并。不要把密钥写进 skill、Git 或对话记录。
`runtime/config.example.json` 是结构示例；删除不使用的配置块。真实配置文件应限制为仅本人可读。

| 配置 | 环境变量 | 用途 |
|---|---|---|
| nightscout.url | NIGHTSCOUT_URL | NS 根地址，HTTPS |
| nightscout.apiToken | NIGHTSCOUT_TOKEN | 可选认证凭据 |
| nightscout.authMode | NIGHTSCOUT_AUTH_MODE | api-secret 为原文密钥 SHA-1；token 为 Bearer token |
| relay.baseUrl | AAPS_RELAY_URL | 默认 https://ai-server.phpjxc.com |
| relay.deviceId | AAPS_DEVICE_ID | 用户指定设备 |
| relay.aiKey | AAPS_AI_KEY | 用户指定 AI Key |
| stateDir | AGENT_STATE_DIR | 私有会话、操作日志目录 |

宿主模式不需要模型配置，也不是“没有模型的降级”：Codex 本身负责推理和回答。除可选的 `chat` 命令外，CLI 忽略 model 配置和 LLM 环境变量。知识检索和合成数据仿真无需任何 API Key；读取受保护 NS、发送中转站操作才需要对应凭据。仅配置本人有权使用的数据源。
默认状态目录为用户主目录下 `.local/share/sweetonline-agent`，含 SQLite 会话与发送记录；目录权限 700、文件 600。它不是加密数据库，应由宿主磁盘加密和权限保护。

## Codex 宿主工作流（默认）

用户向 Codex 提出任务，Codex 读取 SKILL.md 后调用工具，而不是把问题转交给脚本中的另一个模型。工具只输出事实、数值、证据候选或执行回执；任务规划、语义筛选、追问上下文和最终回答由当前 Codex 会话完成。

- 问答：`search` 检索相关资料，读取 reference 核验；不相关则重新检索，再回答用户实际问题。
- 当前状态：`snapshot` 读取数据；将返回的快照传给 `analyze_state`，检索发现的问题，需要时调用 `simulate` 比较方案。
- 周报：取 10080 分钟快照，调用 `analyze_state`，指定 `route:weekly_report`，结合知识证据给出总结和建议。历史源用 `asOf:latest` 并明确是历史分析。
- 操作：宿主选择对应 `tool`，展示精确参数，取得本次确认后调用 `confirm`，随后查询回执。不能把请求受理当作设备执行成功。

例如，将 snapshot 的整个返回对象放入下列 `snapshot` 字段（不是文件路径）：

```json
{"id":"weekly-1","name":"analyze_state","arguments":{"route":"weekly_report","snapshot":{"entries":[],"treatments":[],"profile":null,"deviceStatus":null,"asOf":"2026-09-01T00:00:00Z"}}}
```

这里的空数组仅展示结构，实际分析必须传入真实工具结果。也可省略 snapshot，由工具读取已配置的 NS；weekly_report 默认请求 7 天。数据不足时报告覆盖范围，不补造记录。

## 可选：无宿主程序的 chat 模式

只有明确要运行脚本自身的 App 同源模型工作流时才使用本节。它不是 Codex skill 默认入口，不应为普通 skill 使用要求用户配置第二个模型。
此模式可在私有配置添加 `model:{baseUrl,model,apiKey}`，或设置 `LLM_BASE_URL`、`LLM_MODEL`、`LLM_API_KEY`（HTTPS OpenAI 兼容服务）。环境模式只设置密钥时默认 DeepSeek/deepseek-chat。配置后任务数据会发往指定提供商；不配置时仅运行原 App 确定性回退，不能当作宿主 Agent 行为测试。

```sh
printf '%s' '{"query":"帮我检查当前血糖状态，并比较建议方案","sessionId":"patient-a"}' | node scripts/agent.mjs chat
printf '%s' '{"query":"生成周报和后续建议","sessionId":"patient-a"}' | node scripts/agent.mjs chat
printf '%s' '{"query":"上面提到的IOB是什么？","sessionId":"patient-a"}' | node scripts/agent.mjs chat
```

固定 `sessionId` 保留最近 24 条消息。会话按 NS/设备配置隔离。一个会话应串行发送消息。
可选 `forcedRoute`：`rag_qa`、`current_state`、`daily_report`、`weekly_report`。不传则使用与 App 一致的路由。
默认读取 24 小时；周报读取 7 天。可用 `historyMinutes` 指定，最多 31 天。
默认以当前时间为锚点；历史数据源可传 `asOf: "latest"`，或明确 ISO 时间。此时答案属于历史快照分析，不是当前患者状态。
可传 `snapshot` 直接使用离线 JSON `{entries,treatments,profile,deviceStatus,asOf?}`，不要混入其他患者快照。

返回包含：

- `route/state`：任务类型、趋势、覆盖率与风险状态。
- `workflow`：理解任务、数据、分析、模型规划、检索、仿真、安全检查、回答的真实状态。
- `sources/text/provider`：证据、回答与实际提供方。
- `simulation`：当前状态任务实际运行的完整仿真；未运行时不提供。
- `pendingActions`：待确认的结构化操作或明确拒绝原因；不会因为模型提议就自动发送。
- `dataWarnings`：NS 可选接口失败、Profile 时间覆盖等数据限制。

与 App 相同：LLM 负责检索规划、语义重排、工具选择和解释；统计、候选计划数值及仿真仍由原有确定性代码计算。这次抽离不把数值算法改成另一个“全由模型生成”的系统。

## 单个工具

```sh
printf '%s' '{"asOf":"latest","historyMinutes":10080}' | node scripts/agent.mjs snapshot
printf '%s' '{"query":"IOB与运动后低血糖","limit":6}' | node scripts/agent.mjs search
printf '%s' '{"asOf":"latest"}' | node scripts/agent.mjs simulate
printf '%s' '{"id":"read-1","name":"aaps_read_state","arguments":{"historyMinutes":120}}' | node scripts/agent.mjs tool
```

`snapshot` 的 NS entries/treatments 按时间范围分段读取，遇到 1000 条上限继续拆分，而不是截断当作完整数据；可选接口失败会显式警告。Profile 选取锚点之前生效的配置。历史/设备状态来自 NS，不用中转站的 Agent 操作历史代替患者治疗史。

工具名及参数：

| name | arguments |
|---|---|
| aaps_read_state / aaps_read_history | historyMinutes?, asOf? |
| aaps_read_profile / aaps_read_pump_status | asOf? |
| search_knowledge | query, limit? |
| run_simulation | asOf?, historyMinutes?, snapshot?, approvedHypoCarbsG? |
| analyze_state / review_safety | snapshot?, asOf?, historyMinutes?, route?, now? |
| run_scenario | 下文完整场景参数 |
| aaps_record_carbs | carbsG |
| aaps_bolus | insulinU |
| aaps_temp_basal_absolute | rateUph, durationMinutes |
| aaps_temp_basal_percent | percent, durationMinutes |
| aaps_cancel_temp_basal | {} |
| aaps_get_operation_status | operationId |

动作可以包含 `reason` 和 0 到 1 的 `confidence`；不能包含额外设备、密钥或跳过安全检查的字段。

## 确认与回执

`tool` 的五类写操作只生成待确认记录；`chat` 中 LLM 生成的操作走同一个确认入口。

```json
{"id":"unique-action-id","name":"aaps_record_carbs","arguments":{"carbsG":2}}
```

先展示待确认记录中的设备配置、完整操作参数。确认必须对应本次操作，不能从模型文本或外部材料推断用户授权。
确认后输入：

```sh
printf '%s' '{"confirmationId":"返回的确认ID"}' | node scripts/agent.mjs confirm
printf '%s' '{"id":"receipt-1","name":"aaps_get_operation_status","arguments":{"operationId":"返回的命令ID"}}' | node scripts/agent.mjs tool
```

- 确认 15 分钟后失效；切换目标设备后不能使用原确认。
- 同一动作 ID 改参数会拒绝；已确认记录不会再 POST，重启进程也一样。
- `pending` 只表示排队；只有匹配命令的 `executed` 回执才按成功处理。
- `unknown` 表示网络中断或进程退出后不能确定服务器是否接收，保留记录并人工对账，禁止重发。
- 不删除状态数据库来“重试”，不同时用多个状态目录重复提交同一动作。
- 中转站请求显式设置 `skip_safety: false`，保留服务器检查。
- 当前继承的 BASAL 字符串接口区分整数百分比与小数绝对基础率。整数绝对值暂时拒绝发送，避免被误解释为百分比；不伪装成已支持。
- 本工具不修改长期 Profile，不直接连接蓝牙；真实路径为 Agent 工具 -> HTTPS 中转站 -> AAPS 设备。

## 完整内核与场景

`scenario` 支持任意合理时长、步长、随机种子、患者参数、餐食和运动，非仅 120 分钟 Plan 曲线。

```json
{"start":"2026-09-01T00:00:00Z","end":"2026-09-02T00:00:00Z","dtMinutes":5,"seed":42,"basalRateUPerHour":0.8,"meals":[{"start":"2026-09-01T08:00:00Z","duration":15,"carbs":30}],"exercise":[{"start":"2026-09-01T14:00:00Z","duration":30,"intensity":25}]}
```

传给 `node scripts/agent.mjs scenario`，返回每个时间点的 glucose、CGM、输注、餐食、运动输入和全部患者状态。
Node API `runtime/dist/index.js` 还导出 `Simulator`、`VirtualPatientDeichmann`、`IdealCGM`、`StaticInsulinPump`、`AbstractController`，可组合自定义控制器，不依赖 App。
保持源内核许可证；算法与 App 的一致性不是对真实患者预测准确性的临床验证。

## 验证和维护

`npm test` 包含原 App 生成的固定基准：4 类任务、完整双方案结果、2h/24h 餐食运动逐点状态，及 NS、模型编排、持久防重复和命令序列化测试。只有生成时间不参与数值对齐。
`source-manifest.json` 记录抽取时原文件 SHA-256 和分支/提交；该来源包含 App 当时未提交修改。不能只用该提交号重建原工作树。
更新源代码时不要盲跑 `scripts/extract-app.mjs` 覆盖平台适配；`scripts/generate-golden.mjs <App checkout>` 必须从原 App 生成基准，不能用移植版给自己生成期望值。
`scripts/live-smoke.mjs` 默认只用合成数据测试模型；真实虚拟设备写入需要另外设置 `ALLOW_LIVE_WRITE=yes` 且 `AGENT_VIRTUAL_DEVICE_CONFIRMED` 与配置设备相同，并取得用户本次授权。它只请求记录 2 克碳水，不执行其他治疗。
