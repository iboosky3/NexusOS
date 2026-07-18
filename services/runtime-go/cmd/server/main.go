// Command server exposes the NexusOS task runtime over HTTP.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	runtime "github.com/nexusos/nexusos/services/runtime-go/internal/runtime"
)

func main() {
	scheduler := runtime.NewScheduler(32, func(ctx context.Context, task runtime.Task) (json.RawMessage, error) {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
			return task.Payload, nil
		}
	})
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(writer http.ResponseWriter, request *http.Request) {
		writeJSON(writer, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("POST /v1/tasks:execute", func(writer http.ResponseWriter, request *http.Request) {
		decoder := json.NewDecoder(http.MaxBytesReader(writer, request.Body, 1<<20))
		decoder.DisallowUnknownFields()
		var task runtime.Task
		if err := decoder.Decode(&task); err != nil {
			writeJSON(writer, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		result, err := scheduler.Execute(request.Context(), task)
		if errors.Is(err, runtime.ErrInvalidTask) {
			writeJSON(writer, http.StatusUnprocessableEntity, map[string]string{"error": err.Error()})
			return
		}
		if err != nil {
			writeJSON(writer, http.StatusBadGateway, result)
			return
		}
		writeJSON(writer, http.StatusOK, result)
	})

	server := &http.Server{
		Addr:              ":8081",
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      35 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	stop, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	go func() {
		slog.Info("runtime server started", "address", server.Addr)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("runtime server failed", "error", err)
			cancel()
		}
	}()
	<-stop.Done()
	shutdownContext, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()
	if err := server.Shutdown(shutdownContext); err != nil {
		slog.Error("runtime server shutdown failed", "error", err)
	}
}

func writeJSON(writer http.ResponseWriter, status int, payload any) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(status)
	if err := json.NewEncoder(writer).Encode(payload); err != nil {
		slog.Error("encode response", "error", err)
	}
}
