# Graph Token Efficiency Benchmark

## 背景

本 benchmark 用来验证图谱能力是否把 open-code-review 的产品收益落到可重复测量的结果上：更少 token、更少盲搜、review 质量不下降。它不是单次 `usage compare` 的截图，而是一组同条件配对样本的中位数评估。

## 推荐实验设计

- **同 diff**：baseline 与 graph-enabled candidate 必须 review 同一个代码改动，避免变更规模影响 token。
- **同 model**：使用相同 vendor、model、temperature/思考配置，避免模型差异掩盖图谱收益。
- **同 reviewer team**：保持 reviewer persona、并发数、轮次配置一致。
- **3-5 轮配对样本**：每轮生成一组 baseline session 和 candidate session，最终看中位数，不看单次最好结果。
- **同一质量门禁**：每组输出都要做人工抽查，确认 blocker/should-fix finding 没有变少，且证据引用仍然完整。

## 运行步骤

1. 选择一个中型仓库和固定 diff，记录 commit、branch、review 配置、model 和 reviewer team。
2. 运行 baseline review：关闭 graph summary-first 路径，或使用 graph missing/stale 的对照配置。
3. 运行 candidate review：开启 graph minimal-context、nextToolSuggestions 和按需 review-context。
4. 每轮结束后确认 session 已写入 `usage.json`、数据库 usage rows 和 dashboard event JSONL。
5. 对每轮先跑单次对比：

```bash
ocr usage compare --baseline <baseline-session-id> --candidate <graph-session-id>
```

6. 聚合 3-5 轮 benchmark：

```bash
ocr usage benchmark \
  --pair <baseline-1>:<graph-1> \
  --pair <baseline-2>:<graph-2> \
  --pair <baseline-3>:<graph-3> \
  --quality-pass
```

7. 如需机器可读输出：

```bash
ocr usage benchmark \
  --pair <baseline-1>:<graph-1> \
  --pair <baseline-2>:<graph-2> \
  --pair <baseline-3>:<graph-3> \
  --quality-pass \
  --json
```

## 默认验收阈值

- **median total tokens 下降至少 10%**：默认 `--min-total-reduction-pct 10`。
- **median Read/Grep/Bash broad exploration 下降至少 20%**：默认 `--min-broad-reduction-pct 20`。
- **质量门禁必须通过**：必须显式传入 `--quality-pass`，否则 benchmark 只能是 `inconclusive`。
- **证据完整性必须足够**：如果 usage rows 缺失、只有 total-only usage、event journal 缺失，benchmark 不应宣称通过。

这些阈值是首版保守默认值，不是长期 KPI。后续可以按仓库规模、reviewer team 和模型成本重新校准。

## 如何解读 input tokens 上升

图谱能力可能让 candidate 的 input tokens 上升，因为 minimal context、review-context snippets 或 graph suggestions 会主动提供导航信息。input tokens 上升并不自动代表失败，关键看：

- **total tokens 是否下降**：如果 input 上升但 output、重复探索和总轮次下降，total tokens 仍可能下降。
- **盲搜是否下降**：Read/Grep/普通 Bash 调用减少，说明 reviewer 更少靠大范围搜索碰运气。
- **质量是否稳定**：如果 finding 数量、严重程度覆盖或证据引用变弱，那么 token 降低不算产品收益。
- **caveats 是否清空**：total-only usage 或缺失 event telemetry 会让结论不可信，只能作为线索。

## 质量抽查清单

在传入 `--quality-pass` 前，至少完成以下检查：

- blocker/should-fix findings 未少于 baseline 中确认有效的问题。
- 每条 finding 都引用源码、diff、测试、运行日志或复现证据，不能只引用 graph signal。
- candidate 覆盖 changed files、top impacted symbols、test gaps 和高风险调用链。
- 抽查 reviewer 的探索路径，确认没有因为 summary-first 而跳过必要源码阅读。
- 若 candidate 发现了 baseline 没发现的问题，确认不是误报，并记录图谱建议如何帮助定位。
- 若 baseline 发现了 candidate 没发现的问题，默认判定质量门禁失败，除非人工确认该问题无效。

## 示例输出解读

```text
Graph token efficiency benchmark
Runs: 3
Thresholds: total tokens <= -10.0%, Read/Grep/Bash <= -20.0%

Medians
  Total tokens: -15.6%
  Read/Grep/Bash: -44.4%
  ocr graph * calls: 3

Verdict
  Benchmark passed: median total tokens and Read/Grep/Bash calls both improved beyond configured thresholds (-10.0%, -20.0%), with quality gate passed.
```

这表示 graph-enabled candidate 在 3 轮中位数上同时减少了总 token 和 broad exploration，并且人工质量门禁已通过，可以作为“图谱能力带来产品收益”的有效证据。

如果 verdict 是 `inconclusive`，优先查看 caveats。常见原因包括样本少于 3 轮、usage 只有 total、event JSONL 缺失、下降未达阈值、或没有传入 `--quality-pass`。
