// Package recurrence ports server/src/recurrence.ts: parsing of the
// recurrence JSON config and the computation of the next due date. Pure logic
// (testable without a DB) plus the helpers that read the completion history of
// a series for the adaptive mode.
//
// Config (tasks.recurrence column, JSON TEXT or NULL):
//
//	{ freq: 'daily'|'weekly'|'monthly', interval: N, weekdays?: [0-6], mode: 'due'|'completion' }
//
// mode 'due' computes the next date from the previous due date (constant
// cadence); mode 'completion' uses the MEDIAN of the real gaps between
// completions of the series (adaptive), falling back to the configured
// interval when there is not enough history. weekdays only applies to weekly.
package recurrence

import (
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gnacho/deltos/server-go/internal/db"
)

const dayMs = int64(24 * 60 * 60 * 1000)

// Recurrence is the normalized recurrence config. Field order matches
// serializeRecurrence so the stored JSON is identical to the Node server.
type Recurrence struct {
	Freq     string `json:"freq"`
	Interval int    `json:"interval"`
	Weekdays []int  `json:"weekdays"` // nil serializes as null
	Mode     string `json:"mode"`
}

var frequencies = map[string]bool{"daily": true, "weekly": true, "monthly": true}

// NormalizeRecurrence turns a raw config (from the DB JSON or the request
// body) into a valid Recurrence, or nil when it is not usable.
func NormalizeRecurrence(rec map[string]any) *Recurrence {
	if rec == nil {
		return nil
	}
	freq, _ := rec["freq"].(string)
	if !frequencies[freq] {
		return nil
	}
	interval := 1
	if iv, ok := rec["interval"].(float64); ok && iv >= 1 && iv == math.Trunc(iv) {
		interval = int(iv)
	}
	var weekdays []int
	if freq == "weekly" {
		if arr, ok := rec["weekdays"].([]any); ok && len(arr) > 0 {
			seen := map[int]bool{}
			for _, w := range arr {
				if f, ok := w.(float64); ok && f >= 0 && f <= 6 && f == math.Trunc(f) {
					seen[int(f)] = true
				}
			}
			for d := range seen {
				weekdays = append(weekdays, d)
			}
			sort.Ints(weekdays)
			if len(weekdays) == 0 {
				weekdays = nil
			}
		}
	}
	mode := "due"
	if m, _ := rec["mode"].(string); m == "completion" {
		mode = "completion"
	}
	return &Recurrence{Freq: freq, Interval: interval, Weekdays: weekdays, Mode: mode}
}

// SerializeRecurrence returns the JSON representation stored in the DB.
func SerializeRecurrence(rec *Recurrence) string {
	b, err := json.Marshal(rec)
	if err != nil {
		return "{}"
	}
	return string(b)
}

// ParseRecurrence parses a stored JSON string into a normalized Recurrence.
func ParseRecurrence(raw string) *Recurrence {
	var m map[string]any
	if err := json.Unmarshal([]byte(raw), &m); err != nil {
		return nil
	}
	return NormalizeRecurrence(m)
}

// --- date utilities (YYYY-MM-DD, no timezone, matching the Node helpers) ---

func parseISO(s string) (y, m, d int) {
	parts := strings.SplitN(s, "-", 3)
	y, _ = strconv.Atoi(parts[0])
	m, _ = strconv.Atoi(parts[1])
	d, _ = strconv.Atoi(parts[2])
	return
}

func fmtISO(y, m, d int) string {
	return fmt.Sprintf("%04d-%02d-%02d", y, m, d)
}

func dateUTC(s string) time.Time {
	y, m, d := parseISO(s)
	return time.Date(y, time.Month(m), d, 0, 0, 0, 0, time.UTC)
}

func addDays(s string, n int) string {
	return dateUTC(s).AddDate(0, 0, n).Format("2006-01-02")
}

func addMonths(s string, n int) string {
	y, m, d := parseISO(s)
	target := time.Date(y, time.Month(m)+time.Month(n), 1, 0, 0, 0, 0, time.UTC)
	lastDay := time.Date(target.Year(), target.Month()+1, 0, 0, 0, 0, 0, time.UTC).Day()
	if d > lastDay {
		d = lastDay
	}
	return fmtISO(target.Year(), int(target.Month()), d)
}

func weekdayOf(s string) int {
	return int(dateUTC(s).Weekday()) // 0=Sunday .. 6=Saturday
}

