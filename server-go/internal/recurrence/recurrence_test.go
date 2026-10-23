package recurrence

import (
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/gnacho/deltos/server-go/internal/db"
)

func rec(freq string, interval int, weekdays []int, mode string) *Recurrence {
	return &Recurrence{Freq: freq, Interval: interval, Weekdays: weekdays, Mode: mode}
}

func TestNextOccurrence(t *testing.T) {
	cases := []struct {
		name string
		rec  *Recurrence
		from string
		want string
	}{
		{"daily interval", rec("daily", 2, nil, "due"), "2026-08-22", "2026-08-24"},
		{"weekly no weekdays", rec("weekly", 1, nil, "due"), "2026-08-22", "2026-08-29"},
		{"weekly weekdays sat->mon", rec("weekly", 1, []int{1, 5}, "due"), "2026-08-22", "2026-08-24"},
		{"weekly weekdays mon->fri", rec("weekly", 1, []int{1, 5}, "due"), "2026-08-24", "2026-08-28"},
		{"monthly clamp end of month", rec("monthly", 1, nil, "due"), "2026-01-31", "2026-02-28"},
		{"monthly mid", rec("monthly", 1, nil, "due"), "2026-02-15", "2026-03-15"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := NextOccurrence(tc.from, tc.rec); got != tc.want {
				t.Fatalf("NextOccurrence(%q) = %q, want %q", tc.from, got, tc.want)
			}
		})
	}
}

func TestNormalizeRecurrence(t *testing.T) {
	null := func() *Recurrence { return nil }
	cases := []struct {
		name string
		in   map[string]any
		want *Recurrence
	}{
		{"null", nil, null()},
		{"empty", map[string]any{}, null()},
		{"yearly", map[string]any{"freq": "yearly"}, null()},
		{"weekly dedup and sort", map[string]any{"freq": "weekly", "weekdays": []any{float64(9), float64(1), float64(1), float64(5)}}, rec("weekly", 1, []int{1, 5}, "due")},
		{"daily default interval", map[string]any{"freq": "daily"}, rec("daily", 1, nil, "due")},
		{"completion mode", map[string]any{"freq": "weekly", "mode": "completion"}, rec("weekly", 1, nil, "completion")},
		{"interval non-integer defaults", map[string]any{"freq": "daily", "interval": 2.5}, rec("daily", 1, nil, "due")},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := NormalizeRecurrence(tc.in)
			if tc.want == nil {
				if got != nil {
					t.Fatalf("expected nil, got %+v", got)
				}
				return
			}
			if got == nil || !reflect.DeepEqual(*got, *tc.want) {
				t.Fatalf("got %+v, want %+v", got, tc.want)
			}
		})
	}
}

func TestMedian(t *testing.T) {
	if got := Median([]float64{3, 1, 2}); got != 2 {
		t.Fatalf("median odd = %v, want 2", got)
	}
	if got := Median([]float64{4, 1, 2, 3}); got != 2.5 {
		t.Fatalf("median even = %v, want 2.5", got)
	}
}

func TestAdaptiveInterval(t *testing.T) {
	day := int64(24 * 60 * 60 * 1000)
	t0 := int64(1700000000000)
	cases := []struct {
		name string
		in   []int64
		conf int
		want int
	}{
		{"empty", []int64{}, 2, 2},
		{"single", []int64{t0}, 2, 2},
		{"gaps 7,9 -> 8", []int64{t0, t0 + 7*day, t0 + 16*day}, 2, 8},
		{"gaps 3,5 -> 4", []int64{t0, t0 + 3*day, t0 + 8*day}, 2, 4},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := AdaptiveInterval(tc.in, tc.conf); got != tc.want {
				t.Fatalf("AdaptiveInterval = %d, want %d", got, tc.want)
			}
		})
	}
}

