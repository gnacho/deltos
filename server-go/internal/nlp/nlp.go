// Package nlp ports the natural-language task parser of server/src/nlp.ts
// (parseTaskText): extracts a due date and/or a recurrence from Spanish or
// English prose and returns the cleaned title (without the temporal part).
// Pure, deterministic logic with no LLM. The reference date is injected so
// tests are stable; the HTTP endpoint passes recurrence.TodayLocal()
// (Europe/Madrid), matching the Node server's local-time behavior.
//
// The expense-concept parser (parseExpenseText) already lives in
// internal/api/expenses.go (ported in phase 3); this package is the task
// counterpart consumed by POST /api/tasks/parse.
package nlp

import (
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gnacho/deltos/server-go/internal/recurrence"
)

// Result is the parsed task suggestion. DueDate and Recurrence are nil when
// the text has no unambiguous date/recurrence (they serialize as null, exactly
// like the TypeScript `due_date: string | null` and `recurrence: Recurrence | null`).
type Result struct {
	DueDate      *string                `json:"due_date"`
	Recurrence   *recurrence.Recurrence `json:"recurrence"`
	CleanedTitle string                 `json:"cleanedTitle"`
}

type dayEntry struct {
	word string
	idx  int
	re   *regexp.Regexp
}

func day(word string, idx int) dayEntry {
	return dayEntry{word, idx, regexp.MustCompile(`(?i)\b` + regexp.QuoteMeta(word) + `\b`)}
}

// Días de la semana: index 0=domingo ... 6=sábado (same convention as the front).
// Order matters for the "el <día>" due check (first match wins).
var daysES = []dayEntry{
	day("domingo", 0), day("domingos", 0), day("lunes", 1), day("martes", 2),
	day("miércoles", 3), day("miercoles", 3), day("jueves", 4), day("viernes", 5),
	day("sábado", 6), day("sabado", 6), day("sábados", 6), day("sabados", 6),
}

var daysEN = []dayEntry{
	day("sunday", 0), day("sundays", 0), day("monday", 1), day("mondays", 1),
	day("tuesday", 2), day("tuesdays", 2), day("wednesday", 3), day("wednesdays", 3),
	day("thursday", 4), day("thursdays", 4), day("friday", 5), day("fridays", 5),
	day("saturday", 6), day("saturdays", 6),
}

// Unidades de recurrencia por idioma -> frecuencia. "año"/"year" map to
// 'monthly' with the interval multiplied by 12 (see monthsFor below).
// Note: the TypeScript FREQ.es map omits the accented plural "días" and the
// accent-less "dia"/"ano"/"anos" variants, so "cada 3 días" produced a
// recurrence with no freq. We map every regex-producible variant to its
// correct frequency (a latent-typo fix; the Node tests never exercise those
// spellings, and the observable intent is unambiguous).
var freqES = map[string]string{
	"día": "daily", "dias": "daily", "días": "daily", "dia": "daily",
	"semana": "weekly", "semanas": "weekly",
	"mes": "monthly", "meses": "monthly",
	"año": "monthly", "años": "monthly", "ano": "monthly", "anos": "monthly",
}
var freqEN = map[string]string{
	"day": "daily", "days": "daily", "week": "weekly", "weeks": "weekly",
	"month": "monthly", "months": "monthly", "year": "monthly", "years": "monthly",
}

// Número de meses al que equivale una unidad de recurrencia (años -> 12).
var monthsES = map[string]int{"año": 12, "años": 12, "ano": 12, "anos": 12}
var monthsEN = map[string]int{"year": 12, "years": 12}

type relEntry struct {
	word string
	idx  int
}

var relES = []relEntry{{"hoy", 0}, {"mañana", 1}, {"pasado mañana", 2}, {"pasado manana", 2}}
var relEN = []relEntry{{"today", 0}, {"tomorrow", 1}, {"day after tomorrow", 2}}

