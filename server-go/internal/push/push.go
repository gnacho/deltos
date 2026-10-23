// Package push ports server/src/push.ts: Web Push (VAPID) configuration, the
// server-side i18n sending engine, per-user preferences, quiet hours with a
// consolidated queue and dead-subscription cleanup (404/410).
//
// Deltos-specific decisions (same as the Node):
//   - NO fail-fast without VAPID keys: on LAN HTTP push is dormant (secure
//     context); the app boots fine and the UI shows "Requiere HTTPS".
//   - Two databases (prod/demo): notifyUsers receives the DB of the request
//     (never the demo one for real push). In demo the engine only logs.
//   - Timestamps are epoch ms (convention of the rest of the schema).
//
// The subscription endpoint is a capability URL and is NEVER logged.
package push

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"net/http"
	"strconv"
	"strings"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"

	"github.com/gnacho/deltos/server-go/internal/db"
	"github.com/gnacho/deltos/server-go/internal/ids"
	"github.com/gnacho/deltos/server-go/internal/logger"
)

var log = logger.L().Child(map[string]any{"component": "push"})

// Lang is a push payload language (server-side i18n).
type Lang string

const (
	LangES Lang = "es"
	LangEN Lang = "en"
)

// Severity is the push severity (normal | high | critical).
type Severity string

const (
	SeverityNormal   Severity = "normal"
	SeverityHigh     Severity = "high"
	SeverityCritical Severity = "critical"
)

var severities = []Severity{SeverityNormal, SeverityHigh, SeverityCritical}

func severityIdx(s Severity) int {
	for i, v := range severities {
		if v == s {
			return i
		}
	}
	return 0
}

// TiposPush is the set of notification types configurable per user (the toggles
// in Settings). Absence of a row means 'enabled'; a row with enabled=0 disables
// it. Must stay in sync with the catalog below.
var TiposPush = []string{
	"asignacion",
	"comentario",
	"tarea_movida",
	"mencion",
	"vencimiento",
	"pago_requerido",
	"pago_completado",
}

// IsValidTipo reports whether t is a known notification type.
func IsValidTipo(t string) bool {
	for _, x := range TiposPush {
		if x == t {
			return true
		}
	}
	return false
}

// Datos is the template data for a push body (each type uses a subset).
type Datos map[string]any

// Options carries the delivery options the Node passes to notifyUsers.
type Options struct {
	Demo     bool
	Severity Severity
	URL      string
	TTL      int
}

// TaskRef is the minimal task shape notifyInterested needs (assignee + creator).
type TaskRef struct {
	AssigneeID *string
	CreatedBy  *string
}

// NotifyResult are the counters returned by NotifyUsers.
type NotifyResult struct {
	Enviados   int `json:"enviados"`
	Borrados   int `json:"borrados"`
	Fallidos   int `json:"fallidos"`
	Pospuestos int `json:"pospuestos"`
	Omitidos   int `json:"omitidos"`
}

// SendFn is an injectable sender (tests). It returns the HTTP status of the
// push service and any transport error, mirroring web-push's statusCode error.
type SendFn func(sub *webpush.Subscription, payload []byte, opts *webpush.Options) (int, error)

// Service is the push engine. It holds the VAPID configuration and the injectable
// sender; the databases are passed per call (two-DB model: prod + demo).
type Service struct {
	PublicKey  string
	PrivateKey string
	Subject    string
	configured bool
	httpClient webpush.HTTPClient
	sendFn     SendFn
}

// New builds the push engine. Absent VAPID keys leave push dormant (configured
// = false) without failing the boot.
func New(publicKey, privateKey, subject string) *Service {
	s := &Service{
		PublicKey:  publicKey,
		PrivateKey: privateKey,
		Subject:    subject,
		httpClient: http.DefaultClient,
	}
	s.configured = publicKey != "" && privateKey != "" && subject != ""
	if s.configured {
		log.Info("push_enabled")
	} else {
		log.Warn("push_disabled", "reason", "vapid_missing")
	}
	s.sendFn = s.realSend
	return s
}

// realSend is the default sender: webpush.SendNotification with aes128gcm.
func (s *Service) realSend(sub *webpush.Subscription, payload []byte, opts *webpush.Options) (int, error) {
	opts.HTTPClient = s.httpClient
	resp, err := webpush.SendNotification(payload, sub, opts)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	return resp.StatusCode, nil
}

