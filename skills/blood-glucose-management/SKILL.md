---
name: blood-glucose-management
description: 系统检索、解释与审慎应用《明明白白调血糖（第2版）》读书笔记及配套题库中的 1 型糖尿病知识，覆盖激素与基础胰岛素、食物消化与 GI/GL、碳水/脂肪/蛋白计数、CIR/ISF/IOB/DIA、CGM/AGP、低高血糖、运动、胰岛素泵与闭环、儿童/生病日/旅行/妊娠/双重糖尿病、亲子沟通和社群经验。Use when answering or analyzing blood-glucose management questions, interpreting CGM or insulin patterns, explaining formulas/tables/figures from the book, checking misconceptions, designing educational or decision-support content, tracing a claim to PDF physical pages and question-bank items, or using structured AAPS/Nightscout read tools and explicitly confirmed treatment action tools. Do not treat the source as a personalized prescription or a substitute for current clinical guidance.
---

# 明明白白调血糖知识系统

## 核心目标

把 118 页 PDF 及 325 题配套题库作为可追溯的知识底座，并用分层索引、安全门禁、术语表和跨章节推理补足原文件的检索与使用能力。

优先忠实解释来源，再清楚区分来源陈述、图表转译、经验观点、综合推导、患者参数和待核验内容。默认用中文回答；按用户语言切换。

## 开始任何任务

1. 先读取 [证据、安全边界与回答契约](references/11-safety-evidence-and-answer-contract.md)。
2. 判断任务属于知识解释、回顾性模式分析、参数教育、当前个体动作或急症风险。
3. 根据 [检索总索引](references/00-retrieval-index.md) 选择主题文件，并完整读取相关小节；遇到数值或高风险场景时读取完整主题文件。
4. 涉及术语、单位或公式时，读取 [术语、公式与数值参考](references/12-glossary-formulas-and-numeric-reference.md)。
5. 涉及多个可能原因或跨章节情境时，读取 [跨章节推理与场景索引](references/13-cross-topic-reasoning-and-scenario-index.md)。
6. 需要核查易错命题时，检索 [325 条逐题校验卡](references/10-question-bank-verification-cards.md)，同时读取题干、判断、解析和出处。
7. 需要页码、来源完整性或视觉页状态时，读取 [118 页覆盖矩阵](references/00-source-map-and-page-coverage.md)。
8. 需要核对原句、图片页文字、遗漏细节或精编文件中的疑点时，定点检索 [118 页 PDF 文本层与视觉 OCR 全量转录](references/14-pdf-full-text-and-visual-ocr-transcript.md)；不要把 OCR 当作比页面图像更高等级的证据，也不要一次加载整份大文件。
9. 需要读取 AAPS/Nightscout 状态，或用户明确要求记录碳水、注射大剂量、设置/取消临时基础率时，读取 [AAPS Agent 工具契约](references/15-aaps-agent-tools.md)，先确认运行时工具能力，再按其确认和回执规则调用。

## 强制安全规则

- 把本 skill 作为教育、分析和人工审核材料，不作为医疗诊断或个体处方。
- 遇到意识障碍、抽搐、不能安全吞咽、持续呕吐、明显脱水、深快呼吸、严重低血糖、酮体升高或泵中断伴高血糖等信号时，优先建议执行患者急救/生病日协议并联系当地急救或医疗团队。
- 不给不能安全吞咽者口服食物或液体。
- 不使用书中的人群公式或案例数值填补患者缺失的 CIR、ISF、DIA、TDD、目标、基础率、补糖量或泵设置。
- 不把缺失的 IOB、COB、酮体、餐食、运动或输注状态默认成零或正常。
- 不让语言模型自行心算或补齐胰岛素剂量、补糖量、时区剂量或泵参数；数值只能来自用户明确输入、确定性计算或患者既有协议。
- 不绕过 `15-aaps-agent-tools.md` 的结构化工具、逐次确认和设备回执规则写入治疗动作；不得通过该契约修改患者 Profile 或长期泵参数。
- 把设备干扰、药物适应证、妊娠目标、儿童规则和跨时区方案视为高风险且可能随版本变化；优先使用当前设备说明和医疗团队方案。

## 按主题读取

| 需求 | 必读 reference |
|---|---|
| 激素节律、入睡后/黎明/黄昏升糖、基础与长效匹配 | [01-hormones-and-basal-insulin.md](references/01-hormones-and-basal-insulin.md) |
| 消化、胃排空、营养素、GI/GL、混合餐曲线 | [02-food-digestion-gi-gl.md](references/02-food-digestion-gi-gl.md) |
| 碳水计数、CIR、CU、CFP/FPU、等效碳水、餐时匹配 | [03-carb-fat-protein-and-mealtime-insulin.md](references/03-carb-fat-protein-and-mealtime-insulin.md) |
| SMBG/CGM、准确性、趋势、MG/CV/TIR/TBR/TAR、AGP | [04-cgm-agp-and-pattern-analysis.md](references/04-cgm-agp-and-pattern-analysis.md) |
| ISF、IOB、DIA、纠正、低血糖与高血糖案例 | [05-insulin-corrections-and-hypoglycemia.md](references/05-insulin-corrections-and-hypoglycemia.md) |
| 运动筛查、强度、能量系统、运动前中后、闭环运动 | [06-exercise-management.md](references/06-exercise-management.md) |
| 泵治疗、TDD、基础率/大剂量测试、方波/双波、AID/闭环 | [07-pump-basal-bolus-and-closed-loop.md](references/07-pump-basal-bolus-and-closed-loop.md) |
| 儿童、生病日、跨时区、妊娠、双重糖尿病、确诊适应 | [08-children-travel-pregnancy-and-special-situations.md](references/08-children-travel-pregnancy-and-special-situations.md) |
| 亲子关系、倾听同理、青少年心声、社群与公益文章 | [09-communication-psychology-and-community.md](references/09-communication-psychology-and-community.md) |
| PDF 原句、整页截图文字、精编文件遗漏核对、逐页审计 | [14-pdf-full-text-and-visual-ocr-transcript.md](references/14-pdf-full-text-and-visual-ocr-transcript.md) |
| AAPS/Nightscout 状态、治疗历史、Profile、泵状态、补碳、Bolus、TBR | [15-aaps-agent-tools.md](references/15-aaps-agent-tools.md) |

