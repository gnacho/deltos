/**
 * Referencias entre tareas: `[[CASA-1]]` dentro de texto Markdown se convierte
 * en un enlace interno. El plugin solo toca nodos de texto, así que el código
 * en línea y los bloques de código quedan intactos y se pueden documentar.
 */

/** Id corto: prefijo alfanumérico (1-8) + guion + número (1-6 dígitos). */
const TASK_REF_SOURCE = '\\[\\[([A-Za-z0-9]{1,8}-[0-9]{1,6})\\]\\]';

/** Esquema del href interno que Markdown.tsx intercepta para pintar el chip. */
export const TASK_REF_SCHEME = 'deltos-task:';

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  url?: string;
  title?: string | null;
}

/** Ids cortos citados en un texto, en orden de aparición y sin repetir. */
export function extractTaskRefs(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(new RegExp(TASK_REF_SOURCE, 'g'))) {
    if (!found.includes(m[1])) found.push(m[1]);
  }
  return found;
}

/** Parte un texto en texto plano + nodos de enlace interno. null si no hay. */
function splitText(value: string): MdNode[] | null {
  const re = new RegExp(TASK_REF_SOURCE, 'g');
  const nodes: MdNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value)) !== null) {
    if (m.index > last) nodes.push({ type: 'text', value: value.slice(last, m.index) });
    nodes.push({
      type: 'link',
      url: `${TASK_REF_SCHEME}${m[1]}`,
      title: null,
      children: [{ type: 'text', value: m[1] }],
    });
    last = m.index + m[0].length;
  }
  if (nodes.length === 0) return null;
  if (last < value.length) nodes.push({ type: 'text', value: value.slice(last) });
  return nodes;
}

/**
 * Sustituye las referencias de los nodos de texto del árbol. No entra en
 * enlaces ya existentes (evitaría anidar <a>) ni en código, que no tiene hijos.
 */
function walk(node: MdNode): void {
  if (!Array.isArray(node.children)) return;
  if (node.type === 'link' || node.type === 'linkReference') return;
  const next: MdNode[] = [];
  for (const child of node.children) {
    if (child.type === 'text' && typeof child.value === 'string') {
      const parts = splitText(child.value);
      if (parts) {
        next.push(...parts);
        continue;
      }
    }
    walk(child);
    next.push(child);
  }
  node.children = next;
}

/** Plugin remark: convierte `[[ID]]` en enlaces internos `deltos-task:ID`. */
export function remarkTaskRefs() {
  return (tree: unknown) => {
    walk(tree as MdNode);
  };
}
