import {
  BedDouble, Coffee, Croissant, Dumbbell, Scissors, Sparkles, Store, UtensilsCrossed,
  Trophy, type LucideIcon,
} from 'lucide-react';

const map: Record<string, LucideIcon> = {
  Scissors,
  UtensilsCrossed,
  Croissant,
  Coffee,
  Sparkles,
  Dumbbell,
  Store,
  BedDouble,
};

export function categoryIcon(name: string | null | undefined): LucideIcon {
  if (!name) return Trophy;
  return map[name] ?? Trophy;
}
