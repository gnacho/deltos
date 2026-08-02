# Operación de logs de Deltos

Cómo emite Deltos y cómo se operan sus logs en el host (skill log-ops del
usuario). Resumen: **JSON NDJSON a stdout → journald rota, nadie más rota.**

## Qué emite Deltos

Logger propio sin dependencias (`server/src/logger.js`): NDJSON a stdout,
niveles `debug`/`info`/`warn`/`error`, mínimo por `LOG_LEVEL` (default `info`).
Mensajes estáticos (nombre del evento en `msg`, snake_case) + atributos
clave-valor — nunca strings interpolados con datos variables en `msg`.

- **Wide events** (`server/src/wide-event.js`): exactamente **1 evento JSON por
  request API** (`msg: "http_request"`), emitido al final con `request_id`
  (también en la cabecera `x-request-id` de la respuesta), `method`, `route`
  (plantilla Hono `/api/tasks/:id`, no la path cruda → sin query ni PII),
  `status`, `duration_ms`, `user_id_hash` y `error.{code,message}` si hubo
  excepción. Nivel `error` si status ≥ 500 o excepción; `info` en el resto.
- **Excluidos del wide event** (anti-ruido, son el 80-95 % del volumen):
  `GET /health`, `GET /api/events` (SSE: conexión larga) y GET/HEAD de
  estáticos/SPA que responden < 400.
- Eventos de negocio/arranque: `server_listening`, `bootstrap_admin_created`,
  `demo_seeded`, `schema_migrated`, `sessions_expired_purged`,
  `push_send_failed`, `unhandled_error`… siempre con atributos, nunca con PII.

## Política PII (redacción estructurada por clave, no regex sobre el mensaje)

`redact()` recorre los atributos y censura a `[REDACTADO]` cualquier clave de
la lista canónica (case-insensitive): `password`, `passwd`, `pwd`, `secret`,
`token`, `access_token`, `refresh_token`, `id_token`, `api_key`, `apikey`,
`authorization`, `auth`, `cookie`, `set-cookie`, `session`, `session_id`,
`email`, `credentials`, `private_key`, `client_secret` — más cualquier clave
que **contenga** `token`, `secret` o `password`.

Nunca en logs: passwords (ni hasheados), tokens, `Authorization`, cookies,
emails completos, bodies de request/response, endpoints de push (capability
URLs secretas). IPs: como mucho truncadas /24. `user_id` siempre como
`user_id_hash` = `u_` + SHA-256 truncado (12 hex), estable para correlacionar.
Stack traces: solo con `LOG_LEVEL=debug` (que no toca disco en producción, ver
`MaxLevelStore` abajo).

Test de la política (cubierto en `server/tests/api-conventions.test.js`):
objeto trampa con `password`/`authorization`/`email` → todo sale
`[REDACTADO]`; el mismo test es el smoke de despliegue.

## Rotación y retención: journald, nadie más

Sin ficheros `*.log` propios, sin rotación in-app (nada de lumberjack/
pino-roll). journald ya rota por tamaño y por tiempo, comprime y sella.

### Drop-in global de journald del host

`/etc/systemd/journald.conf.d/50-homelab.conf` (valores de referencia homelab):

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
# PRODUCCIÓN: el debug nunca toca disco
MaxLevelStore=info
RateLimitIntervalSec=30s
RateLimitBurst=5000
ForwardToSyslog=no
```

OJO Debian/Ubuntu: `Storage=persistent` (o `auto`) **solo persiste si existe
`/var/log/journal`**:

```bash
mkdir -p /var/log/journal
systemctl restart systemd-journald   # o: journalctl --flush
```

Verificación:

```bash
systemd-analyze cat-config systemd/journald.conf   # config efectiva fusionada
journalctl --disk-usage
journalctl --header | grep -i persistent
```

### Drop-in de la unidad Deltos

`deploy/journald-deltos.conf` → `/etc/systemd/system/deltos.service.d/10-logging.conf`:
`Environment=LOG_LEVEL=info`, `LogRateLimitIntervalSec/Burst` por unidad y
ejemplos de `LogFilterPatterns=~` comentados (red de seguridad; el ruido ya se
corta en origen). `debug` solo con override temporal (`systemctl edit deltos`),
nunca permanente.

## Consultas `journalctl` útiles

```bash
journalctl -u deltos -f -o cat                          # seguir el NDJSON crudo
journalctl -u deltos --since today -o cat | jq -r .msg | sort | uniq -c | sort -rn   # volumen por evento
journalctl -u deltos -g '"level":"error"' --since -1h   # solo errores
journalctl -u deltos -g '"status":5' --since today      # 5xx (wide events)
journalctl -u deltos -g '"request_id":"<id>"'           # correlacionar por request (x-request-id)
journalctl -u deltos -g '"user_id_hash":"u_…"'          # actividad de un usuario (hash, no id)
journalctl -u deltos --since today -g '"status":200' | wc -l   # medir ruido residual
```

## Ficheros ajenos a journald: logrotate (solo Nginx Proxy Manager)

Los access/error logs de NPM son ficheros ajenos → logrotate clásico
(`/etc/logrotate.d/npm`), nunca la app:

```
/data/npm/logs/*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    copytruncate   # NPM no reabre fds por señal; copytruncate y listo
}
```

Mejor todavía: `access_log off` en la location del healthcheck de NPM para que
el ruido ni se genere (decisión 5 de log-ops).

## Colector/visor

Un host y terminal: **journalctl basta**. Si algún día hay multi-host o se
quiere UI web: VictoriaLogs + Fluent Bit (~30-60 MB/host). Nunca Promtail
(EOL marzo 2026).
