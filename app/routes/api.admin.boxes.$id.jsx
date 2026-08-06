import { authenticate } from "../shopify.server";
import { BoxCodeValidationError, getBox, updateBox, deleteBox } from "../models/boxes.server";
import { saveSimpleBox, saveMultipleBox } from "../models/shop.server";

const DESIGN_SETTINGS_FIELDS = [
  "backgroundColor", "cardBorderColor", "imageHeight", "imageHeightMobile",
  "imageDisplay", "productCardDesktopSize", "productCardMobileSize",
  "borderWidth", "borderRadius", "titleTextColor", "titleSize", "titleStyle",
  "productPriceColor", "productPriceSize", "productPriceStyle",
  "compareAtPriceColor", "compareAtPriceSize", "compareAtPriceStyle",
  "ctaBackgroundColor", "ctaTextColor", "ctaSize", "ctaStyle",
  "variantSelectorColor", "variantSelectorSize", "variantSelectorStyle",
  "imagePopupBackgroundColor", "imagePopupTextColor",
];

// These design fields are persisted/read back as integers even though the
// form control for a few of them (TextField vs RangeSlider) hands back a
// string — matches each field's Prisma column type (schema.prisma).
const INT_DESIGN_FIELDS = new Set([
  "imageHeight", "imageHeightMobile", "borderWidth", "borderRadius",
  "titleSize", "productPriceSize", "compareAtPriceSize", "ctaSize", "variantSelectorSize",
]);

const BOOLEAN_PAGE_FIELDS = [
  "hideOutOfStockProducts", "showProductSearch", "hideBundleHeader",
  "hideBannerImage", "hideProductInfoModal", "productImageAutoHeight",
  "displayCompareAtPrice", "redirectToCheckout", "redirectToCart",
];

/**
 * Applies an uploaded-image field (bundleImage/bannerImage) to the page
 * payload. `source[key]` is one of:
 *   - {bytes, mimeType, fileName} — a new upload (bytes is base64)
 *   - null                        — explicit removal
 *   - undefined                   — untouched, leave existing value alone
 */
function applyImageField(payload, source, key) {
  const value = source[key];
  if (value && typeof value === "object" && typeof value.bytes === "string") {
    payload[`${key}Data`] = Buffer.from(value.bytes, "base64");
    payload[`${key}MimeType`] = value.mimeType || null;
    payload[`${key}FileName`] = value.fileName || null;
    payload[`${key}Url`] = null;
  } else if (value === null) {
    payload[`${key}Data`] = null;
    payload[`${key}MimeType`] = null;
    payload[`${key}FileName`] = null;
    payload[`${key}Url`] = null;
  }
}

