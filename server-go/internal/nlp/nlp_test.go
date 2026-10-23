package nlp

import (
	"reflect"
	"testing"

	"github.com/gnacho/deltos/server-go/internal/recurrence"
)

// TODAY is a Saturday (weekday 6), the same anchor the Node nlp.test.ts uses.
const TODAY = "2026-08-22"

func wantRec(freq string, interval int, weekdays []int) *recurrence.Recurrence {
	return &recurrence.Recurrence{Freq: freq, Interval: interval, Weekdays: weekdays, Mode: "due"}
}

type taskCase struct {
	name      string
	text      string
	lang      string
	today     string
	wantDue   string // "" => nil
	wantRec   *recurrence.Recurrence
	wantTitle string
}

func runTaskCases(t *testing.T, cases []taskCase) {
	t.Helper()
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			today := tc.today
			if today == "" {
				today = TODAY
			}
			got := ParseTaskText(tc.text, tc.lang, today)
			if got == nil {
				t.Fatalf("ParseTaskText(%q) = nil, want a result", tc.text)
			}
			if tc.wantDue == "" {
				if got.DueDate != nil {
					t.Fatalf("due_date = %q, want nil", *got.DueDate)
				}
			} else if got.DueDate == nil || *got.DueDate != tc.wantDue {
				t.Fatalf("due_date = %v, want %q", got.DueDate, tc.wantDue)
			}
			if tc.wantRec == nil {
				if got.Recurrence != nil {
					t.Fatalf("recurrence = %+v, want nil", got.Recurrence)
				}
			} else if got.Recurrence == nil || !reflect.DeepEqual(*got.Recurrence, *tc.wantRec) {
				t.Fatalf("recurrence = %+v, want %+v", got.Recurrence, tc.wantRec)
			}
			if got.CleanedTitle != tc.wantTitle {
				t.Fatalf("cleanedTitle = %q, want %q", got.CleanedTitle, tc.wantTitle)
			}
		})
	}
}

func TestParseTaskTextDueDates(t *testing.T) {
	cases := []taskCase{
		{"ES mañana", "revisar el coche mañana", "es", "", "2026-08-23", nil, "revisar el coche"},
		{"EN tomorrow", "call the bank tomorrow", "en", "", "2026-08-23", nil, "call the bank"},
		{"ES en 3 días", "pagar la factura en 3 días", "es", "", "2026-08-25", nil, "pagar la factura"},
		{"ES en 1 día", "comprar pan en 1 día", "es", "", "2026-08-23", nil, "comprar pan"},
		{"EN in 5 days", "pay rent in 5 days", "en", "", "2026-08-27", nil, "pay rent"},
		{"ISO explícita", "entregar el informe 2026-09-01", "es", "", "2026-09-01", nil, "entregar el informe"},
		// The due-weekday check strips only the day name (not the "el"/"on"/
		// "next" prefix), exactly like parseTaskText in the Node server.
		{"ES el viernes", "comprar entradas el viernes", "es", "", "2026-08-28", nil, "comprar entradas el"},
		{"EN next monday", "schedule dentist appointment next monday", "en", "", "2026-08-24", nil, "schedule dentist appointment next"},
		{"ES hoy", "limpiar la cocina hoy", "es", "", "2026-08-22", nil, "limpiar la cocina"},
		{"EN today", "walk the dog today", "en", "", "2026-08-22", nil, "walk the dog"},
		{"ES pasado manana", "entregar pasado manana", "es", "", "2026-08-24", nil, "entregar"},
		{"ES el lunes", "médico el lunes", "es", "", "2026-08-24", nil, "médico el"},
		{"ES el domingo", "médico el domingo", "es", "", "2026-08-23", nil, "médico el"},
		{"ES el sábado mismo día", "médico el sábado", "es", "", "2026-08-29", nil, "médico el"},
		{"EN on tuesday", "meet tuesday", "en", "", "2026-08-25", nil, "meet"},
		{"en 1 día cruza mes", "pagar en 1 día", "es", "2026-08-31", "2026-09-01", nil, "pagar"},
		{"el viernes hoy es viernes", "cena el viernes", "es", "2026-08-21", "2026-08-28", nil, "cena el"},
		{"mañana en año bisiesto", "pagar mañana", "es", "2024-02-28", "2024-02-29", nil, "pagar"},
	}
	runTaskCases(t, cases)
}

