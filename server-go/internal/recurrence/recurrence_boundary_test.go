package recurrence

import (
	"reflect"
	"testing"
)

// Additional table tests for the full engine (server/src/recurrence.ts):
// monthly end-of-month clamping across leap/non-leap years, weekday rollovers,
// daily interval across month/year boundaries, serialize/normalize round-trip
// stability and adaptive-median edge cases. The date arithmetic is date-only
// (no time-of-day), so Europe/Madrid DST transitions do not affect results;
// boundary dates around the 2026-03-29 DST switch are included for coverage.

func TestNextOccurrenceMonthlyClamping(t *testing.T) {
	cases := []struct {
		name string
		from string
		n    int
		want string
	}{
		{"jan31 -> feb28 non-leap", "2026-01-31", 1, "2026-02-28"},
		{"jan31 -> feb29 leap", "2024-01-31", 1, "2024-02-29"},
		{"jan31 -> feb28 2023", "2023-01-31", 1, "2023-02-28"},
		{"jan30 -> feb28 clamp", "2026-01-30", 1, "2026-02-28"},
		{"jan31 +2 -> mar31", "2026-01-31", 2, "2026-03-31"},
		{"feb29 leap +1 -> mar29", "2024-02-29", 1, "2024-03-29"},
		{"feb28 +1 -> mar28", "2026-02-28", 1, "2026-03-28"},
		{"mar31 -> apr30 clamp", "2026-03-31", 1, "2026-04-30"},
		{"dec31 -> jan31 rollover", "2026-12-31", 1, "2027-01-31"},
		{"dec15 -> jan15 rollover", "2026-12-15", 1, "2027-01-15"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := NextOccurrence(tc.from, rec("monthly", tc.n, nil, "due"))
			if got != tc.want {
				t.Fatalf("NextOccurrence(%q, monthly %d) = %q, want %q", tc.from, tc.n, got, tc.want)
			}
		})
	}
}

func TestNextOccurrenceDailyAndWeekly(t *testing.T) {
	cases := []struct {
		name string
		rec  *Recurrence
		from string
		want string
	}{
		{"daily cross month", rec("daily", 1, nil, "due"), "2026-08-31", "2026-09-01"},
		{"daily cross year", rec("daily", 1, nil, "due"), "2026-12-31", "2027-01-01"},
		{"daily leap day", rec("daily", 1, nil, "due"), "2024-02-28", "2024-02-29"},
		{"daily interval 3", rec("daily", 3, nil, "due"), "2026-08-22", "2026-08-25"},
		{"weekly interval 2", rec("weekly", 2, nil, "due"), "2026-08-22", "2026-09-05"},
		{"weekly interval 3", rec("weekly", 3, nil, "due"), "2026-08-22", "2026-09-12"},
		{"weekly sunday from sat", rec("weekly", 1, []int{0}, "due"), "2026-08-22", "2026-08-23"},
		{"weekly saturday from sat", rec("weekly", 1, []int{6}, "due"), "2026-08-22", "2026-08-29"},
		{"weekly [1,3] from wed", rec("weekly", 1, []int{1, 3}, "due"), "2026-08-26", "2026-08-31"},
		{"weekly [1,3] from mon", rec("weekly", 1, []int{1, 3}, "due"), "2026-08-24", "2026-08-26"},
		{"weekly DST sunday", rec("weekly", 1, []int{0}, "due"), "2026-03-28", "2026-03-29"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := NextOccurrence(tc.from, tc.rec); got != tc.want {
				t.Fatalf("NextOccurrence(%q) = %q, want %q", tc.from, got, tc.want)
			}
		})
	}
}

