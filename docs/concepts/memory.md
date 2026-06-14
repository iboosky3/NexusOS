# Memory 设计

NexusOS 将记忆分为三类：

- Working Memory：当前运行的短期状态，适合 Redis 或运行时 Checkpoint。
- Episodic Memory：历史运行、选择与结果，适合 PostgreSQL 等持久化存储。
- Semantic Memory：可语义检索的知识与经验，适合 Qdrant 等向量存储。

领域层只依赖 `MemoryStore` 端口。内存实现用于测试与单机演示，不代表生产数据模型。任何检索结果仍需经过上下文预算与授权过滤。
