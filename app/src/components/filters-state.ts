import type { Priority } from '@/data/types';

export interface FilterState {
  projects: Set<string>;
  people: Set<string>; // user id | 'none'
  priorities: Set<Priority>;
  tags: Set<string>;
}

export const emptyFilters = (): FilterState => ({
  projects: new Set(),
  people: new Set(),
  priorities: new Set(),
  tags: new Set(),
});
