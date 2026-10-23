//go:build linux

package desktop

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
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
