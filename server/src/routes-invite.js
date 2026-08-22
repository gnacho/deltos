import crypto from 'node:crypto';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { logger } from './logger.js';
import { httpError } from './errors.js';
import { ERROR_CODES } from './error-codes.js';
import { resolveStep } from './routes-expenses.js';

const log = logger.child({ component: 'invite' });

const createSchema = z.object({
  invite_name: z.string().min(1).max(100),
  share_cents: z.number().int().min(0),
  expense_id: z.string().min(1).max(100),
  notes: z.string().max(500).optional().default(''),
});

function generateToken() {
  return crypto.randomUUID();
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function registerInviteRoutes(app, { prod }) {
  // GET /api/expenses/:id/invites — listar invitaciones de un gasto
  app.get('/api/expenses/:id/invites', (c) => {
    const user = c.get('user');
    if (!user) httpError(401, ERROR_CODES.AUTH_REQUIRED);
    const expenseId = c.req.param('id');
    const invites = prod.prepare(
      'SELECT id, invite_name, share_cents, paid, payment_method, notes, created_at FROM expense_invites WHERE expense_id = ? ORDER BY created_at'
    ).all(expenseId);
    return c.json({ invites });
  });

  // POST /api/invite/create — generar link de invitación (autenticado)
  app.post('/api/invite/create', zValidator('json', createSchema), (c) => {
    const user = c.get('user');
    if (!user) httpError(401, ERROR_CODES.AUTH_REQUIRED);
    const { invite_name, share_cents, expense_id: expenseId, notes } = c.req.valid('json');

    const expense = prod.prepare(
      'SELECT id, created_by, amount_cents FROM expenses WHERE id = ? AND deleted_at IS NULL'
    ).get(expenseId);
    if (!expense) httpError(404, ERROR_CODES.EXPENSE_NOT_FOUND);

    const token = generateToken();
    const tokenHash = hashToken(token);
    const id = crypto.randomUUID();
    const now = Date.now();

    prod.prepare(
      'INSERT INTO expense_invites (id, expense_id, token_hash, invite_name, share_cents, paid, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, expenseId, tokenHash, invite_name, share_cents, 0, notes, now);

    /* Auto-transición (#113): un reparto con invitaciones pendientes es
       "Repartido" (en-curso); si todo está pagado, "Pagado" (hecho). */
    const cur = prod.prepare('SELECT step, payer_id FROM expenses WHERE id = ?').get(expenseId);
    const newStep = resolveStep(prod, expenseId, cur.payer_id, cur.step);
    if (newStep !== cur.step) {
      prod.prepare('UPDATE expenses SET step = ?, updated_at = ? WHERE id = ?').run(newStep, now, expenseId);
    }

    log.info('invite_created', { expense_id: expenseId, invite_id: id, actor: user.id, step: newStep });

    return c.json({
      invite: {
        id,
        expense_id: expenseId,
        invite_name,
        share_cents,
        paid: false,
        notes,
        token,
        url: `${c.req.header('origin') || ''}/invite/${token}`,
      },
    }, 201);
  });

  // GET /api/invite/:token — ver gasto y parte (público, sin auth)
  app.get('/api/invite/:token', (c) => {
    const rawToken = c.req.param('token');
    if (!rawToken || rawToken.length > 200) httpError(404, ERROR_CODES.EXPENSE_NOT_FOUND);

    const tokenHash = hashToken(rawToken);
    const invite = prod.prepare('SELECT * FROM expense_invites WHERE token_hash = ?').get(tokenHash);
    if (!invite) httpError(404, ERROR_CODES.EXPENSE_NOT_FOUND);

    const expense = prod.prepare(
      'SELECT e.id, e.title, e.amount_cents, e.payment_method, e.step, e.payer_id, e.notes, u.username AS created_by_username FROM expenses e JOIN users u ON u.id = e.created_by WHERE e.id = ? AND e.deleted_at IS NULL'
    ).get(invite.expense_id);
    if (!expense) httpError(404, ERROR_CODES.EXPENSE_NOT_FOUND);

    return c.json({
      expense: {
        ...expense,
        notes: expense.notes || '',
      },
      invite: {
        id: invite.id,
        invite_name: invite.invite_name,
        share_cents: invite.share_cents,
        paid: !!invite.paid,
        payment_method: invite.payment_method || null,
        notes: invite.notes || '',
      },
      attachments: prod.prepare(
        'SELECT id, filename, size, mime FROM expense_attachments WHERE expense_id = ? ORDER BY created_at'
      ).all(invite.expense_id),
      activity: prod.prepare(
        `SELECT ae.id, ae.type, ae.data, ae.created_at, u.username
         FROM expense_activity_events ae
         JOIN users u ON u.id = ae.user_id
         WHERE ae.expense_id = ?
         ORDER BY ae.created_at DESC
         LIMIT 50`
      ).all(invite.expense_id),
      comments: prod.prepare(
        `SELECT c.id, c.body, c.created_at, u.username, u.color AS user_color, c.author_name
         FROM expense_comments c LEFT JOIN users u ON u.id = c.user_id
         WHERE c.expense_id = ?
         ORDER BY c.created_at`
      ).all(invite.expense_id).map((c) => ({ ...c, username: c.username || c.author_name || '?' })),
    });
  });

const paySchema = z.object({
  payment_method: z.enum(['bizum', 'transfer', 'efectivo']).optional(),
});

// PUT /api/invite/:token/pay — marcar como pagado (público, sin auth)
app.put('/api/invite/:token/pay', zValidator('json', paySchema), (c) => {
  const rawToken = c.req.param('token');
  if (!rawToken || rawToken.length > 200) httpError(404, ERROR_CODES.EXPENSE_NOT_FOUND);

  const tokenHash = hashToken(rawToken);
  const invite = prod.prepare('SELECT * FROM expense_invites WHERE token_hash = ?').get(tokenHash);
  if (!invite) httpError(404, ERROR_CODES.EXPENSE_NOT_FOUND);

  if (invite.paid) {
    return c.json({ ok: true, already_paid: true });
  }

  const { payment_method } = c.req.valid('json');

  prod.prepare(
    'UPDATE expense_invites SET paid = 1, payment_method = ? WHERE id = ?'
  ).run(payment_method || null, invite.id);

  // Auto-transición (#113): si todas las partes + invitaciones están pagadas → Pagado;
  // si quedan pendientes y está en Nuevo → Repartido.
  const exp = prod.prepare('SELECT step, payer_id FROM expenses WHERE id = ?').get(invite.expense_id);
  const newStep = resolveStep(prod, invite.expense_id, exp.payer_id, exp.step);
  if (newStep !== exp.step) {
    prod.prepare('UPDATE expenses SET step = ?, updated_at = ? WHERE id = ?').run(newStep, Date.now(), invite.expense_id);
  }

  log.info('invite_paid', { invite_id: invite.id, expense_id: invite.expense_id, payment_method, step: newStep });

  return c.json({ ok: true });
});

// POST /api/invite/:token/comments — añadir comentario como invitado (público)
const inviteCommentSchema = z.object({ body: z.string().min(1).max(5000) });
app.post('/api/invite/:token/comments', zValidator('json', inviteCommentSchema), (c) => {
  const rawToken = c.req.param('token');
  if (!rawToken || rawToken.length > 200) httpError(404, ERROR_CODES.EXPENSE_NOT_FOUND);

  const tokenHash = hashToken(rawToken);
  const invite = prod.prepare('SELECT * FROM expense_invites WHERE token_hash = ?').get(tokenHash);
  if (!invite) httpError(404, ERROR_CODES.EXPENSE_NOT_FOUND);

  const { body } = c.req.valid('json');
  const id = crypto.randomUUID();
  const now = Date.now();

  prod.prepare(
    'INSERT INTO expense_comments (id, expense_id, user_id, author_name, body, created_at) VALUES (?, ?, NULL, ?, ?, ?)'
  ).run(id, invite.expense_id, invite.invite_name, body, now);

  log.info('invite_comment', { invite_id: invite.id, expense_id: invite.expense_id });

  return c.json({ ok: true }, 201);
});

// DELETE /api/invite/:id — revocar invitación (autenticado)
app.delete('/api/invite/:id', (c) => {
  const user = c.get('user');
  if (!user) httpError(401, ERROR_CODES.AUTH_REQUIRED);
  const inviteId = c.req.param('id');
  const invite = prod.prepare(
    'SELECT i.id, i.expense_id FROM expense_invites i JOIN expenses e ON e.id = i.expense_id WHERE i.id = ?'
  ).get(inviteId);
  if (!invite) httpError(404, ERROR_CODES.EXPENSE_NOT_FOUND);

  const expense = prod.prepare(
    'SELECT created_by, payer_id, step FROM expenses WHERE id = ? AND deleted_at IS NULL'
  ).get(invite.expense_id);
  if (!expense) httpError(404, ERROR_CODES.EXPENSE_NOT_FOUND);

  prod.prepare('DELETE FROM expense_invites WHERE id = ?').run(inviteId);

  /* Recomputar la fase: si al revocar ya no queda reparto declarado (ni shares
     ni invites), vuelve a "Nuevo"; si queda reparto, se resuelve normalmente. */
  const remaining = prod.prepare(
    `SELECT (SELECT COUNT(*) FROM expense_shares WHERE expense_id = ?)
          + (SELECT COUNT(*) FROM expense_invites WHERE expense_id = ?) AS n`
  ).get(invite.expense_id, invite.expense_id);
  const newStep =
    (remaining?.n ?? 0) === 0
      ? 'nuevo'
      : resolveStep(prod, invite.expense_id, expense.payer_id, expense.step);
  if (newStep !== expense.step) {
    prod.prepare('UPDATE expenses SET step = ?, updated_at = ? WHERE id = ?').run(newStep, Date.now(), invite.expense_id);
  }

  log.info('invite_revoked', { invite_id: inviteId, expense_id: invite.expense_id, actor: user.id, step: newStep });

  return c.json({ ok: true });
});
}
