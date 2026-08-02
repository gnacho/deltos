import { useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskDetail } from '@/data/types';
import { useData } from '@/data/data-context';
import { useSession } from '@/auth/session-context';
import { Avatar } from '@/components/Avatar';
import { relTime } from '@/i18n';
import { apiErrorText } from '@/lib/errors';

/** Pestaña Comentarios: lista real + publicar. */
export function CommentsTab({ detail }: { detail: TaskDetail }) {
  const { t } = useTranslation();
  const data = useData();
  const { user } = useSession();
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      await data.addComment(detail.task.id, text);
      setBody('');
    } catch (err) {
      setError(apiErrorText(err, t('comments.error')));
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      {detail.comments.length > 0 ? (
        <ul className="space-y-5">
          {detail.comments.map((c) => (
            <li key={c.id} className="flex gap-3">
              <Avatar name={c.username ?? '?'} color={c.user_color} size="lg" />
              <div className="flex-1 min-w-0">
                <p className="text-[14px]">
                  <span className="font-semibold">{c.username ?? '?'}</span>{' '}
                  <span className="text-[12px] text-faint">{relTime(c.created_at, t)}</span>
                </p>
                <div className="mt-1 rounded-xl rounded-tl-sm bg-surface2 px-3.5 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap break-words">
                  {c.body}
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[14px] text-faint py-8 text-center">{t('comments.empty')}</p>
      )}

      <form onSubmit={submit} className="flex gap-3 items-center mt-6">
        <Avatar name={user.username} color={user.color} size="lg" />
        <div className="flex-1 flex items-center gap-2 rounded-xl border border-app bg-surface px-3.5 py-2">
          <label className="sr-only" htmlFor="comment-input">
            {t('comments.placeholder')}
          </label>
          <input
            id="comment-input"
            type="text"
            value={body}
            maxLength={2000}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t('comments.placeholder')}
            className="flex-1 bg-transparent text-[14px] outline-none placeholder:text-faint"
          />
          <button
            type="submit"
            disabled={sending || !body.trim()}
            className="px-3.5 py-2 rounded-lg bg-brand text-brandfg text-[13px] font-semibold hover:brightness-110 disabled:opacity-60"
          >
            {sending ? t('comments.submitting') : t('comments.submit')}
          </button>
        </div>
      </form>
      {error && (
        <p role="alert" className="text-[13px] font-medium text-rose-600 dark:text-rose-400 mt-2">
          {error}
        </p>
      )}
    </div>
  );
}
