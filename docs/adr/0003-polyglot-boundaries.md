# ADR-0003：按负载特征采用多语言服务

- 日期：2026-07-18
- 状态：已接受

## 背景

Python 参考内核已经证明契约和 PRD 闭环，但未来的大量任务调度、工具连接和 Skill 批量排序具有不同负载特征。全部使用 Python 会增加并发服务的运行成本；直接全面微服务化又会过早引入网络与运维复杂度。

## 决策

保留 Python 作为规范实现与智能平面，逐步增加 Go Runtime、Go MCP Gateway 和 Rust Skill Router。所有远程实现必须与 Python 端口保持契约等价，并提供进程内降级实现。TypeScript 只负责 Studio，C++/CUDA 通过外部模型服务使用。

## 后果

- 仓库采用 Monorepo 管理跨语言契约和测试夹具。
- 服务拆分必须有基准数据，不以语言偏好为依据。
- JSON v1 契约先行，后续可根据性能数据升级为 gRPC。
- CI 需要分别验证 Python、Go、Rust 与 TypeScript。
- 版本兼容、超时、幂等和降级成为服务边界的强制要求。
