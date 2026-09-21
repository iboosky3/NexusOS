-- Versioned PRD workspace resources and append-only business trace events.
CREATE TABLE project_workspaces (
    project_id uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    title text NOT NULL,
    ai_mode text NOT NULL DEFAULT 'brainstorm'
        CHECK (ai_mode IN ('brainstorm', 'professional')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE prd_document_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    version integer NOT NULL CHECK (version > 0),
    content jsonb NOT NULL,
    source_run_id uuid REFERENCES runs(id) ON DELETE SET NULL,
    created_by uuid NOT NULL REFERENCES principals(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (project_id, version)
);

CREATE TABLE prototype_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    prototype_id uuid NOT NULL,
    version integer NOT NULL CHECK (version > 0),
    node_tree jsonb NOT NULL DEFAULT '{}'::jsonb,
    compiled_html text NOT NULL,
    source_run_id uuid REFERENCES runs(id) ON DELETE SET NULL,
    created_by uuid NOT NULL REFERENCES principals(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (prototype_id, version)
);

CREATE TABLE screenshot_references (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    prototype_id uuid NOT NULL,
    prototype_version integer NOT NULL CHECK (prototype_version > 0),
    node_id text,
    object_key text,
    purpose text NOT NULL,
    precondition text NOT NULL DEFAULT '',
    expected_result text NOT NULL DEFAULT '',
    prd_block_id text,
    created_by uuid NOT NULL REFERENCES principals(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (prototype_id, prototype_version)
        REFERENCES prototype_versions(prototype_id, version)
);

CREATE TABLE workspace_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    sequence bigint NOT NULL CHECK (sequence > 0),
    occurred_at timestamptz NOT NULL DEFAULT now(),
    actor_type text NOT NULL CHECK (actor_type IN ('user', 'agent', 'system')),
    actor_id text NOT NULL,
    action text NOT NULL,
    resource_kind text NOT NULL,
    resource_id text NOT NULL,
    resource_version integer,
    correlation_id uuid NOT NULL,
    causation_id uuid REFERENCES workspace_events(id) ON DELETE RESTRICT,
    run_id uuid REFERENCES runs(id) ON DELETE SET NULL,
    summary text NOT NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE (project_id, sequence)
);

CREATE INDEX idx_prd_versions_project
    ON prd_document_versions (project_id, version DESC);
CREATE INDEX idx_prototype_versions_project
    ON prototype_versions (project_id, prototype_id, version DESC);
CREATE INDEX idx_screenshot_references_project
    ON screenshot_references (project_id, created_at DESC);
CREATE INDEX idx_workspace_events_timeline
    ON workspace_events (project_id, sequence DESC);
CREATE INDEX idx_workspace_events_correlation
    ON workspace_events (tenant_id, correlation_id, occurred_at);

ALTER TABLE project_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE prd_document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE prototype_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE screenshot_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON project_workspaces
    USING (tenant_id = nexus_current_tenant_id())
    WITH CHECK (tenant_id = nexus_current_tenant_id());
CREATE POLICY tenant_isolation ON prd_document_versions
    USING (tenant_id = nexus_current_tenant_id())
    WITH CHECK (tenant_id = nexus_current_tenant_id());
CREATE POLICY tenant_isolation ON prototype_versions
    USING (tenant_id = nexus_current_tenant_id())
    WITH CHECK (tenant_id = nexus_current_tenant_id());
CREATE POLICY tenant_isolation ON screenshot_references
    USING (tenant_id = nexus_current_tenant_id())
    WITH CHECK (tenant_id = nexus_current_tenant_id());
CREATE POLICY tenant_isolation ON workspace_events
    USING (tenant_id = nexus_current_tenant_id())
    WITH CHECK (tenant_id = nexus_current_tenant_id());

ALTER TABLE project_workspaces FORCE ROW LEVEL SECURITY;
ALTER TABLE prd_document_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE prototype_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE screenshot_references FORCE ROW LEVEL SECURITY;
ALTER TABLE workspace_events FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION reject_workspace_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'workspace_events is append-only';
END;
$$;

CREATE TRIGGER workspace_events_append_only
BEFORE UPDATE OR DELETE ON workspace_events
FOR EACH ROW EXECUTE FUNCTION reject_workspace_event_mutation();
