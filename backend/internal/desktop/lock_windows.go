//go:build windows

package desktop

import (
	"errors"
	"os/exec"
	"path/filepath"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

// Windows sharing modes enforce an exclusive lock while the sidecar owns a
// data directory. Closing the handle releases it even if the sidecar crashes.
func lockData(dir string) (func(), error) {
	path, err := windows.UTF16PtrFromString(filepath.Join(dir, "runtime.lock"))
	if err != nil {
		return nil, err
	}
	handle, err := windows.CreateFile(path, windows.GENERIC_READ|windows.GENERIC_WRITE, 0, nil, windows.OPEN_ALWAYS, windows.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		if errors.Is(err, windows.ERROR_SHARING_VIOLATION) {
			return nil, errors.New("this Gentum data directory is already in use")
		}
		return nil, err
	}
	return func() { _ = windows.CloseHandle(handle) }, nil
}

func configureChild(*exec.Cmd) {}

// A kill-on-close Job Object prevents an abruptly terminated Go sidecar from
// orphaning postgres.exe and holding the local cluster open.
func superviseChild(command *exec.Cmd) (func(), error) {
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return nil, err
	}
	var info windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION
	info.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
	if _, err = windows.SetInformationJobObject(job, windows.JobObjectExtendedLimitInformation, uintptr(unsafe.Pointer(&info)), uint32(unsafe.Sizeof(info))); err != nil {
		_ = windows.CloseHandle(job)
		return nil, err
	}
	process, err := windows.OpenProcess(windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE, false, uint32(command.Process.Pid))
	if err != nil {
		_ = windows.CloseHandle(job)
		return nil, err
	}
	defer windows.CloseHandle(process)
	if err = windows.AssignProcessToJobObject(job, process); err != nil {
		_ = windows.CloseHandle(job)
		return nil, err
	}
	return func() { _ = windows.CloseHandle(job) }, nil
}

func postgresBinary(dir string) string { return filepath.Join(dir, "bin", "postgres.exe") }

func initdbBinary(dir string) string { return filepath.Join(dir, "bin", "initdb.exe") }

func shutdownChild(p *Postgres) {
	if p.command == nil || p.command.Process == nil || p.exited == nil {
		return
	}
	stop := exec.Command(filepath.Join(p.postgresDir, "bin", "pg_ctl.exe"), "-D", p.cluster, "-m", "fast", "-w", "-t", "8", "stop")
	stop.Stdout = p.log
	stop.Stderr = p.log
	_ = stop.Run()
	select {
	case <-p.exited:
	case <-time.After(8 * time.Second):
		_ = p.command.Process.Kill()
		<-p.exited
	}
}
