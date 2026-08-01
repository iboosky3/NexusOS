-- NexusOS metadata schema for the single-VM reference deployment.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE tenants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug text NOT NULL UNIQUE,
    name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE principals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    subject text NOT NULL,
    display_name text NOT NULL,
    principal_type text NOT NULL CHECK (principal_type IN ('user', 'service', 'agent')),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, subject)
);

CREATE TABLE projects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    name text NOT NULL,
    description text NOT NULL DEFAULT '',
    created_by uuid NOT NULL REFERENCES principals(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, name)
);

CREATE TABLE resource_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    resource_kind text NOT NULL CHECK (
        resource_kind IN ('agent', 'skill', 'tool', 'workflow', 'model_policy')
    ),
    name text NOT NULL,
    version text NOT NULL,
    manifest jsonb NOT NULL,
    content_digest text NOT NULL,
    created_by uuid NOT NULL REFERENCES principals(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, resource_kind, name, version)
);

CREATE TABLE runs (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    project_id uuid REFERENCES projects(id),
    workflow_version_id uuid REFERENCES resource_versions(id),
    requested_by uuid NOT NULL REFERENCES principals(id),
    status text NOT NULL CHECK (
        status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled', 'blocked')
    ),
    goal jsonb NOT NULL,
    input jsonb NOT NULL,
    review jsonb,
    started_at timestamptz,
    completed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tasks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    external_task_id text NOT NULL,
    title text NOT NULL,
    objective text NOT NULL,
    dependencies jsonb NOT NULL DEFAULT '[]'::jsonb,
    required_capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
    status text NOT NULL,
    attempt integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (run_id, external_task_id)
);

CREATE TABLE agent_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    agent_version_id uuid NOT NULL REFERENCES resource_versions(id),
    runtime text NOT NULL,
    status text NOT NULL,
    started_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz
);

CREATE TABLE routing_results (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    strategy text NOT NULL,
    candidates jsonb NOT NULL,
    selected_skill_ids jsonb NOT NULL,
    token_budget integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE skill_invocations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    agent_run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    skill_version_id uuid NOT NULL REFERENCES resource_versions(id),
    status text NOT NULL,
    input_tokens integer NOT NULL DEFAULT 0,
    output_tokens integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tool_invocations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    agent_run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    tool_version_id uuid REFERENCES resource_versions(id),
    request_id text NOT NULL,
    idempotency_key text NOT NULL,
    status text NOT NULL,
    duration_ms integer,
    error_code text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE artifacts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
    name text NOT NULL,
    media_type text NOT NULL,
    object_key text NOT NULL,
    content_digest text NOT NULL,
    size_bytes bigint NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, object_key)
);

CREATE TABLE memories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
    run_id uuid REFERENCES runs(id) ON DELETE CASCADE,
    memory_kind text NOT NULL CHECK (memory_kind IN ('working', 'episodic', 'semantic')),
    classification text NOT NULL DEFAULT 'internal',
    content text NOT NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    expires_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE model_usage (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    task_id uuid REFERENCES tasks(id) ON DELETE CASCADE,
    provider text NOT NULL,
    model text NOT NULL,
    input_tokens integer NOT NULL DEFAULT 0,
    output_tokens integer NOT NULL DEFAULT 0,
    estimated_cost numeric(18, 8) NOT NULL DEFAULT 0,
    latency_ms integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    principal_id uuid REFERENCES principals(id),
    run_id uuid REFERENCES runs(id) ON DELETE SET NULL,
    action text NOT NULL,
    resource_kind text NOT NULL,
    resource_id text,
    decision text NOT NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);
