/** Tamaño de archivo legible (formato es-ES/en-US según idioma). */
export function fmtSize(bytes: number, lang: string): string {
  const locale = lang.toLowerCase().startsWith('en') ? 'en-US' : 'es-ES';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) {
    const kb = bytes / 1024;
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(kb)} KB`;
  }
  const mb = bytes / (1024 * 1024);
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(mb)} MB`;
}
