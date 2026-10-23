package desktop

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type credentials struct {
	Admin     string `json:"admin"`
	Runtime   string `json:"runtime"`
	Provision string `json:"provision"`
}
type Postgres struct {
	Config    *pgxpool.Config
	Provision *pgxpool.Pool
	command   *exec.Cmd
	exited    chan struct{}
	log       *os.File
	release   func()
	once      sync.Once
}

func secret() string {
	data := make([]byte, 32)
	if _, err := rand.Read(data); err != nil {
		panic(err)
	}
	return hex.EncodeToString(data)
}
func loadCredentials(dir string) (credentials, error) {
	path := filepath.Join(dir, "credentials.json")
	raw, err := os.ReadFile(path)
	var result credentials
	if os.IsNotExist(err) {
		result = credentials{secret(), secret(), secret()}
		raw, _ = json.Marshal(result)
		return result, privateWrite(path, raw)
	}
	if err != nil || json.Unmarshal(raw, &result) != nil {
		return result, errors.New("unable to read local database credentials")
	}
	for _, v := range []string{result.Admin, result.Runtime, result.Provision} {
		if len(v) != 64 {
			return result, errors.New("invalid local database credentials")
		}
		if _, err = hex.DecodeString(v); err != nil {
			return result, errors.New("invalid local database credentials")
		}
	}
	return result, nil
}
func StartPostgres(ctx context.Context, dataDir, postgresDir string) (*Postgres, error) {
	if !filepath.IsAbs(dataDir) || !filepath.IsAbs(postgresDir) {
		return nil, errors.New("absolute data and PostgreSQL paths are required")
	}
	if err := os.MkdirAll(dataDir, 0700); err != nil {
		return nil, err
	}
	info, err := os.Lstat(dataDir)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return nil, errors.New("invalid desktop data directory")
	}
	if err = os.Chmod(dataDir, 0700); err != nil {
		return nil, err
	}
	release, err := lockData(dataDir)
	if err != nil {
		return nil, err
	}
	p := &Postgres{release: release}
	ok := false
	defer func() {
		if !ok {
			p.Close()
		}
	}()
	creds, err := loadCredentials(dataDir)
	if err != nil {
		return nil, err
	}
	cluster := filepath.Join(dataDir, "postgres-17")
	version, err := os.ReadFile(filepath.Join(cluster, "PG_VERSION"))
	if err != nil && !os.IsNotExist(err) {
		return nil, errors.New("unable to inspect PostgreSQL data")
	}
	p.log, err = os.OpenFile(filepath.Join(dataDir, "postgres.log"), os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0600)
	if err != nil {
		return nil, err
	}
	if len(version) == 0 {
		// Refuse to reinitialize a partial cluster; the user must inspect it first.
		if _, statErr := os.Stat(cluster); !os.IsNotExist(statErr) {
			return nil, errors.New("incomplete PostgreSQL data directory; existing data was not replaced")
		}
		pass, err := os.CreateTemp(dataDir, ".postgres-password-*")
		if err != nil {
			return nil, err
		}
		passPath := pass.Name()
		defer os.Remove(passPath)
		if _, err = pass.WriteString(creds.Admin); err != nil {
			pass.Close()
			return nil, err
		}
		if err = pass.Close(); err != nil {
			return nil, err
		}
		init := exec.CommandContext(ctx, filepath.Join(postgresDir, "bin", "initdb"), "-D", cluster, "--username=gentum_admin", "--pwfile="+passPath, "--auth-local=scram-sha-256", "--auth-host=scram-sha-256", "--encoding=UTF8", "--locale=C", "--no-instructions")
		init.Stdout = p.log
		init.Stderr = p.log
		if err = init.Run(); err != nil {
			return nil, errors.New("unable to initialize bundled PostgreSQL; inspect the private postgres.log")
		}
	} else if strings.TrimSpace(string(version)) != "17" {
		return nil, errors.New("unsupported PostgreSQL data version; automatic replacement is disabled")
	}
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	port := listener.Addr().(*net.TCPAddr).Port
	listener.Close()
	p.command = exec.Command(filepath.Join(postgresDir, "bin", "postgres"), "-D", cluster, "-h", "127.0.0.1", "-p", strconv.Itoa(port), "-c", "unix_socket_directories=", "-c", "log_statement=none")
	configureChild(p.command)
	p.command.Stdout = p.log
	p.command.Stderr = p.log
	if err = p.command.Start(); err != nil {
		return nil, errors.New("unable to start bundled PostgreSQL")
	}
	p.exited = make(chan struct{})
	go func() { p.command.Wait(); close(p.exited) }()
	adminConfig, err := pgx.ParseConfig("postgres://gentum_admin@127.0.0.1/postgres?sslmode=disable")
	if err != nil {
		return nil, err
	}
	adminConfig.Port = uint16(port)
	adminConfig.Password = creds.Admin
	adminConfig.ConnectTimeout = time.Second
	var admin *pgx.Conn
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	for {
		attempt, cancel := context.WithTimeout(ctx, time.Second)
		admin, err = pgx.ConnectConfig(attempt, adminConfig)
		cancel()
		if err == nil {
			break
		}
		select {
		case <-ctx.Done():
			return nil, errors.New("local database startup timed out or was cancelled")
		case <-p.exited:
			return nil, errors.New("bundled PostgreSQL stopped before becoming ready")
		case <-ticker.C:
		}
	}
	defer admin.Close(context.Background())
	for _, role := range []struct{ name, password, privileges string }{{"gentum_runtime", creds.Runtime, "NOSUPERUSER NOCREATEDB NOCREATEROLE"}, {"gentum_provision", creds.Provision, "NOSUPERUSER CREATEDB NOCREATEROLE"}} {
		var exists bool
		if err = admin.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=$1)", role.name).Scan(&exists); err != nil {
			return nil, errors.New("unable to inspect local roles")
		}
		if !exists {
			if _, err = admin.Exec(ctx, "CREATE ROLE "+pgx.Identifier{role.name}.Sanitize()+" LOGIN "+role.privileges); err != nil {
				return nil, errors.New("unable to create local role")
			}
		}
		// Passwords are generated hexadecimal strings, never renderer input.
		if _, err = admin.Exec(ctx, fmt.Sprintf("ALTER ROLE %s %s PASSWORD '%s'", pgx.Identifier{role.name}.Sanitize(), role.privileges, role.password)); err != nil {
			return nil, errors.New("unable to configure local role")
		}
	}
	if _, err = admin.Exec(ctx, "GRANT gentum_runtime TO gentum_provision"); err != nil {
		return nil, err
	}
	var exists bool
	if err = admin.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname='gentum_finance')`).Scan(&exists); err != nil {
		return nil, err
	}
	if !exists {
		if _, err = admin.Exec(ctx, "CREATE DATABASE gentum_finance OWNER gentum_runtime"); err != nil {
			return nil, errors.New("unable to create local ledger")
		}
	}
	p.Config, err = pgxpool.ParseConfig("postgres://gentum_runtime@127.0.0.1/gentum_finance?sslmode=disable")
	if err != nil {
		return nil, err
	}
	p.Config.ConnConfig.Port = uint16(port)
	p.Config.ConnConfig.Password = creds.Runtime
	provision := p.Config.Copy()
	provision.ConnConfig.User = "gentum_provision"
	provision.ConnConfig.Password = creds.Provision
	p.Provision, err = pgxpool.NewWithConfig(ctx, provision)
	if err != nil {
		return nil, err
	}
	if err = p.Provision.Ping(ctx); err != nil {
		return nil, errors.New("local provisioner unavailable")
	}
	ok = true
	return p, nil
}
func (p *Postgres) Close() {
	p.once.Do(func() {
		if p.Provision != nil {
			p.Provision.Close()
		}
		if p.command != nil && p.command.Process != nil && p.exited != nil {
			// PostgreSQL interprets SIGINT as fast shutdown, rolling back active work.
			p.command.Process.Signal(os.Interrupt)
			select {
			case <-p.exited:
			case <-time.After(8 * time.Second):
				p.command.Process.Kill()
				<-p.exited
			}
		}
		if p.log != nil {
			p.log.Close()
		}
		if p.release != nil {
			p.release()
		}
	})
}