// SetSendFn injects a fake sender (tests); nil restores the real one.
func (s *Service) SetSendFn(fn SendFn) {
	if fn == nil {
		s.sendFn = s.realSend
		return
	}
	s.sendFn = fn
}

// SetHTTPClient overrides the HTTP client used by the real sender (tests that
// capture the actual outgoing push-service request and its VAPID headers).
func (s *Service) SetHTTPClient(c webpush.HTTPClient) { s.httpClient = c }

// Configured reports whether push is active (all three VAPID values present).
func (s *Service) Configured() bool { return s.configured }

// PublicKeyOrEmpty returns the VAPID public key when configured.
func (s *Service) PublicKeyOrEmpty() string {
	if !s.configured {
		return ""
	}
	return s.PublicKey
}

// --- i18n catalog (final text composed server-side; the SW does not translate) ---

var columnas = map[Lang]map[string]string{
	LangES: {"nuevo": "Nuevo", "encurso": "En curso", "hecho": "Hecho"},
	LangEN: {"nuevo": "To do", "encurso": "In progress", "hecho": "Done"},
}

func lookup(m map[string]string, key string) string {
	if key == "" {
		return ""
	}
	if v, ok := m[key]; ok {
		return v
	}
	return key
}

func fmtEur(cents int) string {
	return strings.Replace(fmt.Sprintf("%.2f", float64(cents)/100), ".", ",", 1) + " €"
}

func fmtEurEn(cents int) string {
	return "€" + fmt.Sprintf("%.2f", float64(cents)/100)
}

type entrada struct {
	titulo string
	cuerpo func(Datos) string
}

// strField renders a datum as a string (counts, usernames, titles).
func strField(d Datos, k string) string {
	switch x := d[k].(type) {
	case nil:
		return ""
	case string:
		return x
	case int:
		return strconv.Itoa(x)
	case int64:
		return strconv.FormatInt(x, 10)
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(x)
	default:
		return fmt.Sprint(x)
	}
}

// intField renders a datum as an int (cents, counts).
func intField(d Datos, k string) int {
	switch x := d[k].(type) {
	case int:
		return x
	case int64:
		return int(x)
	case float64:
		return int(x)
	}
	return 0
}

// pluralVencidas matches the Node's `${n} vencida${n>1?'s':''}`.
func vencidasES(n int) string {
	if n > 1 {
		return fmt.Sprintf("%d vencidas", n)
	}
	return fmt.Sprintf("%d vencida", n)
}