function buildPagePayload(body) {
  const pageConfig = body?.pageConfig || {};
  const source = { ...pageConfig, ...body };
  const payload = {
    title: source.title || source.boxName || source.displayTitle || null,
    description: source.description || source.boxSubtitle || null,
    status: source.status || "active",
  };

  if (source.productItems != null) payload.productItems = Number.parseInt(String(source.productItems), 10) || 3;
  if (source.buttonLabel != null) payload.buttonLabel = String(source.buttonLabel);
  if (source.bundlePriceType != null) payload.bundlePriceType = source.bundlePriceType;
  if (source.discountMode != null) payload.discountMode = source.discountMode;
  if (source.discountType != null) payload.discountType = source.discountType;
  if (source.discountValue != null) payload.discountValue = source.discountValue;
  if (source.buyQuantity != null) payload.buyQuantity = Number.parseInt(String(source.buyQuantity), 10) || 1;
  if (source.getQuantity != null) payload.getQuantity = Number.parseInt(String(source.getQuantity), 10) || 1;
  if (Array.isArray(source.quantityPacks)) payload.quantityPacks = source.quantityPacks;
  if (Array.isArray(source.selectedProductIds)) payload.selectedProductIdsJson = JSON.stringify(source.selectedProductIds);
  if (Array.isArray(source.selectedCollectionIds)) payload.selectedCollectionIdsJson = JSON.stringify(source.selectedCollectionIds);
  if (Array.isArray(source.selectedGiftProductIds)) payload.selectedGiftProductIdsJson = JSON.stringify(source.selectedGiftProductIds);
  if (Array.isArray(source.eligibility)) payload.eligibilityJson = JSON.stringify(source.eligibility);
  if (source.productConfiguration != null) payload.productConfiguration = source.productConfiguration;
  if (source.customerTags != null) payload.customerTags = source.customerTags;
  if (source.customers != null) payload.customers = source.customers;

  if (source.stepTitle != null) payload.stepTitle = String(source.stepTitle);
  if (source.stepDescription != null) payload.stepDescription = String(source.stepDescription);
  if (source.scheduleType != null) payload.scheduleType = source.scheduleType;
  if (source.startDate != null) payload.startDate = source.startDate || null;
  if (source.startTime != null) payload.startTime = source.startTime || null;
  if (source.hasEndDate != null) payload.hasEndDate = Boolean(source.hasEndDate);
  if (source.endDate != null) payload.endDate = source.endDate || null;
  if (source.endTime != null) payload.endTime = source.endTime || null;

  for (const flag of BOOLEAN_PAGE_FIELDS) {
    if (source[flag] != null) payload[flag] = Boolean(source[flag]);
  }

  for (const field of DESIGN_SETTINGS_FIELDS) {
    if (source[field] == null) continue;
    payload[field] = INT_DESIGN_FIELDS.has(field)
      ? Number.parseInt(String(source[field]), 10) || 0
      : String(source[field]);
  }

  applyImageField(payload, source, "bundleImage");
  applyImageField(payload, source, "bannerImage");

  return payload;
}

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const box = await getBox(parseInt(params.id), session.shop);
  if (!box) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(box);
};

export const action = async ({ request, params }) => {
  const { session, admin } = await authenticate.admin(request);
  const id = parseInt(params.id);

  if (request.method === "DELETE") {
    await deleteBox(id, session.shop, admin);
    return Response.json({ success: true });
  }

  if (request.method === "PUT" || request.method === "PATCH") {
    const body = await request.json();
    try {
      // updateBox() reads its fields off the top level (data.discountMode,
      // data.bannerImage, data.selectedGiftProductIds, ...), matching how
      // createBox() is called below via `dataForCreate`. The frontend nests
      // all of that under `pageConfig`, so without flattening it here,
      // updateBox() only ever sees boxName/displayTitle/itemCount/bundlePrice
      // (the few fields actually sent at the top level) and silently ignores
      // every discount/gift-product/banner-image/toggle change on edit.
      const dataForUpdate = {
        ...body.pageConfig,
        ...body,
      };
      delete dataForUpdate.pageConfig;

      const updated = await updateBox(id, session.shop, dataForUpdate, admin);
      const pagePayload = buildPagePayload(dataForUpdate);
      const persistedBox = Array.isArray(dataForUpdate.quantityPacks) && dataForUpdate.quantityPacks.length > 0
        ? await saveMultipleBox(session.shop, {
            id,
            comboBoxData: {
              boxName: updated?.boxName || dataForUpdate.boxName,
              displayTitle: updated?.displayTitle || dataForUpdate.displayTitle,
              isActive: updated?.isActive ?? true,
            },
            multipleBoxPageData: pagePayload,
          })
        : await saveSimpleBox(session.shop, {
            id,
            comboBoxData: {
              boxName: updated?.boxName || dataForUpdate.boxName,
              displayTitle: updated?.displayTitle || dataForUpdate.displayTitle,
              isActive: updated?.isActive ?? true,
            },
            simpleBoxPageData: pagePayload,
          });
      return Response.json(persistedBox || updated);
    } catch (error) {
      if (error instanceof BoxCodeValidationError || error?.name === "BoxCodeValidationError") {
        return Response.json({ error: error.message }, { status: 400 });
      }

      throw error;
    }
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};
