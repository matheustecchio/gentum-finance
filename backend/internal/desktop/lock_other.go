//go:build !linux && !windows

package desktop

import (
	"errors"
	"os/exec"
	"path/filepath"
)

func lockData(string) (func(), error) {
	return nil, errors.New("this desktop build currently supports Linux only")
}

func configureChild(*exec.Cmd) {}

func superviseChild(*exec.Cmd) (func(), error) { return func() {}, nil }

func postgresBinary(dir string) string { return filepath.Join(dir, "bin", "postgres") }

func initdbBinary(dir string) string { return filepath.Join(dir, "bin", "initdb") }

func shutdownChild(p *Postgres) {
	if p.command != nil && p.command.Process != nil {
		_ = p.command.Process.Kill()
	}
}
