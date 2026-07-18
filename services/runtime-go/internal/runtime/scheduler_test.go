package runtime

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestSchedulerBoundsConcurrency(t *testing.T) {
	var active atomic.Int32
	var maximum atomic.Int32
	scheduler := NewScheduler(2, func(ctx context.Context, task Task) (json.RawMessage, error) {
		current := active.Add(1)
		defer active.Add(-1)
		for {
			observed := maximum.Load()
			if current <= observed || maximum.CompareAndSwap(observed, current) {
				break
			}
		}
		time.Sleep(10 * time.Millisecond)
		return task.Payload, nil
	})

	var group sync.WaitGroup
	for index := 0; index < 8; index++ {
		group.Add(1)
		go func(index int) {
			defer group.Done()
			_, err := scheduler.Execute(context.Background(), validTask(index))
			if err != nil {
				t.Errorf("execute task: %v", err)
			}
		}(index)
	}
	group.Wait()
	if maximum.Load() != 2 {
		t.Fatalf("maximum concurrency = %d, want 2", maximum.Load())
	}
}

func TestSchedulerRetriesAndReportsAttempts(t *testing.T) {
	var calls atomic.Int32
	scheduler := NewScheduler(1, func(ctx context.Context, task Task) (json.RawMessage, error) {
		if calls.Add(1) < 3 {
			return nil, errors.New("transient failure")
		}
		return json.RawMessage(`{"ok":true}`), nil
	})
	task := validTask(1)
	task.MaximumAttempts = 3

	result, err := scheduler.Execute(context.Background(), task)
	if err != nil {
		t.Fatalf("execute task: %v", err)
	}
	if result.Attempts != 3 || result.Status != "succeeded" {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestSchedulerDeduplicatesIdempotencyKeys(t *testing.T) {
	var calls atomic.Int32
	release := make(chan struct{})
	scheduler := NewScheduler(2, func(ctx context.Context, task Task) (json.RawMessage, error) {
		calls.Add(1)
		<-release
		return task.Payload, nil
	})
	task := validTask(2)
	results := make(chan Result, 2)
	for index := 0; index < 2; index++ {
		go func() {
			result, _ := scheduler.Execute(context.Background(), task)
			results <- result
		}()
	}
	time.Sleep(10 * time.Millisecond)
	close(release)
	first := <-results
	second := <-results
	if calls.Load() != 1 {
		t.Fatalf("handler calls = %d, want 1", calls.Load())
	}
	if first.TaskID != second.TaskID || first.Status != "succeeded" {
		t.Fatalf("deduplicated results differ: %#v %#v", first, second)
	}
}

func validTask(index int) Task {
	identifier := string(rune('a' + index))
	return Task{
		ID:             "task-" + identifier,
		RunID:          "run-1",
		IdempotencyKey: "run-1:task-" + identifier,
		Payload:        json.RawMessage(`{"value":1}`),
	}
}
