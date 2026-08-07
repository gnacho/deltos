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
  // Hogar
  { name: 'home', emoji: '🏠' },
  { name: 'building', emoji: '🏢' },
  { name: 'bed-double', emoji: '🛏️' },
  { name: 'sofa', emoji: '🛋️' },
  { name: 'lamp', emoji: '💡' },
  { name: 'key', emoji: '🔑' },
  // Tareas domésticas
  { name: 'washing-machine', emoji: '🧺' },
  { name: 'shower-head', emoji: '🚿' },
  { name: 'toilet', emoji: '🚽' },
  { name: 'utensils', emoji: '🍽️' },
  { name: 'cooking-pot', emoji: '🍳' },
  { name: 'shopping-cart', emoji: '🛒' },
  { name: 'shopping-basket', emoji: '🧺' },
  // Jardín y exterior
  { name: 'sprout', emoji: '🌱' },
  { name: 'trees', emoji: '🌳' },
  { name: 'flower', emoji: '🌸' },
  { name: 'sun', emoji: '☀️' },
  { name: 'umbrella', emoji: '☂️' },
  { name: 'tent', emoji: '⛺' },
  // Transporte
  { name: 'car', emoji: '🚗' },
  { name: 'bike', emoji: '🚲' },
  { name: 'plane', emoji: '✈️' },
  { name: 'truck', emoji: '🚚' },
  { name: 'bus', emoji: '🚌' },
  // Trabajo y oficina
  { name: 'briefcase', emoji: '💼' },
  { name: 'graduation-cap', emoji: '🎓' },
  { name: 'book-open', emoji: '📖' },
  { name: 'wallet', emoji: '👛' },
  { name: 'coins', emoji: '🪙' },
  { name: 'calendar', emoji: '📅' },
  { name: 'printer', emoji: '🖨️' },
  { name: 'clipboard', emoji: '📋' },
  // Objetos diarios
  { name: 'backpack', emoji: '🎒' },
  { name: 'watch', emoji: '⌚' },
  { name: 'glasses', emoji: '👓' },
  { name: 'scissors', emoji: '✂️' },
  { name: 'puzzle', emoji: '🧩' },
  { name: 'palette', emoji: '🎨' },
  { name: 'coffee', emoji: '☕' },
  // Comida
  { name: 'apple', emoji: '🍎' },
  { name: 'pizza', emoji: '🍕' },
  { name: 'chef-hat', emoji: '👨‍🍳' },
  // Familia y ocio
  { name: 'heart', emoji: '❤️' },
  { name: 'baby', emoji: '👶' },
  { name: 'paw-print', emoji: '🐾' },
  { name: 'gift', emoji: '🎁' },
  { name: 'party-popper', emoji: '🎉' },
  { name: 'dumbbell', emoji: '🏋️' },
  { name: 'music', emoji: '🎵' },
  { name: 'camera', emoji: '📷' },
  // Informática
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
  { name: 'tv', emoji: '📺' },
  { name: 'phone', emoji: '📞' },
];

export const PROJECT_ICON_NAMES = PROJECT_ICONS.map((i) => i.name);

/** Emoji de muestra para <select>/<option>; si no es un icono conocido devuelve el valor tal cual (emoji legado). */
export function projectIconEmoji(name: string): string {
  return PROJECT_ICONS.find((i) => i.name === name)?.emoji ?? name;
}
