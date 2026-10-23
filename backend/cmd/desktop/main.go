// Desktop is an internal sidecar. It never opens an application HTTP listener.
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"gentum.finance/backend/internal/application"
	"gentum.finance/backend/internal/desktop"
)

func run() error {
	dataDir := flag.String("data-dir", "", "private application data directory")
	postgresDir := flag.String("postgres-dir", "", "bundled PostgreSQL resource directory")
	flag.Parse()
	if *dataDir == "" || *postgresDir == "" {
		return errors.New("desktop must supply data and bundled PostgreSQL directories")
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	lines := make(chan string, 1)
	go func() {
		defer cancel()
		defer close(lines)
		scanner := bufio.NewScanner(os.Stdin)
		scanner.Buffer(make([]byte, 4096), desktop.MaxMessage)
		for scanner.Scan() {
			select {
			case lines <- scanner.Text():
			case <-ctx.Done():
				return
			}
		}
	}()
	startup, stop := context.WithTimeout(ctx, 60*time.Second)
	defer stop()
	postgres, err := desktop.StartPostgres(startup, *dataDir, *postgresDir)
	if err != nil {
		return err
	}
	defer postgres.Close()
	app, err := application.Open(startup, postgres.Config, postgres.Provision, desktop.Origin)
	if err != nil {
		return err
	}
	defer app.Close()
	bridge, err := desktop.NewBridge(app.Handler(), *dataDir)
	if err != nil {
		return err
	}
	encoder := json.NewEncoder(os.Stdout)
	if err = encoder.Encode(map[string]bool{"ready": true}); err != nil {
		return err
	}
	for {
		select {
		case <-ctx.Done():
			return nil
		case line, ok := <-lines:
			if !ok {
				return nil
			}
			var request desktop.Request
			decoder := json.NewDecoder(strings.NewReader(line))
			decoder.DisallowUnknownFields()
			if err = decoder.Decode(&request); err != nil {
				if err = encoder.Encode(desktop.Response{ID: request.ID, Status: 400, Headers: map[string]string{}, Body: "Invalid desktop request"}); err != nil {
					return err
				}
				continue
			}
			var trailing any
			if decoder.Decode(&trailing) != io.EOF {
				if err = encoder.Encode(desktop.Response{ID: request.ID, Status: 400, Headers: map[string]string{}, Body: "One JSON request is required"}); err != nil {
					return err
				}
				continue
			}
			if err = encoder.Encode(bridge.Do(ctx, request)); err != nil {
				return err
			}
		}
	}
}
func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "Gentum startup failed:", err)
		os.Exit(1)
	}
}
