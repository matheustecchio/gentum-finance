//go:build linux

package desktop

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"
)

func lockData(dir string) (func(), error) {
	file, err := os.OpenFile(filepath.Join(dir, "runtime.lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err = syscall.Flock(int(file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		file.Close()
		return nil, errors.New("this Gentum data directory is already in use")
	}
	return func() { syscall.Flock(int(file.Fd()), syscall.LOCK_UN); file.Close() }, nil
}

// Stop PostgreSQL if the Go sidecar is terminated unexpectedly.
func configureChild(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{Pdeathsig: syscall.SIGINT}
}

func superviseChild(*exec.Cmd) (func(), error) { return func() {}, nil }

func postgresBinary(dir string) string { return filepath.Join(dir, "bin", "postgres") }

func initdbBinary(dir string) string { return filepath.Join(dir, "bin", "initdb") }

func shutdownChild(p *Postgres) {
	if p.command == nil || p.command.Process == nil || p.exited == nil {
		return
	}
	// PostgreSQL interprets SIGINT as fast shutdown, rolling back active work.
	_ = p.command.Process.Signal(os.Interrupt)
	select {
	case <-p.exited:
	case <-time.After(8 * time.Second):
		_ = p.command.Process.Kill()
		<-p.exited
	}
}
