# Operating Deltos logs

How Deltos emits logs and how they are operated on the host (user log-ops
skill). Summary: **JSON NDJSON to stdout → journald rotates, nobody else rotates.**

## What Deltos emits

Own dependency-free logger (`server/src/logger.js`): NDJSON to stdout,
levels `debug`/`info`/`warn`/`error`, minimum via `LOG_LEVEL` (default `info`).
Static messages (event name in `msg`, snake_case) + key-value attributes —
never interpolated strings with variable data in `msg`.

- **Wide events** (`server/src/wide-event.js`): exactly **1 JSON event per
  API request** (`msg: "http_request"`), emitted at the end with `request_id`
  (also in the `x-request-id` response header), `method`, `route` (Hono
  template `/api/tasks/:id`, not the raw path → no query or PII), `status`,
  `duration_ms`, `user_id_hash` and `error.{code,message}` if there was an
  exception. `error` level if status ≥ 500 or an exception; `info` otherwise.
- **Excluded from the wide event** (anti-noise, 80-95 % of the volume):
  `GET /health`, `GET /api/events` (SSE: long-lived connection) and GET/HEAD
  of static/SPA that respond < 400.
- Business/startup events: `server_listening`, `bootstrap_admin_created`,
  `demo_seeded`, `schema_migrated`, `sessions_expired_purged`,
  `push_send_failed`, `unhandled_error`… always with attributes, never with PII.

## PII policy (structured redaction by key, not regex over the message)

`redact()` walks the attributes and censors to `[REDACTED]` any key from the
canonical list (case-insensitive): `password`, `passwd`, `pwd`, `secret`,
`token`, `access_token`, `refresh_token`, `id_token`, `api_key`, `apikey`,
`authorization`, `auth`, `cookie`, `set-cookie`, `session`, `session_id`,
`email`, `credentials`, `private_key`, `client_secret` — plus any key that
**contains** `token`, `secret` or `password`.

Never in logs: passwords (not even hashed), tokens, `Authorization`, cookies,
full emails, request/response bodies, push endpoints (secret capability
URLs). IPs: at most truncated /24. `user_id` is always `user_id_hash` =
`u_` + truncated SHA-256 (12 hex), stable for correlation.
Stack traces: only with `LOG_LEVEL=debug` (which never touches disk in
production, see `MaxLevelStore` below).

Policy test (covered in `server/tests/api-conventions.test.js`): a trap object
with `password`/`authorization`/`email` → everything comes out `[REDACTED]`;
the same test is the deployment smoke test.

## Rotation and retention: journald, nobody else

No own `*.log` files, no in-app rotation (no lumberjack/pino-roll). journald
already rotates by size and time, compresses and seals.

### Global journald drop-in on the host

`/etc/systemd/journald.conf.d/50-homelab.conf` (homelab reference values):

```ini
[Journal]
Storage=persistent
Compress=yes
Seal=yes
SystemMaxUse=1G
SystemKeepFree=1G
SystemMaxFileSize=100M
SystemMaxFiles=20
MaxFileSec=1week
MaxRetentionSec=1month
# PRODUCTION: debug never touches disk
MaxLevelStore=info
RateLimitIntervalSec=30s
RateLimitBurst=5000
ForwardToSyslog=no
```

NOTE Debian/Ubuntu: `Storage=persistent` (or `auto`) **only persists if
`/var/log/journal` exists**:

```bash
mkdir -p /var/log/journal
systemctl restart systemd-journald   # or: journalctl --flush
```

Verification:

```bash
systemd-analyze cat-config systemd/journald.conf   # effective merged config
journalctl --disk-usage
journalctl --header | grep -i persistent
```

### Deltos unit drop-in

`deploy/journald-deltos.conf` → `/etc/systemd/system/deltos.service.d/10-logging.conf`:
`Environment=LOG_LEVEL=info`, per-unit `LogRateLimitIntervalSec/Burst` and
commented `LogFilterPatterns=~` examples (safety net; the noise is already cut
at the source). `debug` only with a temporary override (`systemctl edit deltos`),
never permanent.

## Useful `journalctl` queries

```bash
journalctl -u deltos -f -o cat                          # follow the raw NDJSON
journalctl -u deltos --since today -o cat | jq -r .msg | sort | uniq -c | sort -rn   # volume per event
journalctl -u deltos -g '"level":"error"' --since -1h   # errors only
journalctl -u deltos -g '"status":5' --since today      # 5xx (wide events)
journalctl -u deltos -g '"request_id":"<id>"'           # correlate by request (x-request-id)
journalctl -u deltos -g '"user_id_hash":"u_…"'          # activity of one user (hash, not id)
journalctl -u deltos --since today -g '"status":200' | wc -l   # measure residual noise
```

## Files outside journald: logrotate (Nginx Proxy Manager only)

NPM access/error logs are third-party files → classic logrotate
(`/etc/logrotate.d/npm`), never the app:

```
/data/npm/logs/*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    copytruncate   # NPM does not reopen fds on signal; copytruncate and done
}
```

Even better: `access_log off` on the NPM healthcheck location so the noise is
never generated (decision 5 of log-ops).

## Collector/viewer

One host and terminal: **journalctl is enough**. If someday there are multiple
hosts or a web UI is wanted: VictoriaLogs + Fluent Bit (~30-60 MB/host). Never
Promtail (EOL March 2026).
