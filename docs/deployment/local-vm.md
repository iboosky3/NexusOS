# 本地虚拟机部署

推荐使用 Ubuntu 24.04 LTS。学习环境最低 8 核 CPU、16 GB 内存、120 GB SSD；同时运行本地模型和完整观测栈时建议 12 核、32 GB 内存、200 GB SSD。

第一阶段只启用 Docker Compose，不启用 Kafka、Temporal、Kubernetes 或 Keycloak，避免运维复杂度干扰 Agent 与 Router 验证。

```bash
cp .env.example .env
docker compose up --build -d
curl http://localhost:8000/healthz
```

需要观测栈时增加：

```bash
docker compose --profile observability up --build -d
```

`.env` 不提交 Git。示例凭据只允许本地开发，生产配置会拒绝默认密钥。