func containsInt(list []int, v int) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

// NextOccurrence returns the next occurrence strictly after `from` per the
// config (empty string when the frequency is unknown, which normalize
// prevents).
func NextOccurrence(from string, rec *Recurrence) string {
	switch rec.Freq {
	case "daily":
		return addDays(from, rec.Interval)
	case "monthly":
		return addMonths(from, rec.Interval)
	case "weekly":
		if len(rec.Weekdays) > 0 {
			d := addDays(from, 1)
			for i := 0; i < 14; i++ {
				if containsInt(rec.Weekdays, weekdayOf(d)) {
					return d
				}
				d = addDays(d, 1)
			}
			return d // should not happen; coverage
		}
		return addDays(from, 7*rec.Interval)
	}
	return ""
}

var madrid = func() *time.Location {
	loc, err := time.LoadLocation("Europe/Madrid")
	if err != nil {
		return time.UTC
	}
	return loc
}()

// TodayLocal returns today's date (YYYY-MM-DD) in Europe/Madrid.
func TodayLocal() string {
	now := time.Now().In(madrid)
	return fmt.Sprintf("%04d-%02d-%02d", now.Year(), int(now.Month()), now.Day())
}

// --- adaptive mode -----------------------------------------------------------

// CompletionDates returns the completion timestamps (epoch ms) of a series:
// the moved->hecho events of the group's tasks.
func CompletionDates(d *db.DB, groupID string) []int64 {
	rows, err := d.Query(
		`SELECT ae.created_at
		 FROM activity_events ae
		 JOIN tasks t ON t.id = ae.task_id
		 WHERE t.recurrence_group_id = ? AND ae.type = 'moved'
		   AND json_extract(ae.data, '$.to') = 'hecho'
		 ORDER BY ae.created_at`, groupID)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []int64
	for rows.Next() {
		var ts int64
		if rows.Scan(&ts) == nil {
			out = append(out, ts)
		}
	}
	return out
}

// Median returns the median of the values (already copied and sorted).
func Median(arr []float64) float64 {
	sorted := append([]float64(nil), arr...)
	sort.Float64s(sorted)
	mid := len(sorted) / 2
	if len(sorted)%2 == 1 {
		return sorted[mid]
	}
	return (sorted[mid-1] + sorted[mid]) / 2
}

// AdaptiveInterval returns the effective interval in days for the adaptive
// mode: the median of the gaps between consecutive completions; the configured
// interval when there are fewer than 2 completions. Never below 1 day.
func AdaptiveInterval(completionsMs []int64, configured int) int {
	if len(completionsMs) < 2 {
		return configured
	}
	gaps := make([]float64, 0, len(completionsMs)-1)
	for i := 1; i < len(completionsMs); i++ {
		gaps = append(gaps, math.Round(float64(completionsMs[i]-completionsMs[i-1])/float64(dayMs)))
	}
	eff := int(math.Round(Median(gaps)))
	if eff < 1 {
		eff = 1
	}
	return eff
}

// RecurrentTask is the minimal task row computeNextDue needs.
type RecurrentTask struct {
	ID                string
	DueDate           *string
	Recurrence        *string // JSON string or nil
	RecurrenceGroupID *string
}

// ComputeNextDue returns the next due date of a recurrent task that was just
// completed, or nil when the task is not recurrent.
func ComputeNextDue(d *db.DB, task RecurrentTask, today string) *string {
	rec := (*Recurrence)(nil)
	if task.Recurrence != nil {
		rec = ParseRecurrence(*task.Recurrence)
	}
	if rec == nil {
		return nil
	}
	groupID := task.ID
	if task.RecurrenceGroupID != nil && *task.RecurrenceGroupID != "" {
		groupID = *task.RecurrenceGroupID
	}

	if rec.Mode == "completion" {
		completions := CompletionDates(d, groupID)
		eff := AdaptiveInterval(completions, rec.Interval)
		last := today
		if len(completions) > 0 {
			last = time.UnixMilli(completions[len(completions)-1]).UTC().Format("2006-01-02")
		}
		next := addDays(last, eff)
		return &next
	}

	base := today
	if task.DueDate != nil {
		base = *task.DueDate
	}
	next := NextOccurrence(base, rec)
	for next <= today {
		next = NextOccurrence(next, rec)
	}
	return &next
}
