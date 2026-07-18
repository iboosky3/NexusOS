// Package runtime implements bounded and idempotent NexusOS task execution.
package runtime

import (
	"encoding/json"
	"errors"
	"time"
)

var ErrInvalidTask = errors.New("invalid task")

type Task struct {
	ID                  string          `json:"id"`
	RunID               string          `json:"run_id"`
	IdempotencyKey      string          `json:"idempotency_key"`
	Payload             json.RawMessage `json:"payload"`
	MaximumAttempts     int             `json:"maximum_attempts"`
	TimeoutMilliseconds int             `json:"timeout_milliseconds"`
}

func (task Task) Validate() error {
	if task.ID == "" || task.RunID == "" || task.IdempotencyKey == "" {
		return ErrInvalidTask
	}
	if task.MaximumAttempts < 0 || task.TimeoutMilliseconds < 0 {
		return ErrInvalidTask
	}
	return nil
}

type Result struct {
	TaskID      string          `json:"task_id"`
	RunID       string          `json:"run_id"`
	Status      string          `json:"status"`
	Output      json.RawMessage `json:"output,omitempty"`
	Attempts    int             `json:"attempts"`
	StartedAt   time.Time       `json:"started_at"`
	CompletedAt time.Time       `json:"completed_at"`
	Error       string          `json:"error,omitempty"`
}
