# Rust Skill Router

Rust 排序内核接收 Python 智能平面或 Qdrant 适配器提供的候选，不负责读取完整 Skill 包。处理步骤为：硬策略过滤、评分归一化、加权融合、稳定排序和 Token 预算装箱。

稠密与稀疏召回通过 Reciprocal Rank Fusion 合并。候选输出保留每个评分分量，保证与 Python 参考实现具有相同可解释性。

第一版只提供无网络依赖的 library crate，方便基准定位真实计算收益。RPC 适配器在契约与性能目标明确后增加，避免让核心算法绑定框架。
