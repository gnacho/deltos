import { lazy, Suspense } from 'react';

const Markdown = lazy(() => import('@/components/Markdown'));

/**
 * Carga el render de Markdown en diferido: react-markdown y sus plugins pesan
 * lo suyo y no hacen falta hasta que hay algo que renderizar, así que no entran
 * en el bundle inicial. Mientras llega, se muestra el texto plano (como antes).
 */
export default function LazyMarkdown({ children }: { children: string }) {
  return (
    <Suspense fallback={<p className="whitespace-pre-wrap break-words">{children}</p>}>
      <Markdown>{children}</Markdown>
    </Suspense>
  );
}
