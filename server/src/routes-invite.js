import { Hono } from 'hono';
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
});

function generateToken() {
  return crypto.randomUUID();
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function inviteRoutes(db, demo) {
  const router = new Hono();

  // POST /api/expenses/:id/invite — generar link de invitación (autenticado)
  router.post('/api/expenses/:id/invite', zValidator('json', createSchema), (c) => {
    const expenseId = c.req.param('id');
    const user = c.get('user');
    if (!user) httpError(401, ERROR_CODES.AUTH_REQUIRED);
    const { invite_name, share_cents } = c.req.valid('json');

    const expense = db.prepare('SELECT id, created_by, amount_cents FROM expenses WHERE id = ? AND deleted_at IS NULL').get(expenseId);
    if (!expense) httpError(404, ERROR_CODES.EXPENSE_NOT_FOUND);

    const token = generateToken();
    const tokenHash = hashToken(token);
    const id = crypto.randomUUID();
    const now = Date.now();

    db.prepare(
      'INSERT INTO expense_invites (id, expense_id, token_hash, invite_name, share_cents, paid, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)'
    ).run(id, expenseId, tokenHash, invite_name, share_cents, now);

    log.info('invite_created', { expense_id: expenseId, invite_id: id, actor: user.id });

    return c.json({
      invite: {
        id,
        expense_id: expenseId,
        invite_name,
        share_cents,
        paid: false,
        token,
        url: `${c.req.header('origin') || ''}/invite/${token}`,
      },
    }, 201);
  });

  // DELETE /api/expenses/:id/invite — revocar invitación (autenticado vía middleware global)
  router.delete('/api/invite/:inviteId', (c) => {
    const user = c.get('user');
    if (!user) httpError(401, ERROR_CODES.AUTH_REQUIRED);
    const inviteId = c.req.param('inviteId');
    const invite = db.prepare('SELECT * FROM expense_invites WHERE id = ?').get(inviteId);
    if (!invite) httpError(404, ERROR_CODES.EXPENSE_NOT_FOUND);

    const expense = db.prepare('SELECT id, created_by FROM expenses WHERE id = ?').get(invite.expense_id);
    if (expense.created_by !== user.id && user.role !== 'admin') httpError(403, ERROR_CODES.PROJECT_NOT_OWNER);

    db.prepare('DELETE FROM expense_invites WHERE id = ?').run(inviteId);
    log.info('invite_revoked', { invite_id: inviteId, actor: user.id });
    return c.json({ ok: true });
  });

  // GET /api/invite/:token — ver gasto y parte (público, sin auth)
  router.get('/api/invite/:token', (c) => {
    const rawToken = c.req.param('token');
    if (!rawToken || rawToken.length > 200) httpError(404, ERROR_CODES.EXPENSE_NOT_FOUND);

    const tokenHash = hashToken(rawToken);
    const invite = db.prepare('SELECT * FROM expense_invites WHERE token_hash = ?').get(tokenHash);
    if (!invite) httpError(404, ERROR_CODES.EXPENSE_NOT_FOUND);

    const expense = db.prepare(
      'SELECT id, title, amount_cents, payment_method, step, created_by_username, payer_id, notes FROM expenses WHERE id = ? AND deleted_at IS NULL'
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
      },
    });
  });

  // PUT /api/invite/:token/pay — marcar como pagado (público, sin auth)
  router.put('/api/invite/:token/pay', (c) => {
    const rawToken = c.req.param('token');
    if (!rawToken || rawToken.length > 200) httpError(404, ERROR_CODES.EXPENSE_NOT_FOUND);

    const tokenHash = hashToken(rawToken);
    const invite = db.prepare('SELECT * FROM expense_invites WHERE token_hash = ?').get(tokenHash);
    if (!invite) httpError(404, ERROR_CODES.EXPENSE_NOT_FOUND);

    if (invite.paid) {
      return c.json({ ok: true, already_paid: true });
    }

    db.prepare('UPDATE expense_invites SET paid = 1 WHERE id = ?').run(invite.id);
    log.info('invite_paid', { invite_id: invite.id, expense_id: invite.expense_id });

    return c.json({ ok: true });
  });

  return router;
}
