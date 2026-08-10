# Deltos — Expense Plugin Roadmap

## Estado actual (rama `feat/55-expense-plugin`)

### Backend (completo)
- [x] Tabla `expenses` con migración aditiva (`PRAGMA table_info`)
- [x] CRUD completo: `POST/GET/PUT/DELETE /api/expenses/:id`
- [x] Move: `PUT /api/expenses/:id/move` (entre columnas + reordenar)
- [x] Gate `plugin_expenses_enabled` (KV): OFF → 404 en todas las rutas
- [x] Soft-delete + papelera (`GET /api/trash`, restore, borrado físico)
- [x] Export ampliado (`/api/export`) incluye `expenses` y `expense_trash`
- [x] Purga automática (hourlyMaintenance): expenses > 30 días en papelera
- [x] Push: tipos `pago_requerido` y `pago_completado` con i18n ES/EN
- [x] Toggle de notificaciones por tipo en preferencias
- [x] Demo seed: 3 gastos de ejemplo (e1 hecho, e2 en-curso, e3 nuevo)
- [x] Error codes: `EXPENSE_NOT_FOUND`
- [x] Tests backend: 123/123 (sin añadir tests específicos de expenses aún)

### Frontend (completo)
- [x] Tipos: `Expense`, `ExpenseStep`, `ExpenseSplitType`, `PaymentMethod`, `ExpenseInput`, `ExpensePatch`
- [x] DataProvider: `fetchExpenses()`, SSE `expenses.changed`, mutadores CRUD
- [x] Ruta `/expenses` en App.tsx con lazy loading
- [x] Sidebar: entrada "Gastos" con icono `Receipt`
- [x] ExpenseBoard: tablero kanban 3 columnas (nuevo/en-curso/hecho) + filtros
- [x] ExpenseCard: título, importe, categoría, badges (pagado/requerido/split), avatar
- [x] ExpenseModal: formulario crear/editar con split (mitad/custom/totalidad)
- [x] Métodos de pago: bizum, transferencia, efectivo
- [x] "He pagado mi parte" para el usuario requerido
- [x] Auto-transición a "hecho" cuando ambos pagan
- [x] Toggle plugin en AdminBar (Ajustes > Administración)
- [x] i18n ES/EN: expenses.*, payment methods, plugin toggle, notifTipos
- [x] TypeScript compila limpio

### Pendiente antes de release
- [ ] Tests backend: añadir `expenses.test.js` (CRUD, trash, export, gate plugin OFF, push)
- [ ] Deploy en CT 226 y verificación E2E
- [ ] Bump versión en CHANGELOG + package.json (server + app)
- [ ] Release en GitHub

### Ideas futuras (fuera de alcance inicial)
- [ ] Drag & drop entre columnas (ahora solo botones de step)
- [ ] Totales por filtro / mes en el tablero de gastos
- [ ] Export CSV de gastos
- [ ] Plantillas de gastos recurrentes
- [ ] Fotos de tickets/recibos como adjuntos

---

## Definición del plugin

### Modelo `expenses`

| Campo | Tipo | Notas |
|---|---|---|
| `id` | TEXT PK | UUID |
| `title` | TEXT | Descripción del gasto |
| `amount_cents` | INTEGER | Importe en céntimos (sin decimales) |
| `label_id` | INTEGER → labels | Categoría reutilizando el sistema de labels |
| `notes` | TEXT | |
| `paid_by_creator` | INTEGER 0/1 | El creador ya ha pagado |
| `requested_user_id` | INTEGER → users | A quién se le pide reembolso |
| `split_type` | half/custom/full | Cómo se divide el pago |
| `split_amount_cents` | INTEGER | Solo si split_type=custom |
| `paid_by_requested` | INTEGER 0/1 | El otro ha pagado su parte |
| `payment_method` | bizum/transfer/efectivo | Método de pago |
| `step` | nuevo/en-curso/hecho | Columna kanban |
| `position` | INTEGER | Orden dentro de la columna |
| `created_by` | INTEGER → users | |
| `created_at` | INTEGER | Epoch ms |
| `updated_at` | INTEGER | Epoch ms |
| `deleted_at` | INTEGER | Soft-delete |

### Transiciones de step

- `nuevo → en-curso`: manual
- `en-curso → hecho`: **automático** cuando `paid_by_creator=1 AND (requested_user_id IS NULL OR paid_by_requested=1)`
- `hecho → en-curso`: manual (reabrir)

### Flujo de creación

1. Usuario crea gasto con título, importe, categoría (label), notas, método de pago
2. Opcionalmente marca "yo ya he pagado"
3. Opcionalmente requiere pago a otro usuario con split (mitad/custom/totalidad)
4. Si requiere pago → notificación push al otro usuario
5. El otro usuario abre el gasto y pulsa "He pagado mi parte"
6. Si ambos han pagado → auto-transición a "hecho"

### Decisiones

- Gastos **GLOBALES** (sin proyecto): viven en `/expenses`, no dentro de un proyecto
- Categorías reutilizan el sistema de labels existente
- "Finalizado" = ambos han pagado
- Plugin activable/desactivable desde Ajustes (admin), default OFF
