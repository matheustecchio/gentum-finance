# PostgreSQL runtime attribution

The desktop build compiles PostgreSQL 17.11 from the official source archive:

- Source: https://ftp.postgresql.org/pub/source/v17.11/postgresql-17.11.tar.bz2
- SHA256: `dd27f2b3c59e73ed14aa3324901242bf69a032a6347805f274e6260322d42979`
- Checksum source: https://ftp.postgresql.org/pub/source/v17.11/postgresql-17.11.tar.bz2.sha256
- Copyright source: https://github.com/postgres/postgres/blob/REL_17_11/COPYRIGHT

`PostgreSQL-COPYRIGHT` contains the upstream license. The installed runtime also includes its source `COPYRIGHT` and build provenance in `postgres/gentum-build.json`.

The build disables OpenSSL, ICU, libxml2, libxslt, zlib, lz4, zstd, readline, Perl, Python and Tcl. Those libraries are not included in the PostgreSQL runtime. PostgreSQL connects over authenticated private loopback connections without TLS. Operating system libraries are supplied by the user's distribution, not copied into this package.
