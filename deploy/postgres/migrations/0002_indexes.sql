-- Access paths follow tenant and run boundaries used by the API and Studio.
CREATE INDEX idx_resource_versions_lookup
    ON resource_versions (tenant_id, resource_kind, name, created_at DESC);
CREATE INDEX idx_runs_tenant_status
    ON runs (tenant_id, status, created_at DESC);
CREATE INDEX idx_tasks_run_status
    ON tasks (run_id, status, updated_at DESC);
CREATE INDEX idx_agent_runs_run
    ON agent_runs (run_id, started_at);
CREATE INDEX idx_routing_results_run_task
    ON routing_results (run_id, task_id, created_at DESC);
CREATE INDEX idx_skill_invocations_run
    ON skill_invocations (run_id, task_id, created_at);
CREATE INDEX idx_tool_invocations_run
    ON tool_invocations (run_id, task_id, created_at);
CREATE INDEX idx_artifacts_run
    ON artifacts (run_id, created_at);
CREATE INDEX idx_memories_project_kind
    ON memories (tenant_id, project_id, memory_kind, created_at DESC);
CREATE INDEX idx_model_usage_run
    ON model_usage (run_id, created_at);
CREATE INDEX idx_audit_logs_tenant_time
    ON audit_logs (tenant_id, created_at DESC);