// TestParseTaskTextRelShadowing documents a faithful Node quirk: "pasado
// mañana" is shadowed by the earlier "mañana" entry (due = +1), while the
// accent-less "pasado manana" is not, and "day after tomorrow" is shadowed by
// "tomorrow". Precedence is preserved exactly as in the TypeScript source.
func TestParseTaskTextRelShadowing(t *testing.T) {
	runTaskCases(t, []taskCase{
		{"ES pasado mañana (sombreado por mañana)", "entregar pasado mañana", "es", "", "2026-08-23", nil, "entregar pasado"},
		{"EN day after tomorrow (sombreado por tomorrow)", "submit the report day after tomorrow", "en", "", "2026-08-23", nil, "submit the report day after"},
	})
}

func TestParseTaskTextRecurrence(t *testing.T) {
	cases := []taskCase{
		{"ES cada 6 meses", "cambiar el filtro del agua cada 6 meses", "es", "", "", wantRec("monthly", 6, nil), "cambiar el filtro del agua"},
		{"EN every 6 months", "change the water filter every 6 months", "en", "", "", wantRec("monthly", 6, nil), "change the water filter"},
		{"ES los lunes y jueves", "sacar la basura los lunes y jueves", "es", "", "2026-08-24", wantRec("weekly", 1, []int{1, 4}), "sacar la basura"},
		{"EN every Monday and Tuesday", "take the trash out every Monday and Tuesday at 6:15 pm", "en", "", "2026-08-24", wantRec("weekly", 1, []int{1, 2}), "take the trash out at 6:15 pm"},
		{"ES todos los días", "regar las plantas todos los días", "es", "", "", wantRec("daily", 1, nil), "regar las plantas"},
		{"ES semanal", "pasar la aspiradora semanal", "es", "", "", wantRec("weekly", 1, nil), "pasar la aspiradora"},
		{"EN every day", "feed the cat every day", "en", "", "", wantRec("daily", 1, nil), "feed the cat"},
		{"ES cada 2 semanas", "regar cada 2 semanas", "es", "", "", wantRec("weekly", 2, nil), "regar"},
		{"ES cada 3 días", "regar cada 3 días", "es", "", "", wantRec("daily", 3, nil), "regar"},
		{"ES cada día", "regar cada día", "es", "", "", wantRec("daily", 1, nil), "regar"},
		{"ES a diario", "meditar a diario", "es", "", "", wantRec("daily", 1, nil), "meditar"},
		{"ES todos los dias", "regar todos los dias", "es", "", "", wantRec("daily", 1, nil), "regar"},
		{"ES cada mes", "pagar cada mes", "es", "", "", wantRec("monthly", 1, nil), "pagar"},
		{"ES mensual", "pagar mensual", "es", "", "", wantRec("monthly", 1, nil), "pagar"},
		{"ES cada 1 año", "revisar cada 1 año", "es", "", "", wantRec("monthly", 12, nil), "revisar"},
		{"ES cada 2 años", "revisar cada 2 años", "es", "", "", wantRec("monthly", 24, nil), "revisar"},
		{"EN every 2 weeks", "check every 2 weeks", "en", "", "", wantRec("weekly", 2, nil), "check"},
		{"EN every 3 days", "check every 3 days", "en", "", "", wantRec("daily", 3, nil), "check"},
		{"EN weekly", "clean weekly", "en", "", "", wantRec("weekly", 1, nil), "clean"},
		{"EN every month", "pay every month", "en", "", "", wantRec("monthly", 1, nil), "pay"},
		{"EN monthly", "review monthly", "en", "", "", wantRec("monthly", 1, nil), "review"},
		{"EN every 1 year", "review every 1 year", "en", "", "", wantRec("monthly", 12, nil), "review"},
		{"EN every 2 years", "review every 2 years", "en", "", "", wantRec("monthly", 24, nil), "review"},
		{"ES cada lunes", "gimnasio cada lunes", "es", "", "2026-08-24", wantRec("weekly", 1, []int{1}), "gimnasio"},
		{"ES los lunes", "gimnasio los lunes", "es", "", "2026-08-24", wantRec("weekly", 1, []int{1}), "gimnasio"},
		{"ES todos los lunes", "gimnasio todos los lunes", "es", "", "2026-08-24", wantRec("weekly", 1, []int{1}), "gimnasio"},
		{"EN every monday", "gym every monday", "en", "", "2026-08-24", wantRec("weekly", 1, []int{1}), "gym"},
		{"ES cada lunes y miércoles", "gimnasio cada lunes y miércoles", "es", "", "2026-08-24", wantRec("weekly", 1, []int{1, 3}), "gimnasio"},
		{"EN every monday and wednesday", "gym every monday and wednesday", "en", "", "2026-08-24", wantRec("weekly", 1, []int{1, 3}), "gym"},
		{"ES cada sábado", "sacar la basura cada sábado", "es", "", "2026-08-29", wantRec("weekly", 1, []int{6}), "sacar la basura"},
		{"ES cada sabado", "sacar la basura cada sabado", "es", "", "2026-08-29", wantRec("weekly", 1, []int{6}), "sacar la basura"},
		{"ES cada lunes y jueves", "gimnasio cada lunes y jueves", "es", "", "2026-08-24", wantRec("weekly", 1, []int{1, 4}), "gimnasio"},
	}
	runTaskCases(t, cases)
}

