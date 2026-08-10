import crypto from 'node:crypto';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { logger } from './logger.js';
import { httpError } from './errors.js';
import { ERROR_CODES } from './error-codes.js';

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
      'INSERT INTO expense_invites (id, expense_id, token_hash, token, invite_name, share_cents, paid, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)'
    ).run(id, expenseId, tokenHash, token, invite_name, share_cents, notes, now);

    log.info('invite_created', { expense_id: expenseId, invite_id: id, actor: user.id });

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

  // GET /api/invite/:id/link — recuperar enlace de invitación (autenticado)
  app.get('/api/invite/:id/link', (c) => {
    const user = c.get('user');
    if (!user) httpError(401, ERROR_CODES.AUTH_REQUIRED);
    const inviteId = c.req.param('id');
    const invite = prod.prepare(
      'SELECT i.id, i.token, i.expense_id, e.created_by FROM expense_invites i JOIN expenses e ON e.id = i.expense_id WHERE i.id = ?'
    ).get(inviteId);
    if (!invite || !invite.token) httpError(404, ERROR_CODES.EXPENSE_NOT_FOUND);
    return c.json({
      url: `${c.req.header('origin') || ''}/invite/${encodeURIComponent(invite.token)}`,
    });
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

  // Auto-transición: si todas las partes + invitaciones están pagadas → Pagado
  const pending = prod.prepare(
    `SELECT (SELECT COUNT(*) FROM expense_shares WHERE expense_id = ? AND user_id != (SELECT payer_id FROM expenses WHERE id = ?) AND paid = 0)
          + (SELECT COUNT(*) FROM expense_invites WHERE expense_id = ? AND paid = 0) AS total`
  ).get(invite.expense_id, invite.expense_id, invite.expense_id);
  if ((pending?.total ?? 0) === 0) {
    prod.prepare('UPDATE expenses SET step = ?, updated_at = ? WHERE id = ?').run('hecho', Date.now(), invite.expense_id);
  } else {
    // Si hay pendientes y el gasto está en 'nuevo', pasarlo a 'en-curso' (Repartido)
    const exp = prod.prepare('SELECT step FROM expenses WHERE id = ?').get(invite.expense_id);
    if (exp && exp.step === 'nuevo') {
      prod.prepare('UPDATE expenses SET step = ?, updated_at = ? WHERE id = ?').run('en-curso', Date.now(), invite.expense_id);
    }
  }

  log.info('invite_paid', { invite_id: invite.id, expense_id: invite.expense_id, payment_method });

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
}