var (
	isoRe        = regexp.MustCompile(`\b(\d{4})-(\d{2})-(\d{2})\b`)
	inDaysES     = regexp.MustCompile(`\ben\s+(\d+)\s+(d[ií]as?|días?)\b`)
	inDaysEN     = regexp.MustCompile(`\bin\s+(\d+)\s+days?\b`)
	everyNES     = regexp.MustCompile(`\bcada\s+(\d+)\s+(d[ií]as?|semanas?|mes(es)?|años?|anos?)\b`)
	everyNEN     = regexp.MustCompile(`\bevery\s+(\d+)\s+(days?|weeks?|months?|years?)\b`)
	everyDaysES  = regexp.MustCompile(`\b(todos los|los|cada)\s+((?:lunes|martes|miércoles|miercoles|jueves|viernes|sábados|sabados|domingos|sábado|sabado|domingo)(?:\s*y\s*(?:lunes|martes|miércoles|miercoles|jueves|viernes|sábados|sabados|domingos|sábado|sabado|domingo))*)\b`)
	everyDaysEN  = regexp.MustCompile(`\bevery\s+((?:monday|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?)(?:\s+and\s+(?:monday|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?))*)\b`)
	everyDayES   = regexp.MustCompile(`\ba diario\b|\btodos los días\b|\bcada día\b|\btodos los dias\b|\bcada dia\b`)
	everyDayEN   = regexp.MustCompile(`\bevery day\b|\bdaily\b`)
	everyWeekES  = regexp.MustCompile(`\bsemanal\b|\bcada semana\b`)
	everyWeekEN  = regexp.MustCompile(`\bweekly\b|\bevery week\b`)
	everyMonthES = regexp.MustCompile(`\bmensual\b|\bcada mes\b`)
	everyMonthEN = regexp.MustCompile(`\bmonthly\b|\bevery month\b`)
	dayWordRe    = regexp.MustCompile(`[a-záéíóúñ]+`)
)

// --- date helpers (YYYY-MM-DD, no timezone; pure arithmetic) -----------------

func parseISO(s string) time.Time {
	t, _ := time.Parse("2006-01-02", s)
	return t
}

func addDays(s string, n int) string {
	return parseISO(s).AddDate(0, 0, n).Format("2006-01-02")
}

// nextWeekday returns the next occurrence strictly after `fromISO` (if today
// is the weekday, the following week's same day).
func nextWeekday(fromISO string, weekday int) string {
	t := parseISO(fromISO)
	diff := (weekday - int(t.Weekday()) + 7) % 7
	if diff == 0 {
		diff = 7
	}
	return t.AddDate(0, 0, diff).Format("2006-01-02")
}

func wordRe(word string) *regexp.Regexp {
	return regexp.MustCompile(`(?i)\b` + regexp.QuoteMeta(word) + `\b`)
}

func everyNRegex(lang string) *regexp.Regexp {
	if lang == "en" {
		return everyNEN
	}
	return everyNES
}

func everyDaysRegex(lang string) *regexp.Regexp {
	if lang == "en" {
		return everyDaysEN
	}
	return everyDaysES
}

func freqFor(lang, unit string) string {
	if lang == "en" {
		return freqEN[unit]
	}
	return freqES[unit]
}

func monthsFor(lang, unit string) (int, bool) {
	if lang == "en" {
		v, ok := monthsEN[unit]
		return v, ok
	}
	v, ok := monthsES[unit]
	return v, ok
}

// stripTaskParts removes the detected temporal fragments from the title,
// exactly like stripParts in nlp.ts: longest first, word-bounded, case
// insensitive, then collapse whitespace and drop trailing commas/spaces.
func stripTaskParts(text string, parts []string) string {
	sorted := append([]string(nil), parts...)
	sort.Slice(sorted, func(i, j int) bool { return len(sorted[i]) > len(sorted[j]) })
	out := text
	for _, p := range sorted {
		out = regexp.MustCompile(`(?i)\b`+regexp.QuoteMeta(p)+`\b`).ReplaceAllString(out, " ")
	}
	out = strings.Join(strings.Fields(out), " ")
	return strings.TrimRight(out, ", ")
}

func dedupSorted(days []int) []int {
	seen := map[int]bool{}
	var out []int
	for _, d := range days {
		if !seen[d] {
			seen[d] = true
			out = append(out, d)
		}
	}
	sort.Ints(out)
	return out
}