func TestParseTaskTextCombined(t *testing.T) {
	runTaskCases(t, []taskCase{
		{"fecha y recurrencia juntas", "regar las plantas cada lunes y miércoles mañana", "es", "", "2026-08-23", wantRec("weekly", 1, []int{1, 3}), "regar las plantas"},
		{"ISO y recurrencia", "pagar el alquiler 2026-09-01 cada mes", "es", "", "2026-09-01", wantRec("monthly", 1, nil), "pagar el alquiler"},
	})
}

func TestParseTaskTextNull(t *testing.T) {
	cases := []struct {
		text string
		lang string
	}{
		{"comprar leche", "es"},
		{"", "es"},
		{"mañana", "es"},     // solo la parte temporal: no queda título
		{"2026-09-01", "es"}, // solo ISO: no queda título
		{"comprar", "es"},    // sin marca temporal
		{"", "en"},
		{"buy milk", "en"},
	}
	for _, tc := range cases {
		if got := ParseTaskText(tc.text, tc.lang, TODAY); got != nil {
			t.Fatalf("ParseTaskText(%q, %q) = %+v, want nil", tc.text, tc.lang, got)
		}
	}
}

func TestParseTaskTextLangDefaultsToSpanish(t *testing.T) {
	// lang != "en" falls back to the Spanish dictionary, like the TS.
	got := ParseTaskText("revisar mañana", "", TODAY)
	if got == nil || got.DueDate == nil || *got.DueDate != "2026-08-23" {
		t.Fatalf("default-lang parse = %+v", got)
	}
}

// TestParseTaskTextWeekdaysSerialization ensures a single weekday is still an
// array (not nil), matching the Node JSON shape the Periodicas page consumes.
func TestParseTaskTextWeekdaysSerialization(t *testing.T) {
	got := ParseTaskText("gimnasio los lunes", "es", TODAY)
	if got == nil || got.Recurrence == nil || got.Recurrence.Weekdays == nil || len(got.Recurrence.Weekdays) != 1 {
		t.Fatalf("single weekday must be [1], got %+v", got)
	}
}

func TestStripTaskParts(t *testing.T) {
	// longest-first, word-bounded, case-insensitive, trailing comma cleanup.
	if got := stripTaskParts("Comprar Leche mañana", []string{"mañana", "leche"}); got != "Comprar" {
		t.Fatalf("strip = %q, want %q", got, "Comprar")
	}
	if got := stripTaskParts("Comprar, mañana", []string{"mañana"}); got != "Comprar" {
		t.Fatalf("trailing comma strip = %q, want %q", got, "Comprar")
	}
}
