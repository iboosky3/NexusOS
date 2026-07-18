package runtime

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"
)

type Handler func(context.Context, Task) (json.RawMessage, error)

type execution struct {
	done   chan struct{}
	result Result
	err    error
}

type Scheduler struct {
	capacity chan struct{}
	handler  Handler

	mu         sync.Mutex
	executions map[string]*execution
}

func NewScheduler(maximumConcurrency int, handler Handler) *Scheduler {
	if maximumConcurrency < 1 {
		panic("maximum concurrency must be positive")
	}
	if handler == nil {
		panic("handler is required")
	}
	return &Scheduler{
		capacity:   make(chan struct{}, maximumConcurrency),
		handler:    handler,
		executions: make(map[string]*execution),
	}
}

func (scheduler *Scheduler) Execute(ctx context.Context, task Task) (Result, error) {
	if err := task.Validate(); err != nil {
		return Result{}, err
	}

	current, owner := scheduler.reserve(task.IdempotencyKey)
	if !owner {
		select {
		case <-current.done:
			return current.result, current.err
		case <-ctx.Done():
			return Result{}, ctx.Err()
		}
	}

	select {
	case scheduler.capacity <- struct{}{}:
		defer func() { <-scheduler.capacity }()
	case <-ctx.Done():
		scheduler.complete(current, Result{}, ctx.Err())
		return Result{}, ctx.Err()
	}

	result, err := scheduler.run(ctx, task)
	scheduler.complete(current, result, err)
	return result, err
}

func (scheduler *Scheduler) reserve(key string) (*execution, bool) {
	scheduler.mu.Lock()
	defer scheduler.mu.Unlock()
	if current, exists := scheduler.executions[key]; exists {
		return current, false
	}
	current := &execution{done: make(chan struct{})}
	scheduler.executions[key] = current
	return current, true
}

func (scheduler *Scheduler) complete(current *execution, result Result, err error) {
	scheduler.mu.Lock()
	defer scheduler.mu.Unlock()
	current.result = result
	current.err = err
	close(current.done)
}

func (scheduler *Scheduler) run(ctx context.Context, task Task) (Result, error) {
	maximumAttempts := task.MaximumAttempts
	if maximumAttempts == 0 {
		maximumAttempts = 1
	}
	timeout := time.Duration(task.TimeoutMilliseconds) * time.Millisecond
	if timeout == 0 {
		timeout = 30 * time.Second
	}
	result := Result{
		TaskID:    task.ID,
		RunID:     task.RunID,
		Status:    "running",
		StartedAt: time.Now().UTC(),
	}
	var lastErr error
	for attempt := 1; attempt <= maximumAttempts; attempt++ {
		result.Attempts = attempt
		attemptContext, cancel := context.WithTimeout(ctx, timeout)
		result.Output, lastErr = scheduler.handler(attemptContext, task)
		cancel()
		if lastErr == nil {
			result.Status = "succeeded"
			result.CompletedAt = time.Now().UTC()
			return result, nil
		}
		if ctx.Err() != nil {
			lastErr = ctx.Err()
			break
		}
	}
	result.Status = "failed"
	result.Error = lastErr.Error()
	result.CompletedAt = time.Now().UTC()
	return result, fmt.Errorf("task %s failed after %d attempts: %w", task.ID, result.Attempts, lastErr)
}
