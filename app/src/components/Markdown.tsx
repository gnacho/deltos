import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';

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
 */
export default function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown text-[15px] leading-relaxed break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          a: (props) => (
            <a
              {...withoutNode(props)}
              className="text-brand hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            />
          ),
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
