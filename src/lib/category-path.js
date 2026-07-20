export function categoryPathForTags(categories = [], tags = []) {
  const tagSet = new Set(tags);

  for (const category of categories) {
    const child = category.children?.find((key) => tagSet.has(key));
    if (child) return [category.key, child];
    if (tagSet.has(category.key)) return [category.key];
  }

  return [];
}
