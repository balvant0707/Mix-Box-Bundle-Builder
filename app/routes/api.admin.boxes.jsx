import { authenticate } from "../shopify.server";
import { BoxCodeValidationError, getSchedulePublicationStatus, listBoxes, createBox } from "../models/boxes.server";
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

/**
 * Converts a client-side quantity pack (raw form state: string temp `id`,
 * array fields like `selectedProductIds`, long-form `discountType`) into the
 * shape Prisma's nested `MultipleBoxQuantityPack` create actually accepts.
 * Without this, the pack objects were passed straight through — a string
 * `id` where an autoincrement Int is required, array fields where the
 * schema has `*Json` string columns, and no `packKey` at all (required,
 * no default) — which throws on save the moment a box has any pack.
 */
function normalizeQuantityPack(pack, index) {
  if (!pack || typeof pack !== "object") return null;

  const discountMode = pack.discountMode || "fixed_amount";
  let discountType = pack.discountType;
  if (discountMode === "fixed_amount") discountType = "fixed";
  else if (discountMode === "free_gift_product") discountType = "buy_x_get_y";
  else if (discountType === "percentage") discountType = "percent";
  else if (discountType === "fixed_amount") discountType = "fixed";
  if (!["fixed", "percent", "buy_x_get_y"].includes(discountType)) discountType = "fixed";

  const bundlePriceType = discountMode === "fixed_amount" ? "manual" : "dynamic";
  const discountValue = discountMode === "free_gift_product" ? "100" : (pack.discountValue || "0");
  const selectedGiftProductIds = discountMode === "free_gift_product" && Array.isArray(pack.selectedGiftProductIds)
    ? pack.selectedGiftProductIds
    : [];

  return {
    packKey: String(pack.id || pack.packKey || `pack-${index + 1}`),
    sortOrder: index,
    title: pack.title ? String(pack.title) : `Pack ${index + 1}`,
    stepTitle: pack.stepTitle ? String(pack.stepTitle) : "Choose your products",
    stepDescription: pack.stepDescription != null ? String(pack.stepDescription) : null,
    productItems: Number.parseInt(String(pack.productItems), 10) || 3,
    buttonLabel: pack.buttonLabel ? String(pack.buttonLabel) : "Add bundle to cart",
    bundlePriceType,
    discountMode,
    discountType,
    discountValue,
    buyQuantity: Number.parseInt(String(pack.buyQuantity), 10) || 1,
    getQuantity: Number.parseInt(String(pack.getQuantity), 10) || 1,
    selectedGiftProductIdsJson: selectedGiftProductIds.length ? JSON.stringify(selectedGiftProductIds) : null,
    productConfiguration: pack.productConfiguration || "whole_store",
    selectedProductIdsJson: Array.isArray(pack.selectedProductIds) ? JSON.stringify(pack.selectedProductIds) : null,
    selectedCollectionIdsJson: Array.isArray(pack.selectedCollectionIds) ? JSON.stringify(pack.selectedCollectionIds) : null,
    scheduleType: pack.scheduleType || "immediately",
    startDate: pack.startDate || null,
    startTime: pack.startTime || null,
    hasEndDate: Boolean(pack.hasEndDate),
    endDate: pack.endDate || null,
    endTime: pack.endTime || null,
  };
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
  if (Array.isArray(source.quantityPacks)) {
    payload.quantityPacks = source.quantityPacks
      .map((pack, index) => normalizeQuantityPack(pack, index))
      .filter(Boolean);
  }
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

  payload.status = getSchedulePublicationStatus(payload);

  return payload;
}

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const boxes = await listBoxes(session.shop);
  return Response.json(boxes);
};

function getActionableSaveError(error) {
  const message = String(error?.message || "").trim();
  if (!message) return "Failed to save bundle. Please review the bundle configuration and try again.";
  if (/Shopify|userErrors|productCreate|productVariantsBulkUpdate|discount/i.test(message)) {
    return message
      .replace(/^Shopify\s+/i, "")
      .replace(/\s+/g, " ")
      .trim();
  }
  return message;
}

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const { session, admin } = await authenticate.admin(request);
  const body = await request.json();
  try {
    // The frontend sends configuration in `pageConfig`, but `createBox` expects a flat object.
    // We merge the nested and top-level properties to create the expected structure.
    const dataForCreate = {
      ...body.pageConfig,
      ...body,
    };
    delete dataForCreate.pageConfig;

    const box = await createBox(session.shop, dataForCreate, admin);
    const pagePayload = buildPagePayload(dataForCreate);
    const nextIsActive = pagePayload.status === "active";
    const boxId = box?.id;
    const persistedBox = Array.isArray(dataForCreate.quantityPacks) && dataForCreate.quantityPacks.length > 0
      ? await saveMultipleBox(session.shop, {
          id: boxId,
          comboBoxData: {
            boxName: box?.boxName || dataForCreate.boxName,
            displayTitle: box?.displayTitle || dataForCreate.displayTitle,
            isActive: nextIsActive,
          },
          multipleBoxPageData: pagePayload,
        })
      : await saveSimpleBox(session.shop, {
          id: boxId,
          comboBoxData: {
            boxName: box?.boxName || dataForCreate.boxName,
            displayTitle: box?.displayTitle || dataForCreate.displayTitle,
            isActive: nextIsActive,
          },
          simpleBoxPageData: pagePayload,
        });
    return Response.json(persistedBox || box, { status: 201 });
  } catch (error) {
    console.error("[api.admin.boxes] failed to save box", error);
    if (error instanceof BoxCodeValidationError || error?.name === "BoxCodeValidationError") {
      return Response.json({ error: error.message }, { status: 400 });
    }

    return Response.json({ error: getActionableSaveError(error) }, { status: 400 });
  }
};
