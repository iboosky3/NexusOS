# 快速开始

## 1. 环境

本地参考运行需要 Python 3.12。完整 HTTP 服务还需要安装 `api` 可选依赖。

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e .
```

## 2. 运行测试

```bash
PYTHONPATH=packages/nexusos-python/src \
python -m unittest discover -s tests -p 'test_*.py' -v
```

## 3. 使用 CLI

```bash
nexus prd "面向大学生的 AI 学习笔记产品" --output artifacts
```

命令会生成 `PRD.md` 与 `run.json`，可在完全离线的 Local Runtime 中验证完整链路。

## 4. 启动 API

```bash
pip install -e '.[api]'
uvicorn nexusos.api:create_app --factory --host 0.0.0.0 --port 8000
```

发送参考任务：

```bash
curl -X POST http://localhost:8000/v1/prd/runs \
  -H 'Content-Type: application/json' \
  -d '{"request":"面向大学生的 AI 学习笔记产品"}'
```

返回内容包括运行 ID、任务状态、Agent 与 Skill 选择、结构化评审、Token 使用和 PRD 产物。Local Runtime 不访问在线模型，适合验证工程链路；生产模型适配器在后续里程碑接入。
