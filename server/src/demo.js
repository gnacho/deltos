// demo.js — seed determinista de la BD demo (app_demo.db), dataset del mockup.
// Producción arranca VACÍA: este seed SOLO se aplica a la BD demo, nunca a la real.
// Las fechas son relativas a HOY (misma filosofía que los mocks), así el tablero
// demo siempre muestra vencidas / hoy / futuras / sin fecha.
import fs from 'node:fs'
import path from 'node:path'
import bcrypt from 'bcryptjs'
import { logger } from './logger.js'

const log = logger.child({ component: 'demo' })

const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000

function dueStr(offsetDays) {
  const d = new Date(Date.now() + offsetDays * DAY)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Contenido ficticio de los adjuntos sembrados (archivos reales en uploads/).
const SEED_FILES = {
  'presupuesto-empresa-a.pdf': {
    mime: 'application/pdf',
    content: '%PDF-1.4\n% Deltos (demo) — archivo ficticio\n% Presupuesto empresa A: reforma de baño.\n',
  },
  'presupuesto-empresa-b.pdf': {
    mime: 'application/pdf',
    content: '%PDF-1.4\n% Deltos (demo) — archivo ficticio\n% Presupuesto empresa B: reforma de baño.\n',
  },
  'ventas-q3.xlsx': {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    content: 'Deltos (demo) — archivo ficticio. Ventas Q3 por canal.\n',
  },
  'plantilla-presentacion.key': {
    mime: 'application/vnd.apple.keynote',
    content: 'Deltos (demo) — archivo ficticio. Plantilla de presentación.\n',
  },
  'opciones-hotel.ods': {
    mime: 'application/vnd.oasis.opendocument.spreadsheet',
    content: 'Deltos (demo) — archivo ficticio. Cuatro opciones de hotel en Lisboa.\n',
  },
}

// Seed idempotente: solo si la BD demo está vacía (sin usuarios).
export function seedDemo(db, uploadsDir) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n
  if (count > 0) return false

  const now = Date.now()
  const hash = bcrypt.hashSync('deltos-demo', 10) // contraseña de mar/jordi (documentada en README)

  const tx = db.transaction(() => {
    // --- Usuarios: Mar / Jordi + demo (sin contraseña usable) ---
    const insUser = db.prepare(
      'INSERT INTO users (id, username, display_name, password_hash, color, language, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    insUser.run('mar', 'mar', 'Mar', hash, 'violet', 'auto', 'admin', now - 30 * DAY)
    insUser.run('jordi', 'jordi', 'Jordi', hash, 'teal', 'auto', 'user', now - 30 * DAY)
    insUser.run('demo', 'demo', 'Demo', '!sin-contraseña', 'slate', 'auto', 'user', now - 30 * DAY)

    // --- Proyectos (4, del mockup). Demo = proyecto compartido: los 3
    // usuarios son miembros de los 4, para que la demo siga mostrando datos.
    const insProject = db.prepare(
      'INSERT INTO projects (id, name, emoji, color, position, owner_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    const insMember = db.prepare(
      'INSERT INTO project_members (project_id, user_id, role, added_at) VALUES (?, ?, ?, ?)'
    )
    const seedProject = (id, name, emoji, color, pos, owner) => {
      insProject.run(id, name, emoji, color, pos, owner, now - 30 * DAY)
      // owner
      insMember.run(id, owner, 'owner', now - 30 * DAY)
      // los demás usuarios (incluida demo) como miembros
      for (const u of ['mar', 'jordi', 'demo']) if (u !== owner) insMember.run(id, u, 'member', now - 30 * DAY)
    }
    seedProject('p-casa', 'Casa', 'home', 'sky', 0, 'mar')
    seedProject('p-trabajo', 'Trabajo', 'briefcase', 'blue', 1, 'mar')
    seedProject('p-viaje', 'Viaje a Lisboa', 'plane', 'amber', 2, 'jordi')
    seedProject('p-huerto', 'Huerto', 'sprout', 'emerald', 3, 'jordi')

    // --- Etiquetas globales (6) ---
    const insLabel = db.prepare('INSERT INTO labels (id, name, color) VALUES (?, ?, ?)')
    insLabel.run('l-urgente', 'Urgente', 'rose')
    insLabel.run('l-compras', 'Compras', 'amber')
    insLabel.run('l-admin', 'Admin', 'blue')
    insLabel.run('l-diseno', 'Diseño', 'violet')
    insLabel.run('l-dev', 'Dev', 'cyan')
    insLabel.run('l-familia', 'Familia', 'pink')

    // --- 15 tareas repartidas en las 3 columnas (dataset del mockup) ---
    // due: offset en días relativo a hoy (null = sin fecha)
    const TASKS = [
      { id: 't1',  project: 'p-casa',    title: 'Pedir cita ITV',                       col: 'nuevo',   pr: 'alta',  due: 3,    as: 'mar',   tags: ['l-admin'],               by: 'mar',   created: -9 },
      { id: 't2',  project: 'p-casa',    title: 'Revisar presupuesto reforma baño',     col: 'encurso', pr: 'media', due: -2,   as: 'jordi', tags: ['l-admin', 'l-urgente'],  by: 'mar',   created: -8 },
      { id: 't3',  project: 'p-casa',    title: 'Comprar bombillas para el recibidor',  col: 'hecho',   pr: 'baja',  due: null, as: 'mar',   tags: ['l-compras'],             by: 'mar',   created: -12 },
      { id: 't4',  project: 'p-casa',    title: 'Llamar al seguro del coche',           col: 'nuevo',   pr: 'media', due: 10,   as: null,    tags: ['l-admin'],               by: 'jordi', created: -3 },
      { id: 't5',  project: 'p-trabajo', title: 'Preparar presentación Q3',             col: 'encurso', pr: 'alta',  due: 0,    as: 'mar',   tags: ['l-diseno'],              by: 'mar',   created: -6 },
      { id: 't6',  project: 'p-trabajo', title: 'Enviar factura de julio al cliente',   col: 'nuevo',   pr: 'alta',  due: 1,    as: 'mar',   tags: ['l-admin', 'l-urgente'],  by: 'mar',   created: -2 },
      { id: 't7',  project: 'p-trabajo', title: 'Actualizar CV',                        col: 'nuevo',   pr: 'baja',  due: null, as: null,    tags: [],                        by: 'jordi', created: -15 },
      { id: 't8',  project: 'p-trabajo', title: 'Corregir bug de inicio de sesión',     col: 'encurso', pr: 'media', due: 5,    as: 'jordi', tags: ['l-dev', 'l-urgente'],    by: 'jordi', created: -4 },
      { id: 't9',  project: 'p-trabajo', title: 'Preparar retro del sprint 12',         col: 'hecho',   pr: 'baja',  due: -1,   as: 'jordi', tags: ['l-dev'],                 by: 'jordi', created: -10 },
      { id: 't10', project: 'p-viaje',   title: 'Reservar hotel en Lisboa',             col: 'encurso', pr: 'alta',  due: 4,    as: 'mar',   tags: ['l-familia'],             by: 'jordi', created: -5 },
      { id: 't11', project: 'p-viaje',   title: 'Sacar billetes de tren',               col: 'nuevo',   pr: 'media', due: 7,    as: 'jordi', tags: ['l-compras'],             by: 'mar',   created: -1 },
      { id: 't12', project: 'p-viaje',   title: 'Hacer lista de restaurantes',          col: 'hecho',   pr: 'baja',  due: null, as: 'mar',   tags: ['l-familia'],             by: 'mar',   created: -7 },
      { id: 't13', project: 'p-huerto',  title: 'Comprar sustrato y semillas',          col: 'hecho',   pr: 'media', due: -2,   as: 'jordi', tags: ['l-compras'],             by: 'jordi', created: -11 },
      { id: 't14', project: 'p-huerto',  title: 'Montar riego por goteo',               col: 'nuevo',   pr: 'media', due: 12,   as: 'jordi', tags: [],                        by: 'mar',   created: -2 },
      { id: 't15', project: 'p-huerto',  title: 'Trasplantar tomateras',                col: 'encurso', pr: 'baja',  due: 2,    as: 'mar',   tags: [],                        by: 'mar',   created: -3 },
    ]

    // Posición global por columna (orden de la lista anterior)
    const colPos = { nuevo: 0, encurso: 0, hecho: 0 }
    const insTask = db.prepare(
      `INSERT INTO tasks (id, project_id, title, description, "column", position, priority, due_date, assignee_id, created_by, created_at, updated_at)
       VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    const insTaskLabel = db.prepare('INSERT INTO task_labels (task_id, label_id) VALUES (?, ?)')
    for (const t of TASKS) {
      const createdAt = now + t.created * DAY
      insTask.run(
        t.id, t.project, t.title, t.col, colPos[t.col]++, t.pr,
        t.due === null ? null : dueStr(t.due), t.as, t.by, createdAt, createdAt
      )
      for (const tag of t.tags) insTaskLabel.run(t.id, tag)
    }

    // --- Detalle completo de 3 tareas: descripción + adjuntos + comentarios + eventos ---
    const insEvent = db.prepare(
      'INSERT INTO activity_events (id, task_id, user_id, type, data, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    const insComment = db.prepare(
      'INSERT INTO comments (id, task_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)'
    )
    const insAttachment = db.prepare(
      'INSERT INTO attachments (id, task_id, filename, stored_name, size, mime, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    fs.mkdirSync(uploadsDir, { recursive: true })
    let seq = 0
    const ev = (taskId, userId, type, data, at) =>
      insEvent.run(`seed-ev-${++seq}`, taskId, userId, type, JSON.stringify(data), at)
    const cm = (taskId, userId, body, at) =>
      insComment.run(`seed-cm-${++seq}`, taskId, userId, body, at)
    const at2 = (taskId, userId, filename, at) => {
      const meta = SEED_FILES[filename]
      const stored = `seed-${filename}`
      fs.writeFileSync(path.join(uploadsDir, stored), meta.content, 'utf8')
      insAttachment.run(`seed-at-${++seq}`, taskId, filename, stored, Buffer.byteLength(meta.content), meta.mime, userId, at)
    }

    // t2 — Revisar presupuesto reforma baño
    db.prepare('UPDATE tasks SET description = ? WHERE id = ?').run(
      'Comparar los dos presupuestos del albañil y comprobar que incluyen fontanería, electricidad y alicatado. Confirmar plazos de ejecución antes de dar el visto bueno y pedir referencias de la segunda empresa, que es la que mejor precio tiene.',
      't2'
    )
    ev('t2', 'mar', 'created', {}, now - 8 * DAY)
    at2('t2', 'mar', 'presupuesto-empresa-a.pdf', now - 7 * DAY)
    ev('t2', 'mar', 'attachment', { filename: 'presupuesto-empresa-a.pdf' }, now - 7 * DAY)
    at2('t2', 'jordi', 'presupuesto-empresa-b.pdf', now - 5 * DAY)
    ev('t2', 'jordi', 'attachment', { filename: 'presupuesto-empresa-b.pdf' }, now - 5 * DAY)
    ev('t2', 'jordi', 'moved', { from: 'nuevo', to: 'encurso' }, now - 4 * DAY)
    cm('t2', 'jordi', 'El presupuesto B no incluye electricidad, se lo he pedido desglosado por email.', now - 4 * DAY)
    ev('t2', 'mar', 'due', { from: null, to: dueStr(-2) }, now - 3 * DAY)
    cm('t2', 'mar', 'Vale, yo llamo mañana para pedir referencias de la empresa A antes de decidir.', now - 2 * DAY)
    cm('t2', 'jordi', 'Referencias recibidas: dos reformas parecidas y buenas reseñas. Pinta bien.', now - 1 * DAY)
    cm('t2', 'mar', 'Tenemos que decidirlo esta semana, que la fecha ya se nos ha echado encima.', now - 5 * HOUR)

    // t5 — Preparar presentación Q3
    db.prepare('UPDATE tasks SET description = ? WHERE id = ?').run(
      'Estructurar los resultados del trimestre y preparar las diapositivas clave para la reunión con dirección. Incluir gráficos de ventas por canal, comparativa con Q2 y propuesta de objetivos para Q4. Revisar los datos definitivos con Ana antes del martes.',
      't5'
    )
    ev('t5', 'mar', 'created', {}, now - 6 * DAY)
    ev('t5', 'mar', 'moved', { from: 'nuevo', to: 'encurso' }, now - 2 * DAY)
    at2('t5', 'mar', 'ventas-q3.xlsx', now - 2 * DAY)
    ev('t5', 'mar', 'attachment', { filename: 'ventas-q3.xlsx' }, now - 2 * DAY)
    cm('t5', 'mar', 'Ya tengo los datos de ventas del trimestre, mañana preparo los gráficos por canal.', now - 2 * DAY)
    ev('t5', 'jordi', 'priority', { from: 'media', to: 'alta' }, now - 1 * DAY)
    ev('t5', 'mar', 'due', { from: null, to: dueStr(0) }, now - 1 * DAY)
    at2('t5', 'jordi', 'plantilla-presentacion.key', now - 1 * DAY)
    ev('t5', 'jordi', 'attachment', { filename: 'plantilla-presentacion.key' }, now - 1 * DAY)
    cm('t5', 'jordi', 'Genial, yo repaso la parte de objetivos de Q4 y te paso comentarios.', now - 1 * DAY)
    cm('t5', 'mar', 'Subida la primera versión a la carpeta compartida, echadle un ojo cuando podáis.', now - 3 * HOUR)

    // t10 — Reservar hotel en Lisboa
    db.prepare('UPDATE tasks SET description = ? WHERE id = ?').run(
      'Buscar hotel céntrico para las cuatro noches del 12 al 16 de agosto, idealmente en Baixa o Chiado. Presupuesto máximo de 120 € por noche con desayuno incluido. Comprobar que tenga cancelación gratuita antes de confirmar la reserva.',
      't10'
    )
    ev('t10', 'jordi', 'created', {}, now - 5 * DAY)
    at2('t10', 'jordi', 'opciones-hotel.ods', now - 5 * DAY)
    ev('t10', 'jordi', 'attachment', { filename: 'opciones-hotel.ods' }, now - 5 * DAY)
    cm('t10', 'jordi', 'He hecho una tabla con cuatro opciones; las dos primeras tienen cancelación gratuita.', now - 4 * DAY)
    ev('t10', 'jordi', 'moved', { from: 'nuevo', to: 'encurso' }, now - 2 * DAY)
    ev('t10', 'mar', 'priority', { from: 'media', to: 'alta' }, now - 1 * DAY)
    ev('t10', 'jordi', 'due', { from: null, to: dueStr(4) }, now - 1 * DAY)
    cm('t10', 'mar', 'Me gusta la segunda, la de Chiado. La reservo esta noche si no me dices lo contrario.', now - 1 * DAY)
    cm('t10', 'jordi', 'Perfecto, adelante. Guarda luego el justificante en la carpeta del viaje.', now - 2 * HOUR)

    // --- 3 gastos de ejemplo (plugin expenses) ---
    const insExpense = db.prepare(
      `INSERT INTO expenses (id, title, amount_cents, label_id, notes, payer_id,
       payment_method, spent_at, step, position, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    const insShare = db.prepare(
      'INSERT INTO expense_shares (expense_id, user_id, share_cents, paid) VALUES (?, ?, ?, ?)'
    )
    // e1: Súper, pagó mar, a medias con jordi, todo pagado → hecho
    insExpense.run('e1', 'Compra semanal Mercadona', 8745, 'l-compras',
      'Fruta, verdura, carne y productos de limpieza. Con vale descuento del 5%.',
      'mar', 'bizum', now - 5 * DAY, 'hecho', 0, 'mar', now - 5 * DAY, now - 1 * DAY)
    insShare.run('e1', 'mar', 4373, 1)
    insShare.run('e1', 'jordi', 4372, 1)
    // e2: Cena a tres, pagó mar; nacho pagó su parte, jordi debe → en-curso
    insExpense.run('e2', 'Cena aniversario en La Tagliatella', 6230, 'l-familia',
      'Menú degustación. Pedimos que nos pongan velitas en el postre.',
      'mar', 'transfer', now - 3 * DAY, 'en-curso', 0, 'mar', now - 3 * DAY, now - 3 * DAY)
    insShare.run('e2', 'mar', 2076, 1)
    insShare.run('e2', 'demo', 2077, 1)
    insShare.run('e2', 'jordi', 2077, 0)
    // e3: Factura de la luz, sin partes declaradas todavía → nuevo
    insExpense.run('e3', 'Factura de la luz — julio', 14250, 'l-admin',
      'Ha subido un 12% respecto al mes pasado. Revisar si es la nueva tarifa PVPC.',
      'jordi', null, now - 1 * DAY, 'nuevo', 0, 'jordi', now - 1 * DAY, now - 1 * DAY)
  })

  tx()
  // Dataset determinista del mockup: 3 usuarios, 4 proyectos, 6 etiquetas, 15 tareas
  log.info('demo_seeded', { users: 3, projects: 4, labels: 6, tasks: 15, expenses: 3 })
  return true
}
