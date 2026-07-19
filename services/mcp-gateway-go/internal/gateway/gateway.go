// Package gateway enforces discovery and invocation policy for external tools.
package gateway

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"
)

var (
	ErrForbidden   = errors.New("tool invocation is forbidden")
	ErrUnknownTool = errors.New("unknown tool")
)

type Tool struct {
	Name               string
	Description        string
	RiskLevel          int
	TimeoutMilliseconds int
}

type Principal struct {
	TenantID    string
	SubjectID   string
	AllowedTools map[string]struct{}
	MaximumRisk int
}

type Invocation struct {
	RequestID      string
	IdempotencyKey string
	ToolName       string
	Arguments      map[string]any
	Principal      Principal
}

type Result struct {
	RequestID string
	ToolName  string
	Output    map[string]any
	Duration  time.Duration
}

type Invoker interface {
	Invoke(context.Context, Tool, map[string]any) (map[string]any, error)
}

type AuditEvent struct {
	RequestID string
	TenantID  string
	SubjectID string
	ToolName  string
	Allowed   bool
	Error     string
	Duration  time.Duration
}

type AuditSink interface {
	Append(AuditEvent)
}

type Gateway struct {
	tools   map[string]Tool
	invoker Invoker
	audit   AuditSink

	mu      sync.Mutex
	results map[string]*cachedResult
}

type cachedResult struct {
	done   chan struct{}
	result Result
	err    error
}

func New(tools []Tool, invoker Invoker, audit AuditSink) *Gateway {
	registry := make(map[string]Tool, len(tools))
	for _, tool := range tools {
		if tool.Name == "" {
			panic("tool name is required")
		}
		if _, exists := registry[tool.Name]; exists {
			panic("duplicate tool: " + tool.Name)
		}
		registry[tool.Name] = tool
	}
	return &Gateway{tools: registry, invoker: invoker, audit: audit, results: make(map[string]*cachedResult)}
}

func (gateway *Gateway) Discover(principal Principal) []Tool {
	discovered := make([]Tool, 0)
	for _, tool := range gateway.tools {
		if gateway.allowed(principal, tool) {
			discovered = append(discovered, tool)
		}
	}
	return discovered
}

func (gateway *Gateway) Invoke(ctx context.Context, invocation Invocation) (Result, error) {
	tool, exists := gateway.tools[invocation.ToolName]
	if !exists {
		gateway.record(invocation, false, ErrUnknownTool, 0)
		return Result{}, ErrUnknownTool
	}
	if !gateway.allowed(invocation.Principal, tool) {
		gateway.record(invocation, false, ErrForbidden, 0)
		return Result{}, ErrForbidden
	}
	if invocation.RequestID == "" || invocation.IdempotencyKey == "" {
		return Result{}, errors.New("request and idempotency identifiers are required")
	}

	current, owner := gateway.reserve(invocation.IdempotencyKey)
	if !owner {
		select {
		case <-current.done:
			return current.result, current.err
		case <-ctx.Done():
			return Result{}, ctx.Err()
		}
	}

	timeout := time.Duration(tool.TimeoutMilliseconds) * time.Millisecond
	if timeout == 0 {
		timeout = 30 * time.Second
	}
	invokeContext, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	started := time.Now()
	output, err := gateway.invoker.Invoke(invokeContext, tool, invocation.Arguments)
	result := Result{
		RequestID: invocation.RequestID,
		ToolName:  tool.Name,
		Output:    output,
		Duration:  time.Since(started),
	}
	gateway.complete(invocation.IdempotencyKey, result, err)
	gateway.record(invocation, true, err, result.Duration)
	if err != nil {
		return result, fmt.Errorf("invoke tool %s: %w", tool.Name, err)
	}
	return result, nil
}

func (gateway *Gateway) allowed(principal Principal, tool Tool) bool {
	_, explicitlyAllowed := principal.AllowedTools[tool.Name]
	return principal.TenantID != "" && principal.SubjectID != "" && explicitlyAllowed && tool.RiskLevel <= principal.MaximumRisk
}

func (gateway *Gateway) reserve(key string) (*cachedResult, bool) {
	gateway.mu.Lock()
	defer gateway.mu.Unlock()
	if current, exists := gateway.results[key]; exists {
		return current, false
	}
	current := &cachedResult{done: make(chan struct{})}
	gateway.results[key] = current
	return current, true
}

func (gateway *Gateway) complete(key string, result Result, err error) {
	gateway.mu.Lock()
	defer gateway.mu.Unlock()
	current := gateway.results[key]
	current.result = result
	current.err = err
	close(current.done)
}

func (gateway *Gateway) record(invocation Invocation, allowed bool, err error, duration time.Duration) {
	if gateway.audit == nil {
		return
	}
	errorMessage := ""
	if err != nil {
		errorMessage = err.Error()
	}
	gateway.audit.Append(AuditEvent{
		RequestID: invocation.RequestID,
		TenantID:  invocation.Principal.TenantID,
		SubjectID: invocation.Principal.SubjectID,
		ToolName:  invocation.ToolName,
		Allowed:   allowed,
		Error:     errorMessage,
		Duration:  duration,
	})
}
