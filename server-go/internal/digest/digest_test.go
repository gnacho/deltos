package digest

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/gnacho/deltos/server-go/internal/db"
)

func testDigestDB(t *testing.T) *db.DB {
	t.Helper()
	d, err := db.Open(filepath.Join(t.TempDir(), "digest.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	if _, err := d.Exec(`INSERT INTO projects (id, name, position, created_at) VALUES ('p1','p',0,0)`); err != nil {
		t.Fatal(err)
	}
	for _, u := range []string{"u1", "u2"} {
		if _, err := d.Exec(`INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?,?, 'x','user',0)`, u, u); err != nil {
			t.Fatal(err)
		}
	}
	return d
}

func insertTask(t *testing.T, d *db.DB, id, assignee, due, column string, deleted bool) {
	t.Helper()
	deletedAt := "NULL"
	if deleted {
		deletedAt = "1"
	}
	q := `INSERT INTO tasks (id, project_id, title, "column", position, due_date, assignee_id, created_at, updated_at, deleted_at)
	      VALUES (?, 'p1', 'T', ?, 0, ?, ?, 0, 0, ` + deletedAt + `)`
	if _, err := d.Exec(q, id, column, due, assignee); err != nil {
		t.Fatal(err)
	}
}

// recordDelivery collects calls for assertions.
type recordDelivery struct {
	calls []deliveryCall
}

type deliveryCall struct {
	userID string
	counts Counts
	opts   Options
}

func (r *recordDelivery) Send(userID string, counts Counts, opts Options) error {
	r.calls = append(r.calls, deliveryCall{userID, counts, opts})
	return nil
}

func TestEnviarDigestVencimientoBuckets(t *testing.T) {
	d := testDigestDB(t)
	const today = "2026-08-22"

	// u1: 1 overdue, 2 due today, 2 soon (23, 24), 1 beyond window, 1 done, 1 no assignee, 1 deleted
	insertTask(t, d, "a", "u1", "2026-08-21", "nuevo", false)   // overdue
	insertTask(t, d, "b", "u1", "2026-08-22", "encurso", false) // hoy
	insertTask(t, d, "c", "u1", "2026-08-22", "nuevo", false)   // hoy
	insertTask(t, d, "d", "u1", "2026-08-23", "nuevo", false)   // pronto
	insertTask(t, d, "e", "u1", "2026-08-24", "nuevo", false)   // pronto
	insertTask(t, d, "f", "u1", "2026-08-25", "nuevo", false)   // beyond window (excluded)
	insertTask(t, d, "g", "u1", "2026-08-21", "hecho", false)   // done (excluded)
	insertTask(t, d, "h", "u1", "2026-08-21", "nuevo", true)    // deleted (excluded)
	// u2: 1 due today
	insertTask(t, d, "j", "u2", "2026-08-22", "nuevo", false)

	rec := &recordDelivery{}
	if err := EnviarDigestVencimiento(d, rec, false, today); err != nil {
		t.Fatal(err)
	}

	got := map[string]deliveryCall{}
	for _, c := range rec.calls {
		got[c.userID] = c
	}
	if len(got) != 2 {
		t.Fatalf("deliveries = %d, want 2 (%+v)", len(got), got)
	}

	u1 := got["u1"]
	if u1.counts != (Counts{Vencidas: 1, Hoy: 2, Pronto: 2, Total: 5}) {
		t.Fatalf("u1 counts = %+v, want {1 2 2 5}", u1.counts)
	}
	if u1.opts.Severity != "high" || u1.opts.URL != "/" {
		t.Fatalf("u1 opts = %+v", u1.opts)
	}

	u2 := got["u2"]
	if u2.counts != (Counts{Vencidas: 0, Hoy: 1, Pronto: 0, Total: 1}) {
		t.Fatalf("u2 counts = %+v, want {0 1 0 1}", u2.counts)
	}
	if u2.opts.Severity != "normal" {
		t.Fatalf("u2 severity = %q, want normal", u2.opts.Severity)
	}

	// Idempotence: a second pass on the same day must not deliver again.
	rec2 := &recordDelivery{}
	if err := EnviarDigestVencimiento(d, rec2, false, today); err != nil {
		t.Fatal(err)
	}
	if len(rec2.calls) != 0 {
		t.Fatalf("second pass delivered %d times, want 0", len(rec2.calls))
	}
}

func TestEnviarDigestVencimientoNoTasks(t *testing.T) {
	d := testDigestDB(t)
	rec := &recordDelivery{}
	if err := EnviarDigestVencimiento(d, rec, false, "2026-08-22"); err != nil {
		t.Fatal(err)
	}
	if len(rec.calls) != 0 {
		t.Fatalf("deliveries = %d, want 0", len(rec.calls))
	}
}

func TestNextDigestDelay(t *testing.T) {
	loc, err := time.LoadLocation("Europe/Madrid")
	if err != nil {
		t.Skip("no tz data")
	}
	// Before 09:00 -> later today at 09:00.
	at := time.Date(2026, 8, 22, 8, 0, 0, 0, loc)
	if got := nextDigestDelay(at); got != time.Hour {
		t.Fatalf("08:00 delay = %v, want 1h", got)
	}
	// Exactly 09:00 -> tomorrow (strictly after), not 0.
	at = time.Date(2026, 8, 22, 9, 0, 0, 0, loc)
	if got := nextDigestDelay(at); got != 24*time.Hour {
		t.Fatalf("09:00 delay = %v, want 24h", got)
	}
	// After 09:00 -> tomorrow.
	at = time.Date(2026, 8, 22, 10, 0, 0, 0, loc)
	if got := nextDigestDelay(at); got != 23*time.Hour {
		t.Fatalf("10:00 delay = %v, want 23h", got)
	}
	// Just before midnight -> at most a few minutes (never zero), min clamp 1m.
	at = time.Date(2026, 8, 22, 8, 59, 30, 0, loc)
	if got := nextDigestDelay(at); got != 30*time.Second {
		// 30s < 1m -> clamped to 1m
		if got != time.Minute {
			t.Fatalf("08:59:30 delay = %v, want 1m", got)
		}
	}
}

func TestDeliveryFuncAdapter(t *testing.T) {
	var calls []string
	var f DeliveryFunc = func(userID string, counts Counts, opts Options) error {
		calls = append(calls, userID)
		return nil
	}
	_ = f.Send("u9", Counts{}, Options{})
	if len(calls) != 1 || calls[0] != "u9" {
		t.Fatalf("adapter calls = %v", calls)
	}
}
