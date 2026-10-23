// Package digest ports server/src/digest.ts: the daily due reminder. It groups
// each assignee's non-done tasks into overdue / due-today / due-soon buckets
// and delivers one 'vencimiento' digest per user per day (idempotent via a kv
// key). Delivery goes through an injectable Delivery hook: Web Push is phase 6,
// so cmd/server wires a no-op logger until then.
package digest

import (
	"fmt"
	"time"

	"github.com/gnacho/deltos/server-go/internal/db"
	"github.com/gnacho/deltos/server-go/internal/logger"
)

var log = logger.L().Child(map[string]any{"component": "digest"})

// ProntoDias is the "soon" window in days (excluding today). 2 = tomorrow and
// the day after.
const ProntoDias = 2

// HoraDigest is the local hour (09:00) at which the daily digest fires.
const HoraDigest = 9

// Counts is the per-user aggregate the digest delivers.
type Counts struct {
	Vencidas int `json:"vencidas"` // overdue (due_date < today)
	Hoy      int `json:"hoy"`      // due today
	Pronto   int `json:"pronto"`   // due tomorrow..today+ProntoDias
	Total    int `json:"total"`
}

// Options carries the delivery options the Node passes to notifyUsers.
type Options struct {
	Demo     bool
	Severity string // "high" when there is at least one overdue task, else "normal"
	URL      string
}

// Delivery is the injectable push hook. Phase 6 replaces the no-op with the
// Web Push sender (server/src/push.ts notifyUsers).
type Delivery interface {
	Send(userID string, counts Counts, opts Options) error
}

// DeliveryFunc adapts a plain function to the Delivery interface.
type DeliveryFunc func(userID string, counts Counts, opts Options) error

// Send implements Delivery.
func (f DeliveryFunc) Send(userID string, counts Counts, opts Options) error {
	return f(userID, counts, opts)
}

func todayLocal() string {
	loc, err := time.LoadLocation("Europe/Madrid")
	if err != nil {
		loc = time.UTC
	}
	now := time.Now().In(loc)
	return fmt.Sprintf("%04d-%02d-%02d", now.Year(), int(now.Month()), now.Day())
}

func addDaysISO(s string, n int) string {
	t, _ := time.Parse("2006-01-02", s)
	return t.AddDate(0, 0, n).Format("2006-01-02")
}

func kvExists(d *db.DB, key string) bool {
	var one int
	return d.QueryRow("SELECT 1 FROM kv WHERE key = ?", key).Scan(&one) == nil
}

// EnviarDigestVencimiento runs one digest pass. `today` is the reference date
// 'YYYY-MM-DD' (injectable for tests); ScheduleDigestVencimiento passes the
// current local date. It delivers once per user per day.
func EnviarDigestVencimiento(d *db.DB, deliver Delivery, demo bool, today string) error {
	prontoLimite := addDaysISO(today, ProntoDias)
	rows, err := d.Query(
		`SELECT assignee_id AS user_id,
			SUM(CASE WHEN due_date < ? THEN 1 ELSE 0 END) AS vencidas,
			SUM(CASE WHEN due_date = ? THEN 1 ELSE 0 END) AS hoy,
			SUM(CASE WHEN due_date > ? AND due_date <= ? THEN 1 ELSE 0 END) AS pronto
		 FROM tasks
		 WHERE deleted_at IS NULL AND "column" != 'hecho'
		   AND due_date IS NOT NULL AND assignee_id IS NOT NULL
		 GROUP BY assignee_id`,
		today, today, today, prontoLimite)
	if err != nil {
		return err
	}
	// Drain and close the rows before the per-user kv lookups: db.DB pins a
	// single connection (SetMaxOpenConns(1)), so a second query while these
	// rows are open would deadlock.
	type agg struct {
		userID                string
		vencidas, hoy, pronto int64
	}
	var aggs []agg
	for rows.Next() {
		var a agg
		if err := rows.Scan(&a.userID, &a.vencidas, &a.hoy, &a.pronto); err != nil {
			rows.Close()
			return err
		}
		aggs = append(aggs, a)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	for _, a := range aggs {
		total := a.vencidas + a.hoy + a.pronto
		if total == 0 {
			continue
		}
		key := "vencimiento_" + a.userID + "_" + today
		if kvExists(d, key) {
			continue // ya enviado hoy
		}
		if err := d.KVSet(key, "1"); err != nil {
			return err
		}
		severity := "normal"
		if a.vencidas > 0 {
			severity = "high"
		}
		counts := Counts{Vencidas: int(a.vencidas), Hoy: int(a.hoy), Pronto: int(a.pronto), Total: int(total)}
		if err := deliver.Send(a.userID, counts, Options{Demo: demo, Severity: severity, URL: "/"}); err != nil {
			log.Error("digest_send_failed", "error", err.Error())
		}
	}
	return nil
}

// nextDigestDelay returns the delay until the next 09:00 Europe/Madrid (at
// least one minute, matching the Node's Math.max(delay, 60_000)).
func nextDigestDelay(now time.Time) time.Duration {
	loc, err := time.LoadLocation("Europe/Madrid")
	if err != nil {
		loc = time.UTC
	}
	local := now.In(loc)
	next := time.Date(local.Year(), local.Month(), local.Day(), HoraDigest, 0, 0, 0, loc)
	if !next.After(local) {
		next = next.AddDate(0, 0, 1)
	}
	delay := next.Sub(local)
	if delay < time.Minute {
		delay = time.Minute
	}
	return delay
}

// ScheduleDigestVencimiento starts the daily timer: fires once a day at 09:00
// local and re-arms after each run, exactly like scheduleDigestVencimiento in
// the Node server (which runs this in-process, not via systemd timers).
func ScheduleDigestVencimiento(d *db.DB, deliver Delivery, demo bool) {
	go func() {
		for {
			timer := time.NewTimer(nextDigestDelay(time.Now()))
			<-timer.C
			if err := EnviarDigestVencimiento(d, deliver, demo, todayLocal()); err != nil {
				log.Error("digest_vencimiento_error", "error", err.Error())
			} else {
				log.Info("digest_vencimiento_enviado")
			}
		}
	}()
}