func testDB(t *testing.T) *db.DB {
	t.Helper()
	d, err := db.Open(filepath.Join(t.TempDir(), "rec.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	// satisfy the FK on tasks.project_id
	if _, err := d.Exec(`INSERT INTO projects (id, name, position, created_at) VALUES ('p1','p',0,0)`); err != nil {
		t.Fatal(err)
	}
	if _, err := d.Exec(`INSERT INTO users (id, username, password_hash, role, created_at) VALUES ('u1','u1','x','user',0)`); err != nil {
		t.Fatal(err)
	}
	return d
}

func str(s string) *string { return &s }

func TestComputeNextDueDueMode(t *testing.T) {
	d := testDB(t)
	// weekly interval 1, due 2026-08-21, today 2026-08-22 -> 2026-08-28
	got := ComputeNextDue(d, RecurrentTask{
		ID: "a1", DueDate: str("2026-08-21"),
		Recurrence: str(`{"freq":"weekly","interval":1,"mode":"due"}`),
	}, "2026-08-22")
	if got == nil || *got != "2026-08-28" {
		t.Fatalf("due mode = %v, want 2026-08-28", got)
	}

	// advanced past today: due 2026-08-01, today 2026-08-22 -> 2026-08-29
	got = ComputeNextDue(d, RecurrentTask{
		ID: "a2", DueDate: str("2026-08-01"),
		Recurrence: str(`{"freq":"weekly","interval":1,"mode":"due"}`),
	}, "2026-08-22")
	if got == nil || *got != "2026-08-29" {
		t.Fatalf("advanced due = %v, want 2026-08-29", got)
	}

	// not recurrent -> nil
	if got := ComputeNextDue(d, RecurrentTask{ID: "x"}, "2026-08-22"); got != nil {
		t.Fatalf("non-recurrent should be nil, got %v", got)
	}
}

func TestComputeNextDueCompletionMode(t *testing.T) {
	// first completion without history -> configured interval
	d := testDB(t)
	T0 := time.Date(2026, 8, 22, 12, 0, 0, 0, time.UTC).UnixMilli()
	if _, err := d.Exec(`INSERT INTO tasks (id, project_id, title, "column", position, created_at, updated_at, recurrence, recurrence_group_id) VALUES ('a3','p1','Riega','hecho',0,?,?,?,'a3')`,
		T0, T0, `{"freq":"daily","interval":2,"mode":"completion"}`); err != nil {
		t.Fatal(err)
	}
	if _, err := d.Exec(`INSERT INTO activity_events (id, task_id, user_id, type, data, created_at) VALUES ('e1','a3','u1','moved','{"from":"encurso","to":"hecho"}',?)`, T0-1000); err != nil {
		t.Fatal(err)
	}
	got := ComputeNextDue(d, RecurrentTask{
		ID: "a3", DueDate: nil,
		Recurrence: str(`{"freq":"daily","interval":2,"mode":"completion"}`),
	}, "2026-08-22")
	if got == nil || *got != "2026-08-24" {
		t.Fatalf("completion first = %v, want 2026-08-24", got)
	}

	// with history -> median of real gaps
	day := int64(24 * 60 * 60 * 1000)
	now := T0
	for i, off := range []int64{-16 * day, -9 * day, 0} {
		tid := []string{"s1", "s2", "s3"}[i]
		if _, err := d.Exec(`INSERT INTO tasks (id, project_id, title, "column", position, created_at, updated_at, recurrence, recurrence_group_id) VALUES (?,?,?,?,?,?,?,?,'series-1')`,
			tid, "p1", "Riega", "hecho", i, now, now, `{"freq":"weekly","interval":1,"mode":"completion"}`); err != nil {
			t.Fatal(err)
		}
		if _, err := d.Exec(`INSERT INTO activity_events (id, task_id, user_id, type, data, created_at) VALUES (?,?,'u1','moved','{"from":"encurso","to":"hecho"}',?)`,
			"e"+tid, tid, now+off); err != nil {
			t.Fatal(err)
		}
	}
	completions := CompletionDates(d, "series-1")
	if len(completions) != 3 {
		t.Fatalf("completionDates = %d, want 3", len(completions))
	}
	if AdaptiveInterval(completions, 1) != 8 {
		t.Fatalf("adaptiveInterval = %d, want 8", AdaptiveInterval(completions, 1))
	}
	got = ComputeNextDue(d, RecurrentTask{
		ID: "s3", DueDate: nil,
		Recurrence:        str(`{"freq":"weekly","interval":1,"mode":"completion"}`),
		RecurrenceGroupID: str("series-1"),
	}, "2026-08-22")
	if got == nil || *got != "2026-08-30" {
		t.Fatalf("completion history = %v, want 2026-08-30", got)
	}
}
