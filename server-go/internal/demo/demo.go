// Package demo ports server/src/demo.ts: the deterministic demo database seed
// (app_demo.db), the mockup dataset. Production boots EMPTY: this seed ONLY
// applies to the demo DB, never to the real one. Dates are relative to TODAY
// (same philosophy as the mocks), so the demo board always shows overdue /
// today / future / no-date tasks.
package demo

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	"golang.org/x/crypto/bcrypt"

	"github.com/gnacho/deltos/server-go/internal/db"
	"github.com/gnacho/deltos/server-go/internal/logger"
)

var log = logger.L().Child(map[string]any{"component": "demo"})

const dayMs = 24 * 60 * 60 * 1000

func dueStr(offsetDays int) string {
	t := time.Now().AddDate(0, 0, offsetDays)
	return fmt.Sprintf("%04d-%02d-%02d", t.Year(), int(t.Month()), t.Day())
}

// SeedDemo seeds the demo DB idempotently: only when it has no users. It
// returns true when it seeded (false when already seeded). uploadsDir receives
// the fictional attachment files.
func SeedDemo(d *db.DB, uploadsDir string) bool {
	var count int
	_ = d.QueryRow("SELECT COUNT(*) FROM users").Scan(&count)
	if count > 0 {
		return false
	}

	hash, err := bcrypt.GenerateFromPassword([]byte("deltos-demo"), 10)
	if err != nil {
		return false
	}
	now := time.Now().UnixMilli()

	tx, err := d.Begin()
	if err != nil {
		return false
	}
	rollback := func() {
		_ = tx.Rollback()
	}

	// --- Users: Mar / Jordi + demo (no usable password) ---
	users := []struct{ id, username, display, color, role string }{
		{"mar", "mar", "Mar", "violet", "admin"},
		{"jordi", "jordi", "Jordi", "teal", "user"},
		{"demo", "demo", "Demo", "slate", "user"},
	}
	for _, u := range users {
		pw := string(hash)
		if u.id == "demo" {
			pw = "!sin-contraseña"
		}
		if _, err := tx.Exec(
			"INSERT INTO users (id, username, display_name, password_hash, color, language, role, created_at) VALUES (?, ?, ?, ?, ?, 'auto', ?, ?)",
			u.id, u.username, u.display, pw, u.color, u.role, now-30*dayMs); err != nil {
			rollback()
			return false
		}
	}

	// --- Projects (4, from the mockup). All three users are members of all 4. ---
	projects := []struct {
		id, name, emoji, color string
		pos                    int
		owner                  string
	}{
		{"p-casa", "Casa", "home", "sky", 0, "mar"},
		{"p-trabajo", "Trabajo", "briefcase", "blue", 1, "mar"},
		{"p-viaje", "Viaje a Lisboa", "plane", "amber", 2, "jordi"},
		{"p-huerto", "Huerto", "sprout", "emerald", 3, "jordi"},
	}
	for _, p := range projects {
		if _, err := tx.Exec(
			"INSERT INTO projects (id, name, emoji, color, position, owner_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
			p.id, p.name, p.emoji, p.color, p.pos, p.owner, now-30*dayMs); err != nil {
			rollback()
			return false
		}
		// owner + the rest (including demo) as members
		if _, err := tx.Exec(
			"INSERT INTO project_members (project_id, user_id, role, added_at) VALUES (?, ?, 'owner', ?)",
			p.id, p.owner, now-30*dayMs); err != nil {
			rollback()
			return false
		}
		for _, u := range []string{"mar", "jordi", "demo"} {
			if u == p.owner {
				continue
			}
			if _, err := tx.Exec(
				"INSERT INTO project_members (project_id, user_id, role, added_at) VALUES (?, ?, 'member', ?)",
				p.id, u, now-30*dayMs); err != nil {
				rollback()
				return false
			}
		}
	}

	// --- Global labels (6) ---
	labels := []struct{ id, name, color string }{
		{"l-urgente", "Urgente", "rose"},
		{"l-compras", "Compras", "amber"},
		{"l-admin", "Admin", "blue"},
		{"l-diseno", "Diseño", "violet"},
		{"l-dev", "Dev", "cyan"},
		{"l-familia", "Familia", "pink"},
	}
	for _, l := range labels {
		if _, err := tx.Exec("INSERT INTO labels (id, name, color) VALUES (?, ?, ?)", l.id, l.name, l.color); err != nil {
			rollback()
			return false
		}
	}

	// --- 15 tasks across the 3 columns (mockup dataset) ---
	type taskSeed struct {
		id, project, title, col, pr string
		due                         *int
		as                          *string
		tags                        []string
		by                          string
		created                     int
	}
	sp := func(s string) *string { return &s }
	ip := func(i int) *int { return &i }
	tasks := []taskSeed{
		{"t1", "p-casa", "Pedir cita ITV", "nuevo", "alta", ip(3), sp("mar"), []string{"l-admin"}, "mar", -9},
		{"t2", "p-casa", "Revisar presupuesto reforma baño", "encurso", "media", ip(-2), sp("jordi"), []string{"l-admin", "l-urgente"}, "mar", -8},
		{"t3", "p-casa", "Comprar bombillas para el recibidor", "hecho", "baja", nil, sp("mar"), []string{"l-compras"}, "mar", -12},
		{"t4", "p-casa", "Llamar al seguro del coche", "nuevo", "media", ip(10), nil, []string{"l-admin"}, "jordi", -3},
		{"t5", "p-trabajo", "Preparar presentación Q3", "encurso", "alta", ip(0), sp("mar"), []string{"l-diseno"}, "mar", -6},
		{"t6", "p-trabajo", "Enviar factura de julio al cliente", "nuevo", "alta", ip(1), sp("mar"), []string{"l-admin", "l-urgente"}, "mar", -2},
		{"t7", "p-trabajo", "Actualizar CV", "nuevo", "baja", nil, nil, []string{}, "jordi", -15},
		{"t8", "p-trabajo", "Corregir bug de inicio de sesión", "encurso", "media", ip(5), sp("jordi"), []string{"l-dev", "l-urgente"}, "jordi", -4},
		{"t9", "p-trabajo", "Preparar retro del sprint 12", "hecho", "baja", ip(-1), sp("jordi"), []string{"l-dev"}, "jordi", -10},
		{"t10", "p-viaje", "Reservar hotel en Lisboa", "encurso", "alta", ip(4), sp("mar"), []string{"l-familia"}, "jordi", -5},
		{"t11", "p-viaje", "Sacar billetes de tren", "nuevo", "media", ip(7), sp("jordi"), []string{"l-compras"}, "mar", -1},
		{"t12", "p-viaje", "Hacer lista de restaurantes", "hecho", "baja", nil, sp("mar"), []string{"l-familia"}, "mar", -7},
		{"t13", "p-huerto", "Comprar sustrato y semillas", "hecho", "media", ip(-2), sp("jordi"), []string{"l-compras"}, "jordi", -11},
		{"t14", "p-huerto", "Montar riego por goteo", "nuevo", "media", ip(12), sp("jordi"), []string{}, "mar", -2},
		{"t15", "p-huerto", "Trasplantar tomateras", "encurso", "baja", ip(2), sp("mar"), []string{}, "mar", -3},
	}

	colPos := map[string]int{"nuevo": 0, "encurso": 0, "hecho": 0}
	for _, t := range tasks {
		createdAt := now + int64(t.created)*dayMs
		shortID, err := d.AllocateShortId(tx, t.project)
		if err != nil {
			rollback()
			return false
		}
		var due, assignee any
		if t.due != nil {
			due = dueStr(*t.due)
		}
		if t.as != nil {
			assignee = *t.as
		}
		if _, err := tx.Exec(
			`INSERT INTO tasks (id, project_id, title, description, "column", position, priority, due_date, assignee_id, created_by, created_at, updated_at, short_id)
			 VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			t.id, t.project, t.title, t.col, colPos[t.col], t.pr, due, assignee, t.by, createdAt, createdAt, shortID); err != nil {
			rollback()
			return false
		}
		colPos[t.col]++
		for _, tag := range t.tags {
			if _, err := tx.Exec("INSERT INTO task_labels (task_id, label_id) VALUES (?, ?)", t.id, tag); err != nil {
				rollback()
				return false
			}
		}
	}

	// --- Full detail of 3 tasks: description + attachments + comments + events ---
	if err := os.MkdirAll(uploadsDir, 0o755); err != nil {
		rollback()
		return false
	}
	seedFiles := map[string]struct{ mime, content string }{
		"presupuesto-empresa-a.pdf":  {"application/pdf", "%PDF-1.4\n% Deltos (demo) - archivo ficticio\n% Presupuesto empresa A: reforma de baño.\n"},
		"presupuesto-empresa-b.pdf":  {"application/pdf", "%PDF-1.4\n% Deltos (demo) - archivo ficticio\n% Presupuesto empresa B: reforma de baño.\n"},
		"ventas-q3.xlsx":             {"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Deltos (demo) - archivo ficticio. Ventas Q3 por canal.\n"},
		"plantilla-presentacion.key": {"application/vnd.apple.keynote", "Deltos (demo) - archivo ficticio. Plantilla de presentación.\n"},
		"opciones-hotel.ods":         {"application/vnd.oasis.opendocument.spreadsheet", "Deltos (demo) - archivo ficticio. Cuatro opciones de hotel en Lisboa.\n"},
	}

	seq := 0
	ev := func(taskID, userID, typ, data string, at int64) {
		seq++
		_, _ = tx.Exec(
			"INSERT INTO activity_events (id, task_id, user_id, type, data, created_at) VALUES (?, ?, ?, ?, ?, ?)",
			fmt.Sprintf("seed-ev-%d", seq), taskID, userID, typ, data, at)
	}
	cm := func(taskID, userID, body string, at int64) {
		seq++
		_, _ = tx.Exec(
			"INSERT INTO comments (id, task_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)",
			fmt.Sprintf("seed-cm-%d", seq), taskID, userID, body, at)
	}
	at := func(taskID, userID, filename string, atT int64) {
		seq++
		meta := seedFiles[filename]
		stored := "seed-" + filename
		if err := os.WriteFile(filepath.Join(uploadsDir, stored), []byte(meta.content), 0o644); err != nil {
			return
		}
		_, _ = tx.Exec(
			"INSERT INTO attachments (id, task_id, filename, stored_name, size, mime, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
			fmt.Sprintf("seed-at-%d", seq), taskID, filename, stored, len(meta.content), meta.mime, userID, atT)
	}

	// t2 - Revisar presupuesto reforma baño
	_, _ = tx.Exec("UPDATE tasks SET description = ? WHERE id = ?",
		"Comparar los dos presupuestos del albañil y comprobar que incluyen fontanería, electricidad y alicatado. Confirmar plazos de ejecución antes de dar el visto bueno y pedir referencias de la segunda empresa, que es la que mejor precio tiene.", "t2")
	ev("t2", "mar", "created", "{}", now-8*dayMs)
	at("t2", "mar", "presupuesto-empresa-a.pdf", now-7*dayMs)
	ev("t2", "mar", "attachment", `{"filename":"presupuesto-empresa-a.pdf"}`, now-7*dayMs)
	at("t2", "jordi", "presupuesto-empresa-b.pdf", now-5*dayMs)
	ev("t2", "jordi", "attachment", `{"filename":"presupuesto-empresa-b.pdf"}`, now-5*dayMs)
	ev("t2", "jordi", "moved", `{"from":"nuevo","to":"encurso"}`, now-4*dayMs)
	cm("t2", "jordi", "El presupuesto B no incluye electricidad, se lo he pedido desglosado por email.", now-4*dayMs)
	ev("t2", "mar", "due", fmt.Sprintf(`{"from":null,"to":%q}`, dueStr(-2)), now-3*dayMs)
	cm("t2", "mar", "Vale, yo llamo mañana para pedir referencias de la empresa A antes de decidir.", now-2*dayMs)
	cm("t2", "jordi", "Referencias recibidas: dos reformas parecidas y buenas reseñas. Pinta bien.", now-1*dayMs)
	cm("t2", "mar", "Tenemos que decidirlo esta semana, que la fecha ya se nos ha echado encima.", now-5*60*60*1000)

	// t5 - Preparar presentación Q3
	_, _ = tx.Exec("UPDATE tasks SET description = ? WHERE id = ?",
		"Estructurar los resultados del trimestre y preparar las diapositivas clave para la reunión con dirección. Incluir gráficos de ventas por canal, comparativa con Q2 y propuesta de objetivos para Q4. Revisar los datos definitivos con Ana antes del martes.", "t5")
	ev("t5", "mar", "created", "{}", now-6*dayMs)
	ev("t5", "mar", "moved", `{"from":"nuevo","to":"encurso"}`, now-2*dayMs)
	at("t5", "mar", "ventas-q3.xlsx", now-2*dayMs)
	ev("t5", "mar", "attachment", `{"filename":"ventas-q3.xlsx"}`, now-2*dayMs)
	cm("t5", "mar", "Ya tengo los datos de ventas del trimestre, mañana preparo los gráficos por canal.", now-2*dayMs)
	ev("t5", "jordi", "priority", `{"from":"media","to":"alta"}`, now-1*dayMs)
	ev("t5", "mar", "due", fmt.Sprintf(`{"from":null,"to":%q}`, dueStr(0)), now-1*dayMs)
	at("t5", "jordi", "plantilla-presentacion.key", now-1*dayMs)
	ev("t5", "jordi", "attachment", `{"filename":"plantilla-presentacion.key"}`, now-1*dayMs)
	cm("t5", "jordi", "Genial, yo repaso la parte de objetivos de Q4 y te paso comentarios.", now-1*dayMs)
	cm("t5", "mar", "Subida la primera versión a la carpeta compartida, echadle un ojo cuando podáis.", now-3*60*60*1000)

	// t10 - Reservar hotel en Lisboa
	_, _ = tx.Exec("UPDATE tasks SET description = ? WHERE id = ?",
		"Buscar hotel céntrico para las cuatro noches del 12 al 16 de agosto, idealmente en Baixa o Chiado. Presupuesto máximo de 120 € por noche con desayuno incluido. Comprobar que tenga cancelación gratuita antes de confirmar la reserva.", "t10")
	ev("t10", "jordi", "created", "{}", now-5*dayMs)
	at("t10", "jordi", "opciones-hotel.ods", now-5*dayMs)
	ev("t10", "jordi", "attachment", `{"filename":"opciones-hotel.ods"}`, now-5*dayMs)
	cm("t10", "jordi", "He hecho una tabla con cuatro opciones; las dos primeras tienen cancelación gratuita.", now-4*dayMs)
	ev("t10", "jordi", "moved", `{"from":"nuevo","to":"encurso"}`, now-2*dayMs)
	ev("t10", "mar", "priority", `{"from":"media","to":"alta"}`, now-1*dayMs)
	ev("t10", "jordi", "due", fmt.Sprintf(`{"from":null,"to":%q}`, dueStr(4)), now-1*dayMs)
	cm("t10", "mar", "Me gusta la segunda, la de Chiado. La reservo esta noche si no me dices lo contrario.", now-1*dayMs)
	cm("t10", "jordi", "Perfecto, adelante. Guarda luego el justificante en la carpeta del viaje.", now-2*60*60*1000)

	// --- 3 example expenses (expenses plugin) ---
	insExpense := func(id, title string, amountCents int64, labelID, notes, payer, method, step string, spentAt, createdAt, updatedAt int64) {
		var methodArg any
		if method != "" {
			methodArg = method
		}
		_, _ = tx.Exec(
			`INSERT INTO expenses (id, title, amount_cents, label_id, notes, payer_id, payment_method, spent_at, step, position, created_by, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
			id, title, amountCents, labelID, notes, payer, methodArg, spentAt, step, payer, createdAt, updatedAt)
	}
	insShare := func(expenseID, userID string, shareCents int64, paid int) {
		_, _ = tx.Exec("INSERT INTO expense_shares (expense_id, user_id, share_cents, paid) VALUES (?, ?, ?, ?)", expenseID, userID, shareCents, paid)
	}
	insExpense("e1", "Compra semanal Mercadona", 8745, "l-compras",
		"Fruta, verdura, carne y productos de limpieza. Con vale descuento del 5%.", "mar", "bizum", "hecho", now-5*dayMs, now-5*dayMs, now-1*dayMs)
	insShare("e1", "mar", 4373, 1)
	insShare("e1", "jordi", 4372, 1)
	insExpense("e2", "Cena aniversario en La Tagliatella", 6230, "l-familia",
		"Menú degustación. Pedimos que nos pongan velitas en el postre.", "mar", "transfer", "en-curso", now-3*dayMs, now-3*dayMs, now-3*dayMs)
	insShare("e2", "mar", 2076, 1)
	insShare("e2", "demo", 2077, 1)
	insShare("e2", "jordi", 2077, 0)
	insExpense("e3", "Factura de la luz - julio", 14250, "l-admin",
		"Ha subido un 12% respecto al mes pasado. Revisar si es la nueva tarifa PVPC.", "jordi", "", "nuevo", now-1*dayMs, now-1*dayMs, now-1*dayMs)

	if err := tx.Commit(); err != nil {
		return false
	}
	log.Info("demo_seeded", "users", 3, "projects", 4, "labels", 6, "tasks", 15, "expenses", 3)
	return true
}
