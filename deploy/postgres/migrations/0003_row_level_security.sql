-- Tenant isolation is enforced even when application queries omit a filter.
CREATE OR REPLACE FUNCTION nexus_current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
    SELECT NULLIF(current_setting('nexus.tenant_id', true), '')::uuid
$$;

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE principals ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE resource_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE routing_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_invocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_invocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON tenants
    USING (id = nexus_current_tenant_id())
    WITH CHECK (id = nexus_current_tenant_id());
CREATE POLICY tenant_isolation ON principals
    USING (tenant_id = nexus_current_tenant_id())
    WITH CHECK (tenant_id = nexus_current_tenant_id());
CREATE POLICY tenant_isolation ON projects
    USING (tenant_id = nexus_current_tenant_id())
    WITH CHECK (tenant_id = nexus_current_tenant_id());
CREATE POLICY tenant_isolation ON resource_versions
    USING (tenant_id = nexus_current_tenant_id())
    WITH CHECK (tenant_id = nexus_current_tenant_id());
CREATE POLICY tenant_isolation ON runs
    USING (tenant_id = nexus_current_tenant_id())
    WITH CHECK (tenant_id = nexus_current_tenant_id());
CREATE POLICY tenant_isolation ON tasks
    USING (tenant_id = nexus_current_tenant_id())
    WITH CHECK (tenant_id = nexus_current_tenant_id());
CREATE POLICY tenant_isolation ON agent_runs
    USING (tenant_id = nexus_current_tenant_id())
    WITH CHECK (tenant_id = nexus_current_tenant_id());
CREATE POLICY tenant_isolation ON routing_results
    USING (tenant_id = nexus_current_tenant_id())
    WITH CHECK (tenant_id = nexus_current_tenant_id());
CREATE POLICY tenant_isolation ON skill_invocations
    USING (tenant_id = nexus_current_tenant_id())
    WITH CHECK (tenant_id = nexus_current_tenant_id());
CREATE POLICY tenant_isolation ON tool_invocations
    USING (tenant_id = nexus_current_tenant_id())
    WITH CHECK (tenant_id = nexus_current_tenant_id());
CREATE POLICY tenant_isolation ON artifacts
    USING (tenant_id = nexus_current_tenant_id())
    WITH CHECK (tenant_id = nexus_current_tenant_id());
CREATE POLICY tenant_isolation ON memories
    USING (tenant_id = nexus_current_tenant_id())
    WITH CHECK (tenant_id = nexus_current_tenant_id());
CREATE POLICY tenant_isolation ON model_usage
    USING (tenant_id = nexus_current_tenant_id())
    WITH CHECK (tenant_id = nexus_current_tenant_id());
CREATE POLICY tenant_isolation ON audit_logs
    USING (tenant_id = nexus_current_tenant_id())
    WITH CHECK (tenant_id = nexus_current_tenant_id());

ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE principals FORCE ROW LEVEL SECURITY;
ALTER TABLE projects FORCE ROW LEVEL SECURITY;
ALTER TABLE resource_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE runs FORCE ROW LEVEL SECURITY;
ALTER TABLE tasks FORCE ROW LEVEL SECURITY;
ALTER TABLE agent_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE routing_results FORCE ROW LEVEL SECURITY;
ALTER TABLE skill_invocations FORCE ROW LEVEL SECURITY;
ALTER TABLE tool_invocations FORCE ROW LEVEL SECURITY;
ALTER TABLE artifacts FORCE ROW LEVEL SECURITY;
ALTER TABLE memories FORCE ROW LEVEL SECURITY;
ALTER TABLE model_usage FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