var catalogo = map[Lang]map[string]entrada{
	LangES: {
		"tarea_creada": {titulo: "Nueva tarea", cuerpo: func(d Datos) string {
			return strField(d, "usuario") + " creó «" + strField(d, "titulo") + "»"
		}},
		"tarea_movida": {titulo: "Tarea movida", cuerpo: func(d Datos) string {
			return strField(d, "usuario") + " movió «" + strField(d, "titulo") + "» a " + lookup(columnas[LangES], strField(d, "columna"))
		}},
		"comentario": {titulo: "Nuevo comentario", cuerpo: func(d Datos) string {
			return strField(d, "usuario") + " comentó en «" + strField(d, "titulo") + "»"
		}},
		"asignacion": {titulo: "Tarea asignada", cuerpo: func(d Datos) string {
			return strField(d, "usuario") + " te asignó «" + strField(d, "titulo") + "»"
		}},
		"mencion": {titulo: "Te mencionaron", cuerpo: func(d Datos) string {
			return strField(d, "usuario") + " te mencionó en «" + strField(d, "titulo") + "»"
		}},
		"vencimiento": {titulo: "Resumen de tareas", cuerpo: func(d Datos) string {
			var p []string
			if v := intField(d, "vencidas"); v > 0 {
				p = append(p, vencidasES(v))
			}
			if h := intField(d, "hoy"); h > 0 {
				p = append(p, fmt.Sprintf("%d vence hoy", h))
			}
			if pr := intField(d, "pronto"); pr > 0 {
				p = append(p, fmt.Sprintf("%d en breve", pr))
			}
			if len(p) == 0 {
				return "Sin tareas pendientes"
			}
			return strings.Join(p, " · ")
		}},
		"resumen": {titulo: "Actividad en Deltos", cuerpo: func(d Datos) string {
			return fmt.Sprintf("%d cambios mientras estabas en horas de silencio", intField(d, "total"))
		}},
		"pago_requerido": {titulo: "Te piden un pago", cuerpo: func(d Datos) string {
			return strField(d, "usuario") + " te pide tu parte de «" + strField(d, "titulo") + "» (" + fmtEur(intField(d, "importe")) + " en total)"
		}},
		"pago_completado": {titulo: "Pago recibido", cuerpo: func(d Datos) string {
			return strField(d, "usuario") + " ha pagado su parte de «" + strField(d, "titulo") + "»"
		}},
	},
	LangEN: {
		"tarea_creada": {titulo: "New task", cuerpo: func(d Datos) string {
			return strField(d, "usuario") + " created “" + strField(d, "titulo") + "”"
		}},
		"tarea_movida": {titulo: "Task moved", cuerpo: func(d Datos) string {
			return strField(d, "usuario") + " moved “" + strField(d, "titulo") + "” to " + lookup(columnas[LangEN], strField(d, "columna"))
		}},
		"comentario": {titulo: "New comment", cuerpo: func(d Datos) string {
			return strField(d, "usuario") + " commented on “" + strField(d, "titulo") + "”"
		}},
		"asignacion": {titulo: "Task assigned", cuerpo: func(d Datos) string {
			return strField(d, "usuario") + " assigned you “" + strField(d, "titulo") + "”"
		}},
		"mencion": {titulo: "You were mentioned", cuerpo: func(d Datos) string {
			return strField(d, "usuario") + " mentioned you in “" + strField(d, "titulo") + "”"
		}},
		"vencimiento": {titulo: "Task summary", cuerpo: func(d Datos) string {
			var p []string
			if v := intField(d, "vencidas"); v > 0 {
				p = append(p, fmt.Sprintf("%d overdue", v))
			}
			if h := intField(d, "hoy"); h > 0 {
				p = append(p, fmt.Sprintf("%d due today", h))
			}
			if pr := intField(d, "pronto"); pr > 0 {
				p = append(p, fmt.Sprintf("%d soon", pr))
			}
			if len(p) == 0 {
				return "No pending tasks"
			}
			return strings.Join(p, " · ")
		}},
		"resumen": {titulo: "Deltos activity", cuerpo: func(d Datos) string {
			return fmt.Sprintf("%d changes during your quiet hours", intField(d, "total"))
		}},
		"pago_requerido": {titulo: "Payment requested", cuerpo: func(d Datos) string {
			return strField(d, "usuario") + ` asks for your share of "` + strField(d, "titulo") + `" (` + fmtEurEn(intField(d, "importe")) + " total)"
		}},
		"pago_completado": {titulo: "Payment received", cuerpo: func(d Datos) string {
			return strField(d, "usuario") + ` has paid their share of "` + strField(d, "titulo") + `"`
		}},
	},
}

func langFor(d *db.DB, userID string) Lang {
	var language string
	if err := d.QueryRow("SELECT language FROM users WHERE id = ?", userID).Scan(&language); err != nil {
		return LangES
	}
	if language == "en" {
		return LangEN
	}
	// 'auto' and unknown fall back to es (house default).
	return LangES
}

// enQuietHours checks the quiet window in the user's local timezone (can cross
// midnight). The hour is the current hour in that timezone, same as the Node's
// Intl.DateTimeFormat with hour12:false.
func enQuietHours(d *db.DB, userID string) bool {
	var start, end *int64
	var tz string
	err := d.QueryRow("SELECT quiet_start, quiet_end, tz FROM notification_quiet_hours WHERE user_id = ?", userID).
		Scan(&start, &end, &tz)
	if err != nil || start == nil || end == nil {
		return false
	}
	if tz == "" {
		tz = "Europe/Madrid"
	}
	loc, err := time.LoadLocation(tz)
	if err != nil {
		loc = time.Local
	}
	hora := time.Now().In(loc).Hour()
	s, e := int(*start), int(*end)
	if s <= e {
		return hora >= s && hora < e
	}
	return hora >= s || hora < e // cruza medianoche
}

