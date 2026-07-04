# Nexus API

Nexus API 是参考 HTTP 入口。它只负责协议校验与领域对象序列化，编排逻辑由 Python 包中的应用服务提供。

安装 API 可选依赖后启动：

```bash
uv sync --extra api
uv run uvicorn nexusos.api:create_app --factory --host 0.0.0.0 --port 8000
```

健康检查为 `GET /healthz`，PRD 参考运行入口为 `POST /v1/prd/runs`。
