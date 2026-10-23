#!/usr/bin/env python3
"""Build and cache the minimal official PostgreSQL runtime and Go desktop service."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
VERSION = "17.11"
SHA256 = "dd27f2b3c59e73ed14aa3324901242bf69a032a6347805f274e6260322d42979"
URL = f"https://ftp.postgresql.org/pub/source/v{VERSION}/postgresql-{VERSION}.tar.bz2"
TARGET = "x86_64-unknown-linux-gnu"
FLAGS = ["--without-readline", "--without-zlib", "--without-icu", "--without-openssl",
         "--without-libxml", "--without-libxslt", "--without-lz4", "--without-zstd",
         "--without-perl", "--without-python", "--without-tcl", "--disable-nls"]


def run_build(command, cwd, log):
    with log.open("ab") as output:
        result = subprocess.run(command, cwd=cwd, stdout=output, stderr=subprocess.STDOUT)
    if result.returncode:
        tail = "\n".join(log.read_text(errors="replace").splitlines()[-35:])
        raise SystemExit(f"PostgreSQL build failed. See {log}\n{tail}")


def prepare_postgres(local_archive):
    cache = ROOT / "desktop/.cache"
    cache.mkdir(parents=True, exist_ok=True)
    archive = local_archive or cache / f"postgresql-{VERSION}.tar.bz2"
    if not archive.exists():
        print(f"Downloading official PostgreSQL {VERSION} source", flush=True)
        temporary = archive.with_suffix(".download")
        with urllib.request.urlopen(URL, timeout=120) as response, temporary.open("wb") as output:
            shutil.copyfileobj(response, output)
        temporary.replace(archive)
    if hashlib.sha256(archive.read_bytes()).hexdigest() != SHA256:
        raise SystemExit("PostgreSQL source hash mismatch; refusing to build")
    cc = os.environ.get("CC", "cc")
    compiler = subprocess.check_output([cc, "--version"], text=True).splitlines()[0]
    descriptor = {"postgresVersion": VERSION, "postgresSourceSha256": SHA256,
                  "postgresSource": URL, "target": TARGET, "configureFlags": FLAGS,
                  "compiler": compiler, "buildFlags": {key: os.environ.get(key, "") for key in ("CFLAGS", "CPPFLAGS", "LDFLAGS")}}
    key = hashlib.sha256(json.dumps(descriptor, sort_keys=True).encode()).hexdigest()[:16]
    installation = cache / f"postgres-{VERSION}-{key}"
    manifest_file = installation / "gentum-build.json"
    valid = manifest_file.exists() and json.loads(manifest_file.read_text()) == descriptor
    valid = valid and all((installation / "bin" / name).is_file() for name in ("postgres", "initdb", "pg_ctl"))
    if not valid:
        log = cache / f"postgres-{VERSION}-{key}.log"
        log.write_text("")
        print(f"Building minimal PostgreSQL {VERSION} from verified source (log: {log})", flush=True)
        with tempfile.TemporaryDirectory(prefix="gentum-postgres-build-") as temporary:
            temporary = Path(temporary)
            with tarfile.open(archive, "r:bz2") as tar:
                tar.extractall(temporary, filter="data")
            source = temporary / f"postgresql-{VERSION}"
            prefix = temporary / "install"
            run_build([str(source / "configure"), f"--prefix={prefix}", *FLAGS], source, log)
            run_build(["make", f"-j{min(os.cpu_count() or 2, 4)}"], source, log)
            run_build(["make", "install"], source, log)
            shutil.copyfile(source / "COPYRIGHT", prefix / "COPYRIGHT")
            (prefix / "gentum-build.json").write_text(json.dumps(descriptor, indent=2) + "\n")
            if installation.exists():
                shutil.rmtree(installation)
            shutil.copytree(prefix, installation, symlinks=True)
    destination = ROOT / "desktop/resources/postgres"
    if destination.exists():
        shutil.rmtree(destination)
    shutil.copytree(installation, destination, symlinks=True)
    # PostgreSQL installs absolute build-prefix RUNPATHs. Relocate every copied
    # executable/library so the package runs without developer environment paths.
    patchelf = os.environ.get("PATCHELF", "patchelf")
    for path in destination.rglob("*"):
        if not path.is_file() or path.is_symlink():
            continue
        with path.open("rb") as binary:
            if binary.read(4) != b"\x7fELF":
                continue
        relative = os.path.relpath(destination / "lib", path.parent)
        rpath = "$ORIGIN" if relative == "." else f"$ORIGIN/{relative}"
        subprocess.run([patchelf, "--set-rpath", rpath, str(path)], check=True)
    descriptor["runtimeRelocation"] = "origin-relative-v1"
    (destination / "gentum-build.json").write_text(json.dumps(descriptor, indent=2) + "\n")
    print(f"Prepared cached minimal PostgreSQL {VERSION}", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--postgres-archive", type=Path,
                        default=Path(os.environ["GENTUM_POSTGRES_SOURCE_ARCHIVE"]) if os.environ.get("GENTUM_POSTGRES_SOURCE_ARCHIVE") else None,
                        help="Use a local official PostgreSQL source tar.bz2 (hash is always verified)")
    args = parser.parse_args()
    if platform.system() != "Linux" or platform.machine() not in ("x86_64", "AMD64"):
        raise SystemExit("Desktop packaging currently supports Linux x86_64 only. Other platforms need native build and validation.")
    prepare_postgres(args.postgres_archive)
    binary = ROOT / f"desktop/binaries/gentum-backend-{TARGET}"
    binary.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([os.environ.get("GO", "go"), "build", "-trimpath", "-buildvcs=false", "-o", str(binary), "./cmd/desktop"], cwd=ROOT / "backend", check=True)
    print(f"Prepared {binary.name}", flush=True)


if __name__ == "__main__":
    main()