// composePayload builds the JSON sent to the push service (flat fields for the
// SW push handler + the Declarative Web Push block for Safari/iOS 18.4+).
func composePayload(lang Lang, tipo string, datos Datos, url string) []byte {
	cat, ok := catalogo[lang]
	if !ok {
		cat = catalogo[LangES]
	}
	e, ok := cat[tipo]
	if !ok {
		e = cat["resumen"]
	}
	title := e.titulo
	body := e.cuerpo(datos)
	payload, _ := json.Marshal(map[string]any{
		"title": title,
		"body":  body,
		"url":   url,
		"tag":   tipo,
		// Declarative Web Push (Safari/iOS 18.4+, no SW execution).
		"web_push": 8030,
		"notification": map[string]any{
			"title":    title,
			"body":     body,
			"navigate": url,
		},
	})
	return payload
}

type subRow struct {
	ID       string
	Endpoint string
	P256dh   string
	Auth     string
}

// subsFor loads the subscriptions of a user.
func subsFor(d *db.DB, userID string) ([]subRow, error) {
	rows, err := d.Query("SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?", userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []subRow
	for rows.Next() {
		var s subRow
		if err := rows.Scan(&s.ID, &s.Endpoint, &s.P256dh, &s.Auth); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// NotifyUsers notifies users by push (app CLOSED; with the app open they learn
// via SSE). Respects preferences and quiet hours; in demo it only registers.
// d is the database of the request (prod or demo). Returns counters.
func (s *Service) NotifyUsers(d *db.DB, userIDs []string, tipo string, datos Datos, opts Options) NotifyResult {
	severity := opts.Severity
	if severity == "" {
		severity = SeverityNormal
	}
	url := opts.URL
	if url == "" {
		url = "/"
	}
	ttl := opts.TTL
	if ttl == 0 {
		if severity == SeverityCritical {
			ttl = 3600
		} else {
			ttl = 21600
		}
	}
	res := NotifyResult{}
	seen := map[string]struct{}{}

	for _, userID := range userIDs {
		if userID == "" {
			continue
		}
		if _, dup := seen[userID]; dup {
			continue
		}
		seen[userID] = struct{}{}

		// preference: absence = enabled; enabled=0 or below min_severity = skip
		var enabled int
		var minSeverity string
		err := d.QueryRow("SELECT enabled, min_severity FROM notification_preferences WHERE user_id = ? AND tipo = ?", userID, tipo).
			Scan(&enabled, &minSeverity)
		if err == nil {
			if enabled == 0 || severityIdx(severity) < severityIdx(Severity(minSeverity)) {
				res.Omitidos++
				continue
			}
		}

		// quiet hours: non-critical enqueues for the hourly consolidation
		if severity != SeverityCritical && enQuietHours(d, userID) {
			dj, _ := json.Marshal(datos)
			_, _ = d.Exec(
				"INSERT INTO notification_queue (id, user_id, tipo, severity, datos_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
				ids.New(), userID, tipo, string(severity), string(dj), time.Now().UnixMilli())
			res.Pospuestos++
			continue
		}

		lang := langFor(d, userID)
		payload := composePayload(lang, tipo, datos, url)

		if opts.Demo {
			log.Debug("push_demo_skipped", "user_id_hash", userID, "tipo", tipo)
			res.Omitidos++
			continue
		}
		if !s.configured {
			res.Omitidos++
			continue
		}
		subs, err := subsFor(d, userID)
		if err != nil {
			res.Fallidos++
			continue
		}
		if len(subs) == 0 {
			res.Omitidos++
			continue
		}

		urgency := webpush.UrgencyLow
		switch severity {
		case SeverityCritical:
			urgency = webpush.UrgencyHigh
		case SeverityHigh:
			urgency = webpush.UrgencyNormal
		}

		for _, sub := range subs {
			switch s.enviarAUna(d, sub, payload, ttl, urgency, tipo) {
			case "ok":
				res.Enviados++
			case "borrada":
				res.Borrados++
			default:
				res.Fallidos++
			}
		}
	}
	return res
}

// enviarAUna sends to one subscription: 404/410 = dead (delete); 429/5xx =
// retry with backoff + jitter (max 3); other status = our bug (log, no endpoint).
func (s *Service) enviarAUna(d *db.DB, sub subRow, payload []byte, ttl int, urgency webpush.Urgency, topic string) string {
	dest := &webpush.Subscription{
		Endpoint: sub.Endpoint,
		Keys:     webpush.Keys{P256dh: sub.P256dh, Auth: sub.Auth},
	}
	for intento := 1; intento <= 3; intento++ {
		opts := &webpush.Options{
			Subscriber:      s.Subject,
			VAPIDPublicKey:  s.PublicKey,
			VAPIDPrivateKey: s.PrivateKey,
			TTL:             ttl,
			Urgency:         urgency,
			Topic:           topic,
		}
		status, err := s.sendFn(dest, payload, opts)
		if err == nil && status >= 200 && status < 300 {
			return "ok"
		}
		if status == 404 || status == 410 {
			_, _ = d.Exec("DELETE FROM push_subscriptions WHERE endpoint = ?", sub.Endpoint)
			return "borrada"
		}
		if status == 429 || status >= 500 {
			if intento < 3 {
				wait := time.Duration(500*(1<<intento)+rand.Intn(250)) * time.Millisecond
				time.Sleep(wait)
				continue
			}
			return "fallido"
		}
		// Never log the endpoint (secret capability URL) nor the keys.
		log.Error("push_send_failed", "status", status, "sub_id", sub.ID, "error", err)
		return "fallido"
	}
	return "fallido"
}

// NotifyAllExcept notifies every user except the actor, fire-and-forget (never
// blocks the HTTP response). Dormant when push is not configured.
func (s *Service) NotifyAllExcept(d *db.DB, demo bool, actorID, tipo string, datos Datos, opts Options) {
	if !s.configured {
		return
	}
	rows, err := d.Query("SELECT id FROM users WHERE id != ?", actorID)
	if err != nil {
		return
	}
	var ids []string
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	rows.Close()
	if len(ids) == 0 {
		return
	}
	opts.Demo = demo
	go func() {
		s.NotifyUsers(d, ids, tipo, datos, opts)
	}()
}

// NotifyInterested notifies the interested parties of a task (assignee + creator)
// except the actor. Replaces NotifyAllExcept for comment/move: less noise.
func (s *Service) NotifyInterested(d *db.DB, demo bool, task TaskRef, actorID, tipo string, datos Datos, opts Options) {
	if !s.configured {
		return
	}
	var ids []string
	seen := map[string]struct{}{}
	for _, id := range []*string{task.AssigneeID, task.CreatedBy} {
		if id == nil || *id == "" || *id == actorID {
			continue
		}
		if _, dup := seen[*id]; dup {
			continue
		}
		seen[*id] = struct{}{}
		ids = append(ids, *id)
	}
	if len(ids) == 0 {
		return
	}
	opts.Demo = demo
	go func() {
		s.NotifyUsers(d, ids, tipo, datos, opts)
	}()
}

type queueGroup struct {
	UserID   string
	Tipo     string
	Severity string
	Total    int
}

// FlushNotificationQueue consolidates the quiet-hours queue into ONE summary per
// user+tipo and empties the queue. Called from the hourly maintenance interval.
func (s *Service) FlushNotificationQueue(d *db.DB, demo bool) {
	rows, err := d.Query(
		`SELECT user_id, tipo, severity, COUNT(*) AS total
		 FROM notification_queue GROUP BY user_id, tipo, severity`)
	if err != nil {
		return
	}
	var groups []queueGroup
	for rows.Next() {
		var g queueGroup
		if err := rows.Scan(&g.UserID, &g.Tipo, &g.Severity, &g.Total); err != nil {
			rows.Close()
			return
		}
		groups = append(groups, g)
	}
	rows.Close()

	for _, g := range groups {
		// Still inside the window: stays in the queue for the next tick.
		if enQuietHours(d, g.UserID) {
			continue
		}
		s.NotifyUsers(d, []string{g.UserID}, "resumen", Datos{"total": g.Total}, Options{Demo: demo, Severity: Severity(g.Severity)})
		_, _ = d.Exec("DELETE FROM notification_queue WHERE user_id = ? AND tipo = ?", g.UserID, g.Tipo)
	}
}