func TestNormalizeRecurrenceEdges(t *testing.T) {
	cases := []struct {
		name string
		in   map[string]any
		want *Recurrence
	}{
		{"interval 0 defaults", map[string]any{"freq": "daily", "interval": float64(0)}, rec("daily", 1, nil, "due")},
		{"interval negative defaults", map[string]any{"freq": "daily", "interval": float64(-3)}, rec("daily", 1, nil, "due")},
		{"interval 999 kept", map[string]any{"freq": "daily", "interval": float64(999)}, rec("daily", 999, nil, "due")},
		{"weekdays filter out of range", map[string]any{"freq": "weekly", "weekdays": []any{float64(9), float64(-1), float64(3)}}, rec("weekly", 1, []int{3}, "due")},
		{"weekdays filter non-integer", map[string]any{"freq": "weekly", "weekdays": []any{float64(1), 2.5, float64(4)}}, rec("weekly", 1, []int{1, 4}, "due")},
		{"weekdays all invalid -> null", map[string]any{"freq": "weekly", "weekdays": []any{float64(9)}}, rec("weekly", 1, nil, "due")},
		{"explicit due mode", map[string]any{"freq": "daily", "mode": "due"}, rec("daily", 1, nil, "due")},
		{"weekdays ignored for daily", map[string]any{"freq": "daily", "weekdays": []any{float64(1)}}, rec("daily", 1, nil, "due")},
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

func TestSerializeRoundTrip(t *testing.T) {
	cases := []*Recurrence{
		rec("daily", 1, nil, "due"),
		rec("weekly", 2, []int{1, 5}, "completion"),
		rec("monthly", 12, nil, "due"),
		rec("weekly", 1, []int{6}, "due"),
	}
	for i, want := range cases {
		raw := SerializeRecurrence(want)
		got := ParseRecurrence(raw)
		if got == nil || !reflect.DeepEqual(*got, *want) {
			t.Fatalf("round-trip #%d: %s -> %+v", i, raw, got)
		}
		// re-serialize must be byte-identical (field order stable)
		if raw2 := SerializeRecurrence(got); raw2 != raw {
			t.Fatalf("round-trip #%d re-serialize %s != %s", i, raw2, raw)
		}
	}
}

func TestSerializeNilWeekdays(t *testing.T) {
	// weekdays null (not []) must serialize as null, matching the Node shape.
	raw := SerializeRecurrence(rec("monthly", 6, nil, "due"))
	if raw != `{"freq":"monthly","interval":6,"weekdays":null,"mode":"due"}` {
		t.Fatalf("serialize null weekdays = %s", raw)
	}
}

func TestAdaptiveIntervalBoundaries(t *testing.T) {
	day := int64(24 * 60 * 60 * 1000)
	t0 := int64(1700000000000)
	cases := []struct {
		name string
		in   []int64
		conf int
		want int
	}{
		{"two equal gaps", []int64{t0, t0 + 5*day, t0 + 10*day}, 2, 5},
		{"fractional gap rounds up", []int64{t0, t0 + 5*day + 12*3600*1000}, 2, 6},
		{"gap below 1 day clamps", []int64{t0, t0 + 1000}, 2, 1},
		{"median odd 3 gaps", []int64{t0, t0 + 3*day, t0 + 8*day, t0 + 12*day}, 2, 4},
		{"median even 4 gaps", []int64{t0, t0 + 2*day, t0 + 6*day, t0 + 10*day, t0 + 14*day}, 2, 4},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := AdaptiveInterval(tc.in, tc.conf); got != tc.want {
				t.Fatalf("AdaptiveInterval = %d, want %d", got, tc.want)
			}
		})
	}
}

func TestComputeNextDueMonthlyClamping(t *testing.T) {
	d := testDB(t)
	// monthly from Jan 31 completed on Feb 1 -> next is Feb 28 (clamped).
	got := ComputeNextDue(d, RecurrentTask{
		ID:         "m1",
		DueDate:    str("2026-01-31"),
		Recurrence: str(`{"freq":"monthly","interval":1,"mode":"due"}`),
	}, "2026-02-01")
	if got == nil || *got != "2026-02-28" {
		t.Fatalf("monthly clamp = %v, want 2026-02-28", got)
	}
}
