export const ADDITIONAL_FOOD_TABS = [
  { id: 'recent', label: 'Recent' },
  { id: 'favourites', label: 'Favourites' },
  { id: 'my-foods', label: 'My Foods' },
] as const;

export function savedFoodLibraryVisible(query: string, selectedCount: number, expanded: boolean) {
  return !query.trim() && (selectedCount === 0 || expanded);
}

/** Adding a saved food never replaces an existing draft or its edited portions. */
export function appendFoodSelection<T extends { food: { id: string } }>(items: T[], addition: T, allowDuplicate = false): T[] {
  if (!allowDuplicate && items.some(item => item.food.id === addition.food.id)) return items;
  return [...items, addition];
}
