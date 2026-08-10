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
      'INSERT INTO expense_invites (id, expense_id, token_hash, invite_name, share_cents, paid, notes, created_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)'
    ).run(id, expenseId, tokenHash, invite_name, share_cents, notes, now);

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
  log.info('invite_paid', { invite_id: invite.id, expense_id: invite.expense_id, payment_method });

  return c.json({ ok: true });
});
}
