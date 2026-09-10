# Trouble Shooting

## PRD 生成在最后一步失败

### 症状

前端显示：

> 模型拒绝请求、响应无效，或多次续写后仍被截断。请检查模型服务与输入材料。

### 判断方法

先查询任务历史：

```bash
curl -sS http://127.0.0.1:8000/v1/prd/documents/<document_id>/jobs?limit=10
```

再查询 trace，并只提取阶段结束信息：

```bash
python3 - <<'PY'
import json
import urllib.request

url = "http://127.0.0.1:8000/v1/prd/documents/<document_id>/trace?limit=200"
data = json.load(urllib.request.urlopen(url))
for event in data.get("items", []):
    payload = event.get("payload", {})
    if event.get("name") in {"model.responded", "stage.failed", "stage.succeeded"}:
        print(
            event.get("name"),
            payload.get("stage_id"),
            payload.get("finish_reason"),
            payload.get("output_tokens"),
            payload.get("error_type"),
        )
PY
```

如果看到 `finish_reason=length`，说明本次模型输出达到了 `max_tokens`，不是保存或前端问题。

DeepSeek 新模型默认可能启用 thinking。thinking token 也会消耗 `max_tokens`，导致很小的正文预算也返回 `finish_reason=length`。Nexus PRD 默认关闭“显示思考过程”，把预算留给正文；需要观察模型推理时可在页面顶部开启。关闭时的最小验证请求也应带上：

```json
{"thinking":{"type":"disabled"}}
```

## 本次失败的具体记录与处理

2026-09-10 查询本机追溯后确认：任务 `5a07217ae1bb4fd3b887aee99a3bc80c` 已完成需求、流程、技术三步分析，在 write 返回 `finish_reason=length`、8,000 输出 Token 后失败；较新的 `66f2112c64684dca81584b16ab8ecfc4` 在 requirements 返回 `length`、4,001 输出 Token 时就失败，没有已完成阶段。不能将后者称为最后一步失败。

旧版本只能重新发起，导致先前成功分析可能重复调用。现新增检查点与“重新执行 / 继续执行”：前者按当前输入从头运行所选动作，后者使用原始输入并复用成功阶段。追溯记录与 LangGraph 节点检查点共同保存恢复现场。技术实现、故障窗口和验证见 [RT-003 检查点恢复](runtime-issues/003-checkpoint-recovery.md)。

## 当前生成策略

所有模型的 PRD 正文都按背景范围、流程功能、数据验收三个片段生成。每个片段有独立输出预算；单段返回 `finish_reason=length` 时，服务端最多自动续写两次并合并，整篇文档不受一次模型调用的输出上限约束。分段内容经服务端合并校验后统一评审，每个成功片段单独保存检查点，中途失败后可以继续剩余片段。

截断或无效响应不能保存为成功检查点。没有成功结果的阶段继续时会重新调用；如果模型仍不遵守阶段长度要求，仍可能再次失败。应检查该阶段实际请求的 `maximum_output_tokens` 和响应原因。分析阶段会要求模型输出紧凑结果，避免它在进入正文前耗尽单次输出预算。

## DeepSeek 配置

配置只放在仓库根目录 `.env`，不要放在 `apps/studio/.env.local`：

```env
NEXUS_MODEL_NAME=deepseek-flash
NEXUS_MODEL_BASE_URL=https://api.deepseek.com
NEXUS_MODEL_API_KEY=<server-only-secret>
```

PRD 流程不再读取 `NEXUS_PRD_CONTEXT_TOKENS` 或 `NEXUS_PRD_OUTPUT_TOKENS`。每个阶段使用由任务类型确定的单次输出预算，并用自动续写处理截断。

模型调用使用 Chat Completions SSE 流。Studio 再通过 `/v1/prd/jobs/{job_id}/stream` 接收当前阶段的持久化快照，因此刷新页面或短暂断线后仍能恢复已经收到的内容。DeepSeek 的“显示思考过程”开关分别发送 `thinking.type=enabled` 或 `disabled`；开启后，供应商返回的 `reasoning_content` 会进入任务记录与追溯导出。

模型服务使用 OpenAI-compatible Chat Completions。服务端会在 API 请求中拼接 `/chat/completions`，因此 `NEXUS_MODEL_BASE_URL` 不要重复填写该路径。

检查 API 是否读取配置：

```bash
curl -sS http://127.0.0.1:8000/v1/prd/configuration
```

输出中应包含 `"configured": true`。不要输出或提交 `NEXUS_MODEL_API_KEY`。

## 重启 API

```bash
cd /home/iboo/code/NexusOS
./scripts/start-api.sh
```

保持该终端运行，再刷新 Studio 的 `/prd` 页面。验证服务：

```bash
curl http://127.0.0.1:8000/readyz
```

如果启动失败，先检查 8000 端口：

```bash
ss -ltnp 'sport = :8000'
```

同一端口已有 API 时，不要重复启动；停止旧进程后再启动脚本。

## 服务重启后的任务

API 重启不会自动重放正在执行的模型任务，避免重复产生供应商调用费用。未完成任务会被标记为中断，已保存的文档和版本保留。回到文档页面，在主编辑区顶部任务状态条或“全程追溯”中选择“继续执行”或“重新执行”。继续执行不重跑已确认完成的阶段；已修改需求、已有后续任务或缺少输入快照时会说明不可恢复原因。
