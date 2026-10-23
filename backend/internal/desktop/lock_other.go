//go:build !linux

package desktop

import (
	"errors"
	"os/exec"
)

func lockData(string) (func(), error) {
	return nil, errors.New("this desktop build currently supports Linux only")
}

func configureChild(*exec.Cmd) {}
