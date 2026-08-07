import type { LucideIcon } from 'lucide-react';
import {
  Antenna,
  Baby,
  Bath,
  BedDouble,
  Bike,
  BookOpen,
  Briefcase,
  Calendar,
  Camera,
  Car,
  Cloud,
  Coins,
  Cpu,
  Dumbbell,
  Flower,
  Gamepad,
  Gift,
  GraduationCap,
  HardDrive,
  Heart,
  Home,
  Key,
  Lamp,
  Laptop,
  Monitor,
  Music,
  Network,
  PartyPopper,
  PawPrint,
  Phone,
  Plane,
  Router,
  Server,
  ShoppingBasket,
  ShoppingCart,
  Smartphone,
  Sofa,
  Sprout,
  Sun,
  Tablet,
  Tent,
  Trees,
  Truck,
  Tv,
  Umbrella,
  Utensils,
  Wallet,
  WashingMachine,
  Wifi,
} from 'lucide-react';

const ICON_MAP: Record<string, LucideIcon> = {
  home: Home,
  'bed-double': BedDouble,
  sofa: Sofa,
  lamp: Lamp,
  'washing-machine': WashingMachine,
  bath: Bath,
  utensils: Utensils,
  'shopping-cart': ShoppingCart,
  'shopping-basket': ShoppingBasket,
  key: Key,
  sprout: Sprout,
  trees: Trees,
  flower: Flower,
  tent: Tent,
  sun: Sun,
  umbrella: Umbrella,
  car: Car,
  bike: Bike,
  plane: Plane,
  truck: Truck,
  briefcase: Briefcase,
  'graduation-cap': GraduationCap,
  'book-open': BookOpen,
  wallet: Wallet,
  coins: Coins,
  calendar: Calendar,
  heart: Heart,
  baby: Baby,
  'paw-print': PawPrint,
  gift: Gift,
  'party-popper': PartyPopper,
  dumbbell: Dumbbell,
  music: Music,
  camera: Camera,
  gamepad: Gamepad,
  monitor: Monitor,
  laptop: Laptop,
  tablet: Tablet,
  smartphone: Smartphone,
  router: Router,
  wifi: Wifi,
  server: Server,
  cloud: Cloud,
  'hard-drive': HardDrive,
  cpu: Cpu,
  network: Network,
  antenna: Antenna,
  tv: Tv,
  phone: Phone,
};

/**
 * Icono de proyecto. Si `name` es un icono Lucide del catálogo lo pinta como
 * SVG (sigue el tema); si no (emoji legado guardado antes del selector) lo
 * renderiza como texto para no perder datos.
 */
export function ProjectIcon({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const Icon = ICON_MAP[name];
  if (Icon) {
    return <Icon className={className} aria-hidden="true" />;
  }
  return (
    <span className={className} aria-hidden="true">
      {name}
    </span>
  );
}
