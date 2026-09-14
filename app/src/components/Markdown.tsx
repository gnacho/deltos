import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import TaskRef from '@/components/TaskRef';
import { TASK_REF_SCHEME, remarkTaskRefs } from '@/lib/task-refs';

/** Quita la prop `node` que react-markdown pasa a cada renderer, para no
 *  esparcirla sobre el elemento del DOM. */
function withoutNode<T extends { node?: unknown }>(props: T): Omit<T, 'node'> {
  const { node, ...rest } = props;
  void node;
  return rest;
}

/**
 * Render de Markdown (GFM). Sin HTML crudo: react-markdown no interpreta
 * `<script>` ni otros tags embebidos, así que el texto del usuario no puede
 * inyectar marcado. Los enlaces abren en pestaña nueva y sin referrer.
 * `remark-breaks` mantiene los saltos de línea de los textos planos previos.
 * Las referencias `[[CASA-1]]` se pintan como chip que abre la tarea citada.
 */
export default function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown text-[15px] leading-relaxed break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks, remarkTaskRefs]}
        // El saneador por defecto descarta protocolos desconocidos; el nuestro
        // es interno (nunca sale a red), así que se permite explícitamente.
        urlTransform={(url) => (url.startsWith(TASK_REF_SCHEME) ? url : defaultUrlTransform(url))}
        components={{
          a: (props) => {
            const href = props.href ?? '';
            if (href.startsWith(TASK_REF_SCHEME)) {
              return <TaskRef shortId={href.slice(TASK_REF_SCHEME.length)} />;
            }
            return (
              <a
                {...withoutNode(props)}
                className="text-brand hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              />
            );
          },
          p: (props) => <p className="mb-2 last:mb-0" {...withoutNode(props)} />,
          ul: (props) => <ul className="mb-2 list-disc pl-5" {...withoutNode(props)} />,
          ol: (props) => <ol className="mb-2 list-decimal pl-5" {...withoutNode(props)} />,
          code: (props) => (
            <code className="rounded bg-surface2 px-1 py-0.5 text-[13px]" {...withoutNode(props)} />
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
