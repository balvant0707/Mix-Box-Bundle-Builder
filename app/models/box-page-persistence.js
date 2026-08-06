function sanitizePageData(pageData = {}) {
  // Only drop `undefined` (field untouched). `null` is kept intentionally —
  // it's how callers explicitly clear a field (e.g. removing an uploaded
  // image), and every caller already guards against sending an accidental
  // `null` for fields that shouldn't be cleared.
  return Object.fromEntries(
    Object.entries(pageData || {}).filter(([, value]) => value !== undefined),
  );
}

export function buildSimpleBoxPageRelationData(pageData = {}) {
  return {
    create: sanitizePageData(pageData),
    update: sanitizePageData(pageData),
  };
}

export function buildMultipleBoxPageRelationData(pageData = {}, quantityPacks = []) {
  const sanitized = sanitizePageData(pageData);
  const safeQuantityPacks = Array.isArray(quantityPacks) ? quantityPacks : [];
  return {
    create: {
      ...sanitized,
      ...(safeQuantityPacks.length > 0 ? { quantityPacks: { create: safeQuantityPacks } } : {}),
    },
    update: {
      ...sanitized,
      ...(safeQuantityPacks.length > 0 ? {
        quantityPacks: {
          deleteMany: {},
          create: safeQuantityPacks,
        },
      } : {}),
    },
  };
}
