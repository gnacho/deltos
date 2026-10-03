import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Check, Plus, RotateCcw, ThumbsUp, Pencil } from 'lucide-react';
import { motion, MotionConfig } from 'framer-motion';
import type { FormEvent } from 'react';
import { useData } from '@/data/data-context';
import { useSession } from '@/auth/session-context';
import { Avatar } from '@/components/Avatar';
import LazyMarkdown from '@/components/LazyMarkdown';
import { relTime } from '@/i18n';
import { apiErrorText } from '@/lib/errors';
import { announce } from '@/lib/announce';

/**
 * Modal de detalle de una decisión: título y descripción editables inline,
 * soluciones ordenadas por votos (botón 👍 con count y estado my_vote), acciones
 * del creador (elegir / cerrar sin solución / reabrir) y comentarios.
 */
export function DecisionModal({
  decisionId,
  onClose,
  onDeleted,
}: {
  decisionId: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const data = useData();
  const { user } = useSession();
  const [solutionText, setSolutionText] = useState('');
  const [proposing, setProposing] = useState(false);
  const [chooseTarget, setChooseTarget] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [commentBody, setCommentBody] = useState('');
  const [commentSending, setCommentSending] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [descEditing, setDescEditing] = useState(false);
  const [descDraft, setDescDraft] = useState('');
  const descRef = useRef<HTMLTextAreaElement>(null);
  const descCancelRef = useRef(false);
  const [editingSolutionId, setEditingSolutionId] = useState<string | null>(null);
  const [solutionDraft, setSolutionDraft] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const solutionEditRef = useRef<HTMLTextAreaElement>(null);
  const solutionCancelRef = useRef(false);

  const detail = data.getDecisionDetail(decisionId);

  useEffect(() => {
    if (descEditing && descRef.current) {
      descRef.current.focus();
      const len = descRef.current.value.length;
      descRef.current.setSelectionRange(len, len);
    }
  }, [descEditing]);

  useEffect(() => {
    if (editingSolutionId && solutionEditRef.current) {
      solutionEditRef.current.focus();
      const len = solutionEditRef.current.value.length;
      solutionEditRef.current.setSelectionRange(len, len);
    }
  }, [editingSolutionId]);

  useEffect(() => {
    setEditingSolutionId(null);
    setEditError(null);
  }, [decisionId]);

  useEffect(() => {
    setDescEditing(false);
  }, [decisionId]);

  useEffect(() => {
    const lastFocus = document.activeElement;
    document.body.style.overflow = 'hidden';
    void data.refreshDecisionDetail(decisionId);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      if (lastFocus instanceof HTMLElement) lastFocus.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decisionId]);

  if (!detail) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center"
        role="dialog"
        aria-modal="true"
        aria-label={t('common.loading')}
      >
        <div
          className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
          onClick={onClose}
          aria-hidden="true"
        />
        <div className="relative rounded-2xl bg-surface border border-app shadow-2xl px-6 py-5">
          <p className="text-sm text-muted">{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  const decision = detail.decision;
  const solutions = detail.solutions;
  const comments = detail.comments;
  const isCreator = decision.created_by === user?.id;
  const canDecide = isCreator || user?.role === 'admin';

  const patch = async (p: { title?: string; description?: string }) => {
    try {
      await data.patchDecision(decision.id, p);
    } catch (err) {
      announce(apiErrorText(err, t('common.error')));
    }
  };

  const handlePropose = async (e: FormEvent) => {
    e.preventDefault();
    const [title, ...rest] = solutionText.split('\n');
    const text = (title ?? '').trim().slice(0, 200);
    if (!text || proposing) return;
    const description = rest.join('\n').trim();
    setProposing(true);
    setError(null);
    try {
      await data.addSolution(decision.id, text, description || undefined);
      setSolutionText('');
    } catch (err) {
      setError(apiErrorText(err, t('common.error')));
    } finally {
      setProposing(false);
    }
  };

  const startEditSolution = (solutionId: string, title: string, description: string) => {
    setSolutionDraft(description ? `${title}\n${description}` : title);
    setEditError(null);
    setEditingSolutionId(solutionId);
  };

  const handleSaveSolution = async (solutionId: string, originalTitle: string, originalDescription: string) => {
    const [first, ...rest] = solutionDraft.split('\n');
    const title = (first ?? '').trim().slice(0, 200);
    if (!title) return;
    const description = rest.join('\n').trim();
    if (title === originalTitle && description === originalDescription) return;
    try {
      await data.patchSolution(decision.id, solutionId, { title, description });
      setEditingSolutionId(null);
      setEditError(null);
    } catch (err) {
      setEditError(apiErrorText(err, t('common.error')));
    }
  };

  const handleVote = async (solutionId: string, myVote: boolean) => {    try {
      if (myVote) await data.unvoteDecision(decision.id);
      else await data.voteDecision(decision.id, solutionId);
    } catch {
      announce(t('common.error'));
    }
  };

  const handleChoose = async (solutionId: string | null) => {
    try {
      await data.chooseDecision(decision.id, solutionId);
      setChooseTarget(undefined);
    } catch {
      announce(t('common.error'));
    }
  };

  const handleReopen = async () => {
    try {
      await data.reopenDecision(decision.id);
    } catch {
      announce(t('common.error'));
    }
  };

  const handleDelete = async () => {
    try {
      await data.deleteDecision(decision.id);
      onDeleted();
    } catch {
      announce(t('common.error'));
    }
  };

  const handleAddComment = async (e: FormEvent) => {
    e.preventDefault();
    const text = commentBody.trim();
    if (!text || commentSending) return;
    setCommentSending(true);
    setCommentError(null);
    try {
      await data.addDecisionComment(decision.id, text);
      setCommentBody('');
    } catch (err) {
      setCommentError(apiErrorText(err, t('comments.error')));
    } finally {
      setCommentSending(false);
    }
  };

  const statusBadge =
    decision.status === 'decided' ? (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300 px-2.5 py-0.5 text-[12px] font-medium">
        <Check className="w-3.5 h-3.5" aria-hidden="true" />
        {t('decisions.statusDecided')}
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300 px-2.5 py-0.5 text-[12px] font-medium">
        {t('decisions.statusOpen')}
      </span>
    );

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch lg:items-center lg:justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="decision-modal-title"
    >
      <div
        className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative w-full h-full lg:h-auto lg:max-h-[88vh] lg:max-w-2xl bg-surface lg:rounded-2xl border border-app shadow-2xl overflow-hidden flex flex-col">
        {/* Cabecera */}
        <div className="sticky top-0 z-10 bg-surface/95 backdrop-blur border-b border-app px-5 lg:px-7 pt-4 pb-3">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <input
                type="text"
                key={`title-${decision.id}-${decision.updated_at}`}
                defaultValue={decision.title}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== decision.title) void patch({ title: v });
                  else e.target.value = decision.title;
                }}
                className="w-full bg-transparent font-display font-bold text-[20px] lg:text-[22px] tracking-tight outline-none border-b border-transparent focus:border-brand pb-0.5"
                aria-label={t('decisions.form.titleLabel')}
              />
              <p className="text-sm text-muted mt-0.5">
                {t('decisions.by', { name: decision.created_by_username })}
                <span className="text-faint"> · {relTime(decision.created_at, t)}</span>
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {statusBadge}
              <button
                type="button"
                onClick={onClose}
                className="w-10 h-10 rounded-lg text-muted hover:bg-surface2 hover:text-brand flex items-center justify-center shrink-0"
                aria-label={t('task.closeDetail')}
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto nice-scroll">
          <div className="px-5 lg:px-7 py-5 pb-8 space-y-6 max-w-2xl">
            {/* Descripción: preview de solo lectura; clic para editar inline */}
            <div>
              <p className="text-[12px] font-semibold tracking-wide uppercase text-faint mb-1.5">
                {t('decisions.modal.description')}
              </p>
              {descEditing ? (
                <textarea
                  ref={descRef}
                  value={descDraft}
                  maxLength={5000}
                  rows={Math.min(12, Math.max(2, descDraft.split('\n').length + 1))}
                  placeholder={t('decisions.form.descriptionPlaceholder')}
                  onChange={(e) => setDescDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.stopPropagation();
                      descCancelRef.current = true;
                      setDescEditing(false);
                    }
                  }}
                  onBlur={() => {
                    setDescEditing(false);
                    if (descCancelRef.current) {
                      descCancelRef.current = false;
                      return;
                    }
                    if (descDraft !== decision.description) {
                      void patch({ description: descDraft });
                    }
                  }}
                  className="w-full px-3 py-2 rounded-lg bg-surface2 border border-app text-sm text-text focus:outline-none focus:border-brand resize-none"
                />
              ) : decision.description.trim() !== '' ? (
                <div
                  role="button"
                  tabIndex={0}
                  aria-label={t('decisions.modal.description')}
                  onClick={() => {
                    setDescDraft(decision.description);
                    setDescEditing(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setDescDraft(decision.description);
                      setDescEditing(true);
                    }
                  }}
                  className="cursor-text rounded-lg"
                >
                  <LazyMarkdown>{decision.description}</LazyMarkdown>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setDescDraft(decision.description);
                    setDescEditing(true);
                  }}
                  className="text-sm text-faint italic hover:text-muted"
                >
                  {t('decisions.form.descriptionPlaceholder')}
                </button>
              )}
            </div>

            {/* Soluciones */}
            <div>
              <p className="text-[12px] font-semibold tracking-wide uppercase text-faint mb-2">
                {t('decisions.modal.solutions')}
              </p>
              {solutions.length === 0 ? (
                <p className="text-sm text-muted py-2">{t('decisions.modal.noSolutions')}</p>
              ) : (
                <MotionConfig reducedMotion="user">
                  <ul className="space-y-2.5">
                    {solutions.map((s) => {
                      const chosen = decision.chosen_solution_id === s.id;
                      return (
                        <motion.li
                          layout
                          transition={{ type: 'spring', stiffness: 500, damping: 40, mass: 0.8 }}
                          key={s.id}
                          className={`flex items-start gap-3 rounded-xl border px-3.5 py-3 ${
                            chosen ? 'border-brand bg-brand-soft' : 'border-app bg-surface2/50'
                          }`}
                        >
                        <Avatar name={s.proposer_username} color={s.proposer_color} size="lg" />
                        <div className="flex-1 min-w-0">
                          {editingSolutionId === s.id ? (
                            <div>
                              <textarea
                                ref={solutionEditRef}
                                value={solutionDraft}
                                maxLength={5000}
                                rows={Math.min(12, Math.max(2, solutionDraft.split('\n').length + 1))}
                                placeholder={t('decisions.modal.proposePlaceholder')}
                                onChange={(e) => setSolutionDraft(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Escape') {
                                    e.stopPropagation();
                                    solutionCancelRef.current = true;
                                    setEditingSolutionId(null);
                                  }
                                }}
                                onBlur={() => {
                                  if (solutionCancelRef.current) {
                                    solutionCancelRef.current = false;
                                    setEditingSolutionId(null);
                                    return;
                                  }
                                  void handleSaveSolution(s.id, s.title, s.description);
                                }}
                                className="w-full px-3 py-2 rounded-lg bg-surface2 border border-app text-sm text-text focus:outline-none focus:border-brand resize-none"
                              />
                              {editError && (
                                <p
                                  role="alert"
                                  className="text-[13px] font-medium text-rose-600 dark:text-rose-400 mt-1"
                                >
                                  {editError}
                                </p>
                              )}
                            </div>
                          ) : (
                            <>
                              <div className="flex items-center gap-2">
                                <p
                                  className={`font-medium ${
                                    s.description
                                      ? 'text-[17px] font-semibold uppercase'
                                      : 'text-[15px]'
                                  }`}
                                >
                                  {s.title}
                                </p>
                                {chosen && (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-brand text-brandfg px-2 py-0.5 text-[11px] font-semibold">
                                    <Check className="w-3 h-3" aria-hidden="true" />
                                    {t('decisions.modal.chosen')}
                                  </span>
                                )}
                              </div>
                              {s.description && (
                                <p className="text-[13px] text-muted mt-0.5 break-words">
                                  {s.description}
                                </p>
                              )}
                              <p className="text-[12px] text-faint mt-0.5">
                                {t('decisions.by', { name: s.proposer_username })}
                              </p>
                            </>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {editingSolutionId !== s.id && (
                            <>
                              {(s.proposer_id === user?.id || user?.role === 'admin') && (
                                <button
                                  type="button"
                                  onClick={() => startEditSolution(s.id, s.title, s.description)}
                                  className="w-8 h-8 rounded-lg text-faint hover:text-muted hover:bg-surface flex items-center justify-center"
                                  aria-label={t('decisions.modal.editSolution')}
                                  title={t('decisions.modal.editSolution')}
                                >
                                  <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                                </button>
                              )}
                              {decision.status === 'open' && (
                                <button
                                  type="button"
                                  onClick={() => void handleVote(s.id, s.my_vote)}
                                  className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                                    s.my_vote
                                      ? 'bg-brand text-brandfg'
                                      : 'bg-surface border border-app text-muted hover:bg-surface2'
                                  }`}
                                  aria-label={t('decisions.votes', { count: s.votes })}
                                >
                                  <ThumbsUp className="w-3.5 h-3.5" aria-hidden="true" />
                                  {s.votes}
                                </button>
                              )}
                              {decision.status !== 'open' && (
                                <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-muted">
                                  <ThumbsUp className="w-3.5 h-3.5" aria-hidden="true" />
                                  {s.votes}
                                </span>
                              )}
                              {decision.status === 'open' && canDecide && (
                                <button
                                  type="button"
                                  onClick={() => setChooseTarget(s.id)}
                                  className="px-2.5 py-1.5 rounded-lg text-[12px] font-medium bg-surface border border-app text-muted hover:text-brand"
                                >
                                  {t('decisions.modal.choose')}
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </motion.li>
                      );
                    })}
                  </ul>
                </MotionConfig>
              )}

              {/* Proponer solución */}
              {decision.status === 'open' && (
                <form onSubmit={handlePropose} className="mt-3 space-y-2">
                  <textarea
                    value={solutionText}
                    maxLength={5000}
                    rows={2}
                    onChange={(e) => setSolutionText(e.target.value)}
                    placeholder={t('decisions.modal.proposePlaceholder')}
                    className="w-full px-3 py-2 rounded-lg bg-surface2 border border-app text-sm outline-none focus:border-brand resize-none"
                  />
                  <button
                    type="submit"
                    disabled={proposing || !solutionText.split('\n')[0]?.trim()}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-brand text-brandfg text-[13px] font-semibold hover:brightness-110 disabled:opacity-60"
                  >
                    <Plus className="w-4 h-4" aria-hidden="true" />
                    {t('decisions.modal.propose')}
                  </button>
                </form>
              )}
              {error && (
                <p
                  role="alert"
                  className="text-[13px] font-medium text-rose-600 dark:text-rose-400 mt-2"
                >
                  {error}
                </p>
              )}
            </div>

            {/* Acciones del creador */}
            {canDecide && (
              <div className="border-t border-app pt-4 flex flex-wrap items-center gap-2">
                {decision.status === 'decided' ? (
                  <button
                    type="button"
                    onClick={() => void handleReopen()}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[13px] font-medium bg-surface border border-app text-muted hover:bg-surface2"
                  >
                    <RotateCcw className="w-4 h-4" aria-hidden="true" />
                    {t('decisions.modal.reopen')}
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setChooseTarget(null)}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[13px] font-medium bg-surface border border-app text-muted hover:bg-surface2"
                    >
                      {t('decisions.modal.closeWithoutSolution')}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete()}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[13px] font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10"
                    >
                      {t('common.delete')}
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Comentarios */}
            <div className="border-t border-app pt-4">
              <p className="text-[12px] font-semibold tracking-wide uppercase text-faint mb-3">
                {t('decisions.modal.comments')}
              </p>
              {comments.length > 0 ? (
                <ul className="space-y-4">
                  {comments.map((c) => (
                    <li key={c.id} className="flex gap-3">
                      <Avatar name={c.username ?? '?'} color={c.user_color} size="lg" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px]">
                          <span className="font-semibold">{c.username ?? '?'}</span>{' '}
                          <span className="text-[12px] text-faint">{relTime(c.created_at, t)}</span>
                        </p>
                        <div className="mt-1 rounded-xl rounded-tl-sm bg-surface2 px-3.5 py-2.5">
                          <LazyMarkdown>{c.body}</LazyMarkdown>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[14px] text-faint py-4 text-center">{t('comments.empty')}</p>
              )}

              <form onSubmit={handleAddComment} className="flex gap-3 items-center mt-4">
                <Avatar name={user?.username ?? '?'} color={user?.color ?? 'slate'} size="lg" />
                <div className="flex-1 flex items-center gap-2 rounded-xl border border-app bg-surface px-3.5 py-2">
                  <input
                    type="text"
                    value={commentBody}
                    maxLength={5000}
                    onChange={(e) => setCommentBody(e.target.value)}
                    placeholder={t('comments.placeholder')}
                    className="flex-1 bg-transparent text-[14px] outline-none placeholder:text-faint"
                  />
                  <button
                    type="submit"
                    disabled={commentSending || !commentBody.trim()}
                    className="px-3.5 py-2 rounded-lg bg-brand text-brandfg text-[13px] font-semibold hover:brightness-110 disabled:opacity-60"
                  >
                    {commentSending ? t('comments.submitting') : t('comments.submit')}
                  </button>
                </div>
              </form>
              {commentError && (
                <p
                  role="alert"
                  className="text-[13px] font-medium text-rose-600 dark:text-rose-400 mt-2"
                >
                  {commentError}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Confirmación de elección */}
      {chooseTarget !== undefined && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/45"
            onClick={() => setChooseTarget(undefined)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t('decisions.modal.choose')}
            className="relative w-[90%] max-w-sm rounded-2xl bg-surface border border-app shadow-2xl p-5"
          >
            <p className="text-[15px] font-medium">{t('decisions.modal.chooseConfirm')}</p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setChooseTarget(undefined)}
                className="px-3.5 py-2 rounded-lg text-[13px] font-medium text-muted hover:bg-surface2"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={() => void handleChoose(chooseTarget)}
                className="px-3.5 py-2 rounded-lg bg-brand text-brandfg text-[13px] font-semibold hover:brightness-110"
              >
                {t('common.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
