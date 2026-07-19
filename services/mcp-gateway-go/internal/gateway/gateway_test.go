package gateway

import (
	"context"
	"errors"
	"sync"
	"testing"
)

type fakeInvoker struct {
	mu    sync.Mutex
	calls int
}

func (invoker *fakeInvoker) Invoke(ctx context.Context, tool Tool, arguments map[string]any) (map[string]any, error) {
	invoker.mu.Lock()
	defer invoker.mu.Unlock()
	invoker.calls++
	return map[string]any{"tool": tool.Name}, nil
}

type auditLog struct {
	events []AuditEvent
}

func (log *auditLog) Append(event AuditEvent) {
	log.events = append(log.events, event)
}

func TestGatewayFiltersDiscoveryAndInvocation(t *testing.T) {
	invoker := &fakeInvoker{}
	audit := &auditLog{}
	gateway := New(
		[]Tool{{Name: "web.search", RiskLevel: 1}, {Name: "database.write", RiskLevel: 3}},
		invoker,
		audit,
	)
	principal := Principal{
		TenantID: "tenant-1", SubjectID: "agent-1", MaximumRisk: 1,
		AllowedTools: map[string]struct{}{"web.search": {}, "database.write": {}},
	}

	tools := gateway.Discover(principal)
	if len(tools) != 1 || tools[0].Name != "web.search" {
		t.Fatalf("unexpected discovery result: %#v", tools)
	}
	_, err := gateway.Invoke(context.Background(), Invocation{
		RequestID: "request-1", IdempotencyKey: "run-1:task-1:tool-1",
		ToolName: "database.write", Principal: principal,
	})
	if !errors.Is(err, ErrForbidden) {
		t.Fatalf("invoke error = %v, want forbidden", err)
	}
	if len(audit.events) != 1 || audit.events[0].Allowed {
		t.Fatalf("forbidden call was not audited: %#v", audit.events)
	}
}

func TestGatewayCachesIdempotentResult(t *testing.T) {
	invoker := &fakeInvoker{}
	gateway := New([]Tool{{Name: "web.search", RiskLevel: 1}}, invoker, nil)
	invocation := Invocation{
		RequestID: "request-1", IdempotencyKey: "run-1:task-1:tool-1", ToolName: "web.search",
		Principal: Principal{
			TenantID: "tenant-1", SubjectID: "agent-1", MaximumRisk: 1,
			AllowedTools: map[string]struct{}{"web.search": {}},
		},
	}

	first, firstErr := gateway.Invoke(context.Background(), invocation)
	second, secondErr := gateway.Invoke(context.Background(), invocation)
	if firstErr != nil || secondErr != nil {
		t.Fatalf("invoke errors: %v, %v", firstErr, secondErr)
	}
	if invoker.calls != 1 || first.ToolName != second.ToolName {
		t.Fatalf("idempotency failed: calls=%d first=%#v second=%#v", invoker.calls, first, second)
	}
}

func TestGatewaySharesConcurrentIdempotentResult(t *testing.T) {
	invoker := &fakeInvoker{}
	release := make(chan struct{})
	blockingInvoker := InvokerFunc(func(ctx context.Context, tool Tool, arguments map[string]any) (map[string]any, error) {
		invoker.mu.Lock()
		invoker.calls++
		invoker.mu.Unlock()
		<-release
		return map[string]any{"shared": true}, nil
	})
	gateway := New([]Tool{{Name: "web.search", RiskLevel: 1}}, blockingInvoker, nil)
	invocation := Invocation{
		RequestID: "request-1", IdempotencyKey: "shared-key", ToolName: "web.search",
		Principal: Principal{
			TenantID: "tenant-1", SubjectID: "agent-1", MaximumRisk: 1,
			AllowedTools: map[string]struct{}{"web.search": {}},
		},
	}
	results := make(chan Result, 2)
	for index := 0; index < 2; index++ {
		go func() {
			result, _ := gateway.Invoke(context.Background(), invocation)
			results <- result
		}()
	}
	close(release)
	first := <-results
	second := <-results
	if invoker.calls != 1 || first.Output["shared"] != second.Output["shared"] {
		t.Fatalf("concurrent result was not shared: calls=%d", invoker.calls)
	}
}

type InvokerFunc func(context.Context, Tool, map[string]any) (map[string]any, error)

func (function InvokerFunc) Invoke(ctx context.Context, tool Tool, arguments map[string]any) (map[string]any, error) {
	return function(ctx, tool, arguments)
}
