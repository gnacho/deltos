import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FileText,
  FileSpreadsheet,
  FileImage,
  File as FileIcon,
  Download,
  Paperclip,
} from 'lucide-react';
import type { Attachment, TaskDetail } from '@/data/types';
import { apiErrorText } from '@/lib/errors';
import { useData } from '@/data/data-context';
import { useSession } from '@/auth/session-context';
import { fmtSize } from '@/lib/format';
import { ImageLightbox } from '@/components/task/ImageLightbox';
import { PhotoCropDialog } from '@/components/PhotoCropDialog';

const MAX_BYTES = 10 * 1024 * 1024;

function isImageAttachment(a: Attachment) {
  const ext = a.filename.split('.').pop()?.toLowerCase() ?? '';
  return a.mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext);
}

function iconFor(mime: string, filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) {
    return {
      Icon: FileImage,
      cls: 'bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300',
    };
  }
  if (
    mime.includes('sheet') ||
    mime.includes('csv') ||
    ['xls', 'xlsx', 'ods', 'csv'].includes(ext)
  ) {
    return {
      Icon: FileSpreadsheet,
      cls: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300',
    };
  }
  if (mime === 'application/pdf' || ['pdf', 'doc', 'docx', 'odt', 'txt', 'md'].includes(ext)) {
    return {
      Icon: FileText,
      cls: 'bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300',
    };
  }
  return { Icon: FileIcon, cls: 'bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300' };
}

/** Pestaña Adjuntos: lista real + subida (≤10 MB) + descarga. */
export function AttachmentsTab({ detail }: { detail: TaskDetail }) {
  const { t, i18n } = useTranslation();
  const data = useData();
  useSession();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<number | null>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);

  const images = detail.attachments.filter(isImageAttachment).map((a) => ({
    src: `/api/attachments/${encodeURIComponent(a.id)}`,
    alt: a.filename,
  }));

  const openViewer = (a: Attachment) => {
    const i = images.findIndex((img) => img.src.endsWith(encodeURIComponent(a.id)));
    if (i >= 0) setViewer(i);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (file.size > MAX_BYTES) {
      setError(t('attachments.tooBig'));
      return;
    }
    if (file.type.startsWith('image/')) {
      setCropFile(file);
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    setUploading(true);
    try {
      await data.uploadAttachment(detail.task.id, file);
    } catch (err) {
      setError(apiErrorText(err, t('attachments.uploadError')));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const onCropSave = async (blob: Blob) => {
    setError(null);
    setUploading(true);
    try {
      const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
      const named = new File([blob], `photo.${ext}`, { type: blob.type });
      await data.uploadAttachment(detail.task.id, named);
    } catch (err) {
      setError(apiErrorText(err, t('attachments.uploadError')));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      {detail.attachments.length > 0 ? (
        <ul className="space-y-2.5">
          {detail.attachments.map((a: Attachment) => {
            const { Icon, cls } = iconFor(a.mime, a.filename);
            const main = (
              <>
                <span
                  className={`w-10 h-10 rounded-lg ${cls} flex items-center justify-center shrink-0`}
                >
                  <Icon className="w-[18px] h-[18px]" aria-hidden="true" />
                </span>
                <span className="flex-1 min-w-0 text-left">
                  <span className="block text-[15px] font-medium truncate">{a.filename}</span>
                  <span className="block text-[13px] text-faint">
                    {fmtSize(a.size, i18n.language)}
                    {a.uploaded_by_username
                      ? ` · ${t('attachments.uploadedBy', { name: a.uploaded_by_username })}`
                      : ''}
                  </span>
                </span>
              </>
            );
            return (
              <li
                key={a.id}
                className="flex items-center gap-3 rounded-xl border border-app px-3.5 py-3"
              >
                {isImageAttachment(a) ? (
                  <button
                    type="button"
                    onClick={() => openViewer(a)}
                    aria-label={t('attachments.view', { name: a.filename })}
                    className="flex flex-1 min-w-0 items-center gap-3"
                  >
                    {main}
                  </button>
                ) : (
                  main
                )}
                <a
                  href={`/api/attachments/${encodeURIComponent(a.id)}`}
                  download={a.filename}
                  className="w-9 h-9 rounded-lg text-muted hover:bg-surface2 flex items-center justify-center shrink-0"
                  aria-label={t('attachments.download', { name: a.filename })}
                >
                  <Download className="w-4 h-4" aria-hidden="true" />
                </a>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-[14px] text-faint py-8 text-center">{t('attachments.empty')}</p>
      )}

      <div className="mt-5">
        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          aria-hidden="true"
          tabIndex={-1}
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
        <button
          type="button"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          className="w-full flex items-center justify-center gap-2 rounded-2xl border border-dashed border-app px-4 py-4 text-[14px] font-medium text-muted hover:bg-surface2 disabled:opacity-60"
        >
          <Paperclip className="w-4 h-4" aria-hidden="true" />
          {uploading ? t('attachments.uploading') : t('attachments.upload')}
        </button>
        <p className="text-[12px] text-faint mt-2 text-center">{t('attachments.uploadHint')}</p>
        {error && (
          <p
            role="alert"
            className="text-[13px] font-medium text-rose-600 dark:text-rose-400 mt-2 text-center"
          >
            {error}
          </p>
        )}
      </div>

      <ImageLightbox images={images} index={viewer} onIndexChange={setViewer} />

      <PhotoCropDialog
        file={cropFile}
        open={!!cropFile}
        onClose={() => setCropFile(null)}
        onSave={onCropSave}
        allowedRatios={[4 / 3, 16 / 9, 1, 0]}
      />
    </div>
  );
}
