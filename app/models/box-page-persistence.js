function sanitizePageData(pageData = {}) {
  return Object.fromEntries(
    Object.entries(pageData || {}).filter(([, value]) => value !== undefined && value !== null),
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