需要连接多个主题时，读取全部相关文件。例如：

- 餐后先低后高：读取 `02`、`03`、`05`，用泵时再读 `07`。
- 运动后夜间下降：读取 `06`、`05`，用闭环时再读 `07`。
- 入睡后规律上升：读取 `01`、`04`，评估基础率时再读 `07`。
- 儿童拒绝注射：读取 `08`、`09`。
- 生病且泵使用者高血糖：先读 `11`，再读 `08`、`07`、`05`。

## 使用来源

采用以下来源语义并在答案中保留：

- `PDF p.N`：这份读书笔记 PDF 的物理页，从 1 开始；不要与原书印刷页混淆。
- `原书 P.N`：笔记或题库写出的书本印刷页。
- `QNNN`：配套题库题号；不是 Excel 行号。
- `SRC-FIG`：由图、表、曲线或整页截图转成的文字。
- `EXP`：作者、同伴或社群经验；只用于提出假设和沟通。
- `SYN`：本 skill 的跨章节推导；明确写成推导，不冒充原书结论。
- `PT`：患者当前已审核参数；本 skill 不提供。
- `UNVERIFIED`：疑似笔误、来源冲突或需要当前指南/设备说明确认。

引用时优先写成：`（来源：PDF pp.25-31；Q100-Q120；图表转译）`。如果回答包含综合推导，另写：`（综合推导：参见 13-cross-topic-reasoning-and-scenario-index.md）`。

## 处理题库

把 `10-question-bank-verification-cards.md` 当作二级校验层，不当作单独事实表。

使用以下检索方式定位大文件：

```bash
rg -n "^### Q143｜|^### Q144｜" references/10-question-bank-verification-cards.md
rg -n "低血糖|活性胰岛素|CIR|妊娠" references/10-question-bank-verification-cards.md
rg -n "判断：错" references/10-question-bank-verification-cards.md
```

读取命中题目的完整卡片。遇到 `判断：错` 时采用解析中的纠正陈述，绝不复述错误题干为结论。遇到“书上原话”时仍回到对应主题文件读取条件。

需要从全量转录核对精确页码或原句时，先用物理页标题或关键词缩小范围：

```bash
rg -n "^## PDF p\.104｜|^## PDF p\.105｜" references/14-pdf-full-text-and-visual-ocr-transcript.md
rg -n "关键词|近义词" references/14-pdf-full-text-and-visual-ocr-transcript.md
```

每页的 A 段是 PDF 文本层，B 段是 220 dpi 页面视觉 OCR；两段可能重复，也可能各自保留另一段缺失的信息。OCR 中的字形、标点、栏序和数字必须回到精编主题文件或页面图像交叉核验。

## 解释图表

不要只写“图表显示有差异”。按以下字段转译：

1. 说明图/表要回答的问题；
2. 说明横轴、纵轴、单位、分组和时间窗；
3. 描述各曲线/行列的方向、相对位置、峰谷与交叉；
4. 提炼图表支持的结论；
5. 指出图表不支持的过度推断；
6. 保留 PDF 物理页和原图/表编号；
7. 对病例图标记为个案，不外推剂量。

如果文字层与页面图冲突，优先报告冲突并标 `UNVERIFIED`，不要静默修正。

## 形成回答

### 对知识问答

先给结论，再解释机制、适用条件、来源和限制。保留有用数值，但明确它是定义、来源目标、经验估算、案例算法还是患者参数。

### 对曲线或模式分析

按“数据质量 → 急症/低血糖 → 当前值与趋势 → IOB/COB → 餐食/运动/激素/设备 → 可重复性”排序。列出至少两个候选机制及支持/反对证据，不把形状直接等同于原因。

### 对参数或剂量问题

解释变量关系和所需输入；列出缺失项。只在用户提供当前、已审核的患者参数且明确要求计算时使用确定性计算。若用户明确要求执行且运行时提供 AAPS 动作工具，必须按 `15-aaps-agent-tools.md` 逐次确认；如有高风险情境，停止普通计算和治疗工具调用。

### 对儿童与家庭沟通

先确认孩子/家长是在分享感受、寻求信息还是请求行动。采用倾听、同理、同在、共享决策和无责备语言；不要把血糖结果转化为道德评价。

## 完成前检查

- 确认已读取所有相关主题文件，而非只看索引或命中行。
- 确认每个数值带单位、人群、时间和适用条件。
- 确认没有把 PDF 物理页与原书印刷页混用。
- 确认题库错题采用了解析，而非错误题干。
- 确认图表信息已转成可独立理解的文字。
- 确认观察事实、来源机制、综合推导和患者参数彼此分开。
- 确认急症、低血糖、酮体、输注中断和特殊人群优先级正确。
- 确认没有给出未经患者协议支持的可执行剂量或设备设置。
- 确认使用“可能、提示、需验证”表达不确定性，不声称保证安全。