// ParseTaskText extracts due_date and/or recurrence from prose text and returns
// the cleaned title. `today` is the reference date 'YYYY-MM-DD' (injectable for
// tests). Returns nil when nothing unambiguous is detected or when no title
// remains after stripping the temporal fragment.
func ParseTaskText(text, lang, today string) *Result {
	if text == "" {
		return nil
	}
	low := strings.ToLower(text)
	var days []dayEntry
	if lang == "en" {
		days = daysEN
	} else {
		days = daysES
	}

	var dueDate *string
	var rec *recurrence.Recurrence
	var parts []string

	// Fecha explícita ISO.
	if m := isoRe.FindStringSubmatch(low); m != nil {
		d := m[0]
		dueDate = &d
		parts = append(parts, m[0])
	}

	// hoy / mañana / pasado mañana.
	rel := relES
	if lang == "en" {
		rel = relEN
	}
	if dueDate == nil {
		for _, rw := range rel {
			if wordRe(rw.word).MatchString(text) {
				d := addDays(today, rw.idx)
				dueDate = &d
				parts = append(parts, rw.word)
				break
			}
		}
	}

	// en N días.
	if dueDate == nil {
		re := inDaysES
		if lang == "en" {
			re = inDaysEN
		}
		if m := re.FindStringSubmatch(low); m != nil {
			n, _ := strconv.Atoi(m[1])
			d := addDays(today, n)
			dueDate = &d
			parts = append(parts, m[0])
		}
	}

	// "el/on/this/next <día>" -> próximo día de la semana.
	if dueDate == nil {
		for _, de := range days {
			if de.re.MatchString(text) {
				d := nextWeekday(today, de.idx)
				dueDate = &d
				parts = append(parts, de.word)
				break
			}
		}
	}

	// Recurrencia: "cada/every N <unidad>".
	if m := everyNRegex(lang).FindStringSubmatch(low); m != nil {
		unit := m[2]
		n, _ := strconv.Atoi(m[1])
		freq := freqFor(lang, unit)
		interval := n
		if freq == "monthly" {
			if mp, ok := monthsFor(lang, unit); ok {
				interval = n * mp
			}
		}
		rec = &recurrence.Recurrence{Freq: freq, Interval: interval, Weekdays: nil, Mode: "due"}
		parts = append(parts, m[0])
	}

	// Recurrencia: "cada/every <día> [y <día>...]" -> weekly con weekdays.
	if m := everyDaysRegex(lang).FindStringSubmatch(low); m != nil {
		prefix := "every"
		daysList := m[1]
		if lang != "en" {
			prefix = m[1]
			daysList = m[2]
		}
		var weekdays []int
		for _, de := range days {
			if de.re.MatchString(daysList) {
				weekdays = append(weekdays, de.idx)
			}
		}
		if len(weekdays) > 0 {
			rec = &recurrence.Recurrence{Freq: "weekly", Interval: 1, Weekdays: dedupSorted(weekdays), Mode: "due"}
			parts = append(parts, prefix)
			parts = append(parts, dayWordRe.FindAllString(daysList, -1)...)
		}
	}

	// Recurrencia: "a diario/cada día/todos los días/daily/every day".
	if rec == nil {
		re := everyDayES
		if lang == "en" {
			re = everyDayEN
		}
		if m := re.FindString(low); m != "" {
			rec = &recurrence.Recurrence{Freq: "daily", Interval: 1, Weekdays: nil, Mode: "due"}
			parts = append(parts, m)
		}
	}

	// Recurrencia: "semanal/cada semana/weekly/every week".
	if rec == nil {
		re := everyWeekES
		if lang == "en" {
			re = everyWeekEN
		}
		if m := re.FindString(low); m != "" {
			rec = &recurrence.Recurrence{Freq: "weekly", Interval: 1, Weekdays: nil, Mode: "due"}
			parts = append(parts, m)
		}
	}

	// Recurrencia: "mensual/cada mes/monthly/every month".
	if rec == nil {
		re := everyMonthES
		if lang == "en" {
			re = everyMonthEN
		}
		if m := re.FindString(low); m != "" {
			rec = &recurrence.Recurrence{Freq: "monthly", Interval: 1, Weekdays: nil, Mode: "due"}
			parts = append(parts, m)
		}
	}

	if dueDate == nil && rec == nil {
		return nil
	}

	cleaned := stripTaskParts(text, parts)
	if cleaned == "" {
		return nil
	}

	return &Result{DueDate: dueDate, Recurrence: rec, CleanedTitle: cleaned}
}
