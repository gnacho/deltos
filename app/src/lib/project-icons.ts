/**
 * Catálogo curado de iconos para proyectos. La fuente es Lucide (ya es
 * dependencia): se pintan con el color del tema y se ven igual en claro y
 * oscuro. `emoji` es SOLO la muestra para los <select> del navegador (no
 * admiten SVG dentro de <option>); el resto de la UI usa el icono Lucide.
 */
export interface ProjectIconDef {
  name: string;
  emoji: string;
}

export const PROJECT_ICONS: ProjectIconDef[] = [
  { name: 'home', emoji: '🏠' },
  { name: 'bed-double', emoji: '🛏️' },
  { name: 'sofa', emoji: '🛋️' },
  { name: 'lamp', emoji: '💡' },
  { name: 'washing-machine', emoji: '🧺' },
  { name: 'bath', emoji: '🛁' },
  { name: 'utensils', emoji: '🍽️' },
  { name: 'shopping-cart', emoji: '🛒' },
  { name: 'shopping-basket', emoji: '🧺' },
  { name: 'key', emoji: '🔑' },
  { name: 'sprout', emoji: '🌱' },
  { name: 'trees', emoji: '🌳' },
  { name: 'flower', emoji: '🌸' },
  { name: 'tent', emoji: '⛺' },
  { name: 'sun', emoji: '☀️' },
  { name: 'umbrella', emoji: '☂️' },
  { name: 'car', emoji: '🚗' },
  { name: 'bike', emoji: '🚲' },
  { name: 'plane', emoji: '✈️' },
  { name: 'truck', emoji: '🚚' },
  { name: 'briefcase', emoji: '💼' },
  { name: 'graduation-cap', emoji: '🎓' },
  { name: 'book-open', emoji: '📖' },
  { name: 'wallet', emoji: '👛' },
  { name: 'coins', emoji: '🪙' },
  { name: 'calendar', emoji: '📅' },
  { name: 'heart', emoji: '❤️' },
  { name: 'baby', emoji: '👶' },
  { name: 'paw-print', emoji: '🐾' },
  { name: 'gift', emoji: '🎁' },
  { name: 'party-popper', emoji: '🎉' },
  { name: 'dumbbell', emoji: '🏋️' },
  { name: 'music', emoji: '🎵' },
  { name: 'camera', emoji: '📷' },
  { name: 'gamepad', emoji: '🎮' },
  { name: 'monitor', emoji: '🖥️' },
  { name: 'laptop', emoji: '💻' },
  { name: 'tablet', emoji: '📱' },
  { name: 'smartphone', emoji: '📱' },
  { name: 'router', emoji: '📶' },
  { name: 'wifi', emoji: '📶' },
  { name: 'server', emoji: '🗄️' },
  { name: 'cloud', emoji: '☁️' },
  { name: 'hard-drive', emoji: '💾' },
  { name: 'cpu', emoji: '⚙️' },
  { name: 'network', emoji: '🌐' },
  { name: 'antenna', emoji: '📡' },
  { name: 'tv', emoji: '📺' },
  { name: 'phone', emoji: '📞' },
];

export const PROJECT_ICON_NAMES = PROJECT_ICONS.map((i) => i.name);

/** Emoji de muestra para <select>/<option>; si no es un icono conocido devuelve el valor tal cual (emoji legado). */
export function projectIconEmoji(name: string): string {
  return PROJECT_ICONS.find((i) => i.name === name)?.emoji ?? name;
}
