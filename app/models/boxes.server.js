import db, { ensureAppTables } from "../db.server";
import { Buffer } from "node:buffer";

// Generate a 5-digit unique box code
const BOX_CODE_CHARS = "0123456789";
const BOX_CODE_MIN_LENGTH = 3;
const BOX_CODE_MAX_LENGTH = 10;
const BOX_CODE_PATTERN = /^\d+$/;

function normalizeDiscountConfigForPriceType({
  bundlePriceType,
  discountMode,
  discountType,
  discountValue,
  buyQuantity,
  getQuantity,
  selectedGiftProductIds,
  fallbackDiscountType = "none",
  fallbackDiscountValue = "0",
  fallbackBuyQuantity = 1,
  fallbackGetQuantity = 1,
  fallbackSelectedGiftProductIds = [],
}) {
  const uiDiscountMode = String(discountMode || "");
  // "fixed_amount" means the entered value IS the bundle's flat price — a
  // manual price override, not a discount subtracted from a dynamically
  // computed total. Only "flat_discount" (% or $ off the selected products'
  // combined price) and "free_gift_product" (dynamic total + a free item)
  // actually need dynamic pricing with a computed discount.
  const hasUiDiscountMode = ["flat_discount", "free_gift_product"].includes(uiDiscountMode);
  const safePriceType = bundlePriceType === "dynamic" || hasUiDiscountMode ? "dynamic" : "manual";
  if (safePriceType !== "dynamic") {
    return {
      bundlePriceType: "manual",
      discountType: "none",
      discountValue: "0",
      buyQuantity: 1,
      getQuantity: 1,
      selectedGiftProductIds: [],
    };
  }

  const requestedGiftProductIds =
    selectedGiftProductIds !== undefined ? selectedGiftProductIds : fallbackSelectedGiftProductIds;
  const giftProductIds = Array.isArray(requestedGiftProductIds)
    ? requestedGiftProductIds.filter(Boolean)
    : [];
  let requestedType = String(discountType ?? fallbackDiscountType ?? "none");
  if (uiDiscountMode === "free_gift_product") requestedType = "buy_x_get_y";
  if (requestedType === "percentage") requestedType = "percent";
  if (requestedType === "fixed_amount") requestedType = "fixed";

  const normalizedType = ["none", "percent", "fixed", "buy_x_get_y"].includes(requestedType)
    ? requestedType
    : "none";
  const safeBuyQuantity = Math.max(
    1,
    parseInt(String(buyQuantity ?? fallbackBuyQuantity ?? 1), 10) || 1,
  );
  const safeGetQuantity = Math.max(
    1,
    parseInt(String(getQuantity ?? fallbackGetQuantity ?? 1), 10) || 1,
  );
  const normalizedDiscountValue = normalizedType === "buy_x_get_y"
    ? "100"
    : normalizedType === "none"
      ? "0"
      : String(discountValue ?? fallbackDiscountValue ?? "0");

  return {
    bundlePriceType: "dynamic",
    discountType: normalizedType,
    discountValue: normalizedDiscountValue,
    buyQuantity: safeBuyQuantity,
    getQuantity: safeGetQuantity,
    selectedGiftProductIds: giftProductIds,
  };
}

export class BoxCodeValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "BoxCodeValidationError";
  }
}

export function isBoxCodeValidationError(error) {
  return error instanceof BoxCodeValidationError || error?.name === "BoxCodeValidationError";
}

function generateBoxCode() {
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += BOX_CODE_CHARS[Math.floor(Math.random() * BOX_CODE_CHARS.length)];
  }
  return code;
}

async function getUniqueBoxCode(shop) {
  let code, exists;
  do {
    code = generateBoxCode();
    exists = await db.comboBox.findFirst({ where: { shop, boxCode: code }, select: { id: true } });
  } while (exists);
  return code;
}

async function getRequestedBoxCode(shop, rawValue, excludeId = null) {
  const normalized = rawValue == null ? "" : String(rawValue).trim().toUpperCase();
  if (!normalized) return null;
  if (excludeId) {
    const existingRecord = await db.comboBox.findUnique({
      where: { id: parseInt(excludeId) },
      select: { boxCode: true },
    });
    if (existingRecord?.boxCode === normalized) {
      return normalized;
    }
  }
  if (normalized.length < BOX_CODE_MIN_LENGTH || normalized.length > BOX_CODE_MAX_LENGTH) {
    throw new BoxCodeValidationError(`Box code must be ${BOX_CODE_MIN_LENGTH}-${BOX_CODE_MAX_LENGTH} characters long`);
  }
  if (!BOX_CODE_PATTERN.test(normalized)) {
    throw new BoxCodeValidationError("Box code can only contain numbers");
  }

  const where = excludeId
    ? { shop, boxCode: normalized, NOT: { id: parseInt(excludeId) } }
    : { shop, boxCode: normalized };
  const existing = await db.comboBox.findFirst({
    where,
    select: { id: true },
  });
  if (existing) {
    throw new BoxCodeValidationError("Box code is already in use");
  }

  return normalized;
}

const RESOLVE_PRODUCTS_BY_ID_QUERY = `#graphql
  query ResolveBundleProductsById($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        title
        handle
        status
        featuredImage { url }
        variants(first: 100) {
          edges { node { id price availableForSale } }
        }
      }
    }
  }
`;

const RESOLVE_PRODUCTS_BY_COLLECTION_QUERY = `#graphql
  query ResolveBundleProductsByCollection($id: ID!, $first: Int!, $after: String) {
    collection(id: $id) {
      products(first: $first, after: $after) {
        edges {
          node {
            id
            title
            handle
            status
            featuredImage { url }
            variants(first: 100) {
              edges { node { id price availableForSale } }
            }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

function mapGraphqlProductNode(node, { hideOutOfStockProducts = false } = {}) {
  if (!node || node.status !== "ACTIVE") return null;
  const variantEdges = node.variants?.edges || [];
  if (hideOutOfStockProducts && !variantEdges.some((edge) => edge.node?.availableForSale)) {
    return null;
  }
  const firstPrice = variantEdges[0]?.node?.price;
  return {
    id: node.id,
    productId: node.id,
    productTitle: node.title,
    productImageUrl: node.featuredImage?.url || null,
    productHandle: node.handle,
    productPrice: firstPrice != null ? parseFloat(firstPrice) : null,
    isCollection: false,
    variantIds: variantEdges.map((edge) => String(edge.node.id).split("/").pop()),
  };
}

/**
 * Resolves the live Shopify products a storefront box widget should offer,
 * based on the box's Simple/Multiple Box Page product configuration
 * ("selected_products" or "selected_collections"; "whole_store" is resolved
 * client-side by the widget itself via /products.json).
 */
export async function resolveSelectableProducts(
  admin,
  { productConfiguration, selectedProductIds = [], selectedCollectionIds = [], hideOutOfStockProducts = false },
) {
  if (productConfiguration === "selected_products") {
    const ids = (selectedProductIds || []).filter(Boolean);
    if (ids.length === 0) return [];
    const resp = await admin.graphql(RESOLVE_PRODUCTS_BY_ID_QUERY, { variables: { ids } });
    const json = await resp.json();
    return (json?.data?.nodes || [])
      .map((node) => mapGraphqlProductNode(node, { hideOutOfStockProducts }))
      .filter(Boolean);
  }

  if (productConfiguration === "selected_collections") {
    const collectionIds = (selectedCollectionIds || []).filter(Boolean);
    if (collectionIds.length === 0) return [];
    const seenIds = new Set();
    const results = [];
    for (const collectionId of collectionIds) {
      let cursor = null;
      let hasNextPage = true;
      while (hasNextPage) {
        const resp = await admin.graphql(RESOLVE_PRODUCTS_BY_COLLECTION_QUERY, {
          variables: { id: collectionId, first: 100, after: cursor },
        });
        const json = await resp.json();
        const connection = json?.data?.collection?.products;
        for (const edge of connection?.edges || []) {
          const mapped = mapGraphqlProductNode(edge.node, { hideOutOfStockProducts });
          if (mapped && !seenIds.has(mapped.productId)) {
            seenIds.add(mapped.productId);
            results.push(mapped);
          }
        }
        hasNextPage = connection?.pageInfo?.hasNextPage || false;
        cursor = connection?.pageInfo?.endCursor || null;
      }
    }
    return results;
  }

  // "whole_store" (and anything unrecognized) has no server-side product list —
  // the widget fetches it directly from the storefront /products.json.
  return [];
}

const CREATE_BUNDLE_PRODUCT_MUTATION = `#graphql
  mutation productCreate($product: ProductCreateInput!) {
    productCreate(product: $product) {
      product {
        id
        variants(first: 1) {
          edges {
            node {
              id
            }
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const GET_PRODUCT_DEFAULT_VARIANT_QUERY = `#graphql
  query GetProductDefaultVariant($id: ID!) {
    product(id: $id) {
      id
      variants(first: 1) {
        edges {
          node {
            id
          }
        }
      }
    }
  }
`;

const GET_PUBLICATIONS_QUERY = `#graphql
  query GetPublications {
    publications(first: 20) {
      edges {
        node {
          id
          name
          catalog {
            title
          }
        }
      }
    }
  }
`;

const PUBLISH_TO_CHANNEL_MUTATION = `#graphql
  mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) {
      publishable { ... on Product { id } }
      userErrors { field message }
    }
  }
`;

const UPDATE_BUNDLE_PRODUCT_PRICE_MUTATION = `#graphql
  mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants {
        id
        price
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const ACTIVATE_BUNDLE_PRODUCT_MUTATION = `#graphql
  mutation productUpdate($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      product { id status }
      userErrors { field message }
    }
  }
`;

const DELETE_BUNDLE_PRODUCT_MUTATION = `#graphql
  mutation productDelete($input: ProductDeleteInput!) {
    productDelete(input: $input) {
      deletedProductId
      userErrors {
        field
        message
      }
    }
  }
`;

const DISCOUNT_AUTOMATIC_BASIC_CREATE_MUTATION = `#graphql
  mutation discountAutomaticBasicCreate($automaticBasicDiscount: DiscountAutomaticBasicInput!) {
    discountAutomaticBasicCreate(automaticBasicDiscount: $automaticBasicDiscount) {
      automaticDiscountNode {
        id
        automaticDiscount {
          ... on DiscountAutomaticBasic {
            title
            status
            customerGets {
              value {
                ... on DiscountPercentage { percentage }
                ... on DiscountAmount { amount { amount currencyCode } }
              }
            }
          }
        }
      }
      userErrors { field message }
    }
  }
`;

const DISCOUNT_AUTOMATIC_BASIC_UPDATE_MUTATION = `#graphql
  mutation discountAutomaticBasicUpdate($id: ID!, $automaticBasicDiscount: DiscountAutomaticBasicInput!) {
    discountAutomaticBasicUpdate(id: $id, automaticBasicDiscount: $automaticBasicDiscount) {
      automaticDiscountNode {
        id
        automaticDiscount {
          ... on DiscountAutomaticBasic {
            title
            status
          }
        }
      }
      userErrors { field message }
    }
  }
`;

const DISCOUNT_AUTOMATIC_BXGY_CREATE_MUTATION = `#graphql
  mutation discountAutomaticBxgyCreate($automaticBxgyDiscount: DiscountAutomaticBxgyInput!) {
    discountAutomaticBxgyCreate(automaticBxgyDiscount: $automaticBxgyDiscount) {
      automaticDiscountNode {
        id
      }
      userErrors { field message }
    }
  }
`;

const DISCOUNT_AUTOMATIC_DELETE_MUTATION = `#graphql
  mutation discountAutomaticDelete($id: ID!) {
    discountAutomaticDelete(id: $id) {
      deletedAutomaticDiscountId
      userErrors { field message }
    }
  }
`;

function buildProductScopedItems(shopifyProductId) {
  if (!shopifyProductId) return { all: true };
  return {
    products: {
      productsToAdd: [shopifyProductId],
    },
  };
}

/**
 * Build the DiscountAutomaticBasicInput object for create/update mutations.
 * Scope the discount to the combo bundle product only.
 */
function buildDiscountInput({ title, discountType, discountValue, shopifyProductId }) {
  const pct = parseFloat(discountValue) || 0;
  const scopedItems = buildProductScopedItems(shopifyProductId);
  const customerGets = discountType === "fixed"
    ? { value: { discountAmount: { amount: String(pct), appliesOnEachItem: false } }, items: scopedItems }
    : { value: { percentage: pct / 100 }, items: scopedItems };
  const combinesWith = {
    productDiscounts: true,
    orderDiscounts: true,
    shippingDiscounts: false,
  };

  return {
    title,
    startsAt: new Date().toISOString(),
    customerGets,
    combinesWith,
  };
}

/**
 * Build the DiscountAutomaticBxgyInput object for create mutation.
 * Default behavior: buy 1 bundle, get 1 bundle discount.
 */
function buildBuyXGetYDiscountInput({
  title,
  discountType,
  discountValue,
  shopifyProductId,
  giftProductId,
  buyQuantity = 1,
  getQuantity = 1,
}) {
  const parsedValue = parseFloat(discountValue) || 0;
  const safeBuyQty = Math.max(1, parseInt(String(buyQuantity), 10) || 1);
  const safeGetQty = Math.max(1, parseInt(String(getQuantity), 10) || 1);

  const customerGetsValue = discountType === "buy_x_get_y"
    ? { percentage: 1 } // Free Y item
    : discountType === "fixed"
      ? { discountAmount: { amount: String(parsedValue), appliesOnEachItem: true } }
      : { percentage: Math.min(1, Math.max(0, parsedValue / 100)) };
  const buyItems = buildProductScopedItems(shopifyProductId);
  const getItems = buildProductScopedItems(giftProductId || shopifyProductId);
  const combinesWith = {
    productDiscounts: true,
    orderDiscounts: true,
    shippingDiscounts: false,
  };

  return {
    title,
    startsAt: new Date().toISOString(),
    customerBuys: {
      value: { quantity: String(safeBuyQty) },
      items: buyItems,
    },
    customerGets: {
      value: customerGetsValue,
      items: getItems,
      quantity: { quantity: String(safeGetQty) },
    },
    combinesWith,
  };
}

/** True when a caught error is a Shopify "missing write_discounts scope" error. */
function isScopeError(e) {
  const msg = e?.message || "";
  return msg.includes("write_discounts") || msg.includes("Access denied") || msg.includes("access scope");
}

async function deleteShopifyAutomaticDiscount(admin, discountId, context = "discount") {
  if (!admin || !discountId) return true;
  try {
    const resp = await admin.graphql(DISCOUNT_AUTOMATIC_DELETE_MUTATION, {
      variables: { id: discountId },
    });
    const json = await resp.json();
    const errors = json?.data?.discountAutomaticDelete?.userErrors || [];
    if (errors.length > 0) {
      const msg = errors.map((e) => e?.message || "").join(" ").toLowerCase();
      // Treat "already deleted / not found" as success for cleanup flows.
      if (msg.includes("not found") || msg.includes("doesn't exist") || msg.includes("invalid id")) {
        return true;
      }
      console.error(`[deleteShopifyAutomaticDiscount] ${context} userErrors:`, errors);
      return false;
    }
    return true;
  } catch (e) {
    if (!isScopeError(e)) {
      console.error(`[deleteShopifyAutomaticDiscount] ${context} error:`, e);
    }
    return false;
  }
}

/**
 * Create or update an automatic basic discount in Shopify for a dynamic-priced box.
 * Returns the discount GID, or null on failure.
 * Silently skips (returns null) when the app token lacks write_discounts scope —
 * the scope is declared in shopify.app.toml and will be granted on next merchant re-auth.
 */
export async function syncShopifyDiscount(admin, { boxId, existingDiscountId, title, discountType, discountValue, shopifyProductId }) {
  if (!admin || !shopifyProductId) return null;
  if (!discountType || discountType === "none" || !(parseFloat(discountValue) > 0)) {
    // Remove existing discount if switching away from dynamic
    if (existingDiscountId) {
      try {
        const deleted = await deleteShopifyAutomaticDiscount(
          admin,
          existingDiscountId,
          "syncShopifyDiscount:disable",
        );
        if (deleted) {
          await db.comboBox.update({ where: { id: boxId }, data: { shopifyDiscountId: null } });
        }
      } catch (e) {
        if (!isScopeError(e)) console.error("[syncShopifyDiscount] delete error:", e);
      }
    }
    return null;
  }

  const input = buildDiscountInput({ title, discountType, discountValue, shopifyProductId });

  try {
    if (existingDiscountId) {
      const updateResp = await admin.graphql(DISCOUNT_AUTOMATIC_BASIC_UPDATE_MUTATION, {
        variables: { id: existingDiscountId, automaticBasicDiscount: input },
      });
      const updateJson = await updateResp.json();
      const updateErrors = updateJson?.data?.discountAutomaticBasicUpdate?.userErrors || [];
      if (updateErrors.length === 0) {
        return existingDiscountId;
      }

      // Existing discount may be BXGY from older saves; recreate as Basic.
      console.warn("[syncShopifyDiscount] update userErrors; recreating as basic:", updateErrors);
      await deleteShopifyAutomaticDiscount(
        admin,
        existingDiscountId,
        "syncShopifyDiscount:recreate",
      );
    }

    const createResp = await admin.graphql(DISCOUNT_AUTOMATIC_BASIC_CREATE_MUTATION, {
      variables: { automaticBasicDiscount: input },
    });
    const createJson = await createResp.json();
    const createErrors = createJson?.data?.discountAutomaticBasicCreate?.userErrors || [];
    if (createErrors.length) {
      console.error("[syncShopifyDiscount] create userErrors:", createErrors);
      return null;
    }
    const discountId = createJson?.data?.discountAutomaticBasicCreate?.automaticDiscountNode?.id || null;
    if (discountId && boxId) {
      await db.comboBox.update({ where: { id: boxId }, data: { shopifyDiscountId: discountId } });
    }
    return discountId;
  } catch (e) {
    if (isScopeError(e)) {
      // write_discounts not yet granted — merchant must re-authorize the app.
      // Scope is declared in shopify.app.toml; re-auth happens automatically on next app open.
      console.warn("[syncShopifyDiscount] write_discounts scope not yet granted — discount skipped until merchant re-authorizes.");
    } else {
      console.error("[syncShopifyDiscount] error:", e);
    }
    return existingDiscountId || null;
  }
}

/**
 * Create a Buy X Get Y automatic discount in Shopify.
 * For specific combo boxes this is called only when bundlePriceType is dynamic.
 * Existing discount (basic or bxgy) is deleted and recreated to avoid type mismatch.
 */
export async function syncShopifyBuyXGetYDiscount(
  admin,
  {
    boxId,
    existingDiscountId,
    title,
    discountType,
    discountValue,
    shopifyProductId,
    giftProductId,
    buyQuantity = 1,
    getQuantity = 1,
  },
) {
  if (!admin || !shopifyProductId) return null;

  const hasValidDiscount =
    discountType &&
    discountType !== "none" &&
    (discountType === "buy_x_get_y" || parseFloat(discountValue) > 0);

  if (!hasValidDiscount) {
    if (existingDiscountId) {
      try {
        const deleted = await deleteShopifyAutomaticDiscount(
          admin,
          existingDiscountId,
          "syncShopifyBuyXGetYDiscount:disable",
        );
        if (deleted) {
          await db.comboBox.update({
            where: { id: parseInt(boxId) },
            data: { shopifyDiscountId: null },
          });
        }
      } catch (e) {
        if (!isScopeError(e)) {
          console.error("[syncShopifyBuyXGetYDiscount] delete error:", e);
        }
      }
    }
    return null;
  }

  const input = buildBuyXGetYDiscountInput({
    title,
    discountType,
    discountValue,
    shopifyProductId,
    giftProductId,
    buyQuantity,
    getQuantity,
  });

  try {
    // Recreate as BXGY every time to guarantee correct discount type.
    if (existingDiscountId) {
      await deleteShopifyAutomaticDiscount(
        admin,
        existingDiscountId,
        "syncShopifyBuyXGetYDiscount:recreate",
      );
    }

    const resp = await admin.graphql(DISCOUNT_AUTOMATIC_BXGY_CREATE_MUTATION, {
      variables: { automaticBxgyDiscount: input },
    });
    const json = await resp.json();
    const errors = json?.data?.discountAutomaticBxgyCreate?.userErrors || [];
    if (errors.length) {
      console.error("[syncShopifyBuyXGetYDiscount] create userErrors:", errors);
      return existingDiscountId || null;
    }

    const discountId =
      json?.data?.discountAutomaticBxgyCreate?.automaticDiscountNode?.id || null;

    if (boxId) {
      await db.comboBox.update({
        where: { id: parseInt(boxId) },
        data: { shopifyDiscountId: discountId || null },
      });
    }

    return discountId;
  } catch (e) {
    if (isScopeError(e)) {
      console.warn("[syncShopifyBuyXGetYDiscount] write_discounts scope not granted yet.");
    } else {
      console.error("[syncShopifyBuyXGetYDiscount] error:", e);
    }
    return existingDiscountId || null;
  }
}

const STAGED_UPLOADS_CREATE_MUTATION = `#graphql
  mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters { name value }
      }
      userErrors { field message }
    }
  }
`;

const PRODUCT_CREATE_MEDIA_MUTATION = `#graphql
  mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
    productCreateMedia(productId: $productId, media: $media) {
      media { status }
      mediaUserErrors { field message }
    }
  }
`;

const GET_PRODUCT_MEDIA_QUERY = `#graphql
  query GetProductMedia($id: ID!) {
    product(id: $id) {
      media(first: 50) {
        edges {
          node {
            id
            ... on MediaImage {
              image { url }
            }
          }
        }
      }
    }
  }
`;

const PRODUCT_DELETE_MEDIA_MUTATION = `#graphql
  mutation productDeleteMedia($productId: ID!, $mediaIds: [ID!]!) {
    productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
      deletedMediaIds
      product { id }
      mediaUserErrors { field message }
    }
  }
`;

// Cache the Online Store publication ID within a warm serverless container.
let _cachedPubId = null;

async function getOnlineStorePublicationId(admin) {
  if (_cachedPubId) return _cachedPubId;
  try {
    const r = await admin.graphql(GET_PUBLICATIONS_QUERY);
    const j = await r.json();
    const edges = j?.data?.publications?.edges || [];
    // Online Store publication has name "Online Store" and catalog: null
    // Must NOT filter by catalog != null — that excludes Online Store
    const os =
      edges.find((e) => (e?.node?.name || "").toLowerCase() === "online store") ||
      edges.find((e) => (e?.node?.catalog?.title || "").toLowerCase() === "online store") ||
      edges[0]; // last resort: first publication
    _cachedPubId = os?.node?.id || null;
    if (!_cachedPubId) {
      console.warn("[getOnlineStorePublicationId] No publications found — product will not be purchasable via storefront");
    }
    return _cachedPubId;
  } catch (e) {
    console.error("[getOnlineStorePublicationId] error:", e);
    return null;
  }
}

// imageSource: a URL string, or { bytes: Buffer, mimeType, fileName }
async function addImageToProduct(admin, productId, imageSource) {
  let imageUrl = null;

  if (typeof imageSource === "string" && imageSource.startsWith("http")) {
    imageUrl = imageSource;
  } else if (imageSource?.bytes) {
    // Binary upload — use staged upload to get a Shopify-hosted URL
    try {
      const byteLength = Buffer.byteLength(imageSource.bytes);
      const stageResp = await admin.graphql(STAGED_UPLOADS_CREATE_MUTATION, {
        variables: {
          input: [{
            filename: imageSource.fileName || "banner.jpg",
            mimeType: imageSource.mimeType || "image/jpeg",
            httpMethod: "POST",
            resource: "IMAGE",
            fileSize: String(byteLength),
          }],
        },
      });
      const stageJson = await stageResp.json();
      const target = stageJson?.data?.stagedUploadsCreate?.stagedTargets?.[0];
      if (!target) throw new Error("No staged target returned");

      const form = new FormData();
      for (const p of target.parameters) form.append(p.name, p.value);
      form.append(
        "file",
        new Blob([imageSource.bytes], { type: imageSource.mimeType || "image/jpeg" }),
        imageSource.fileName || "banner.jpg",
      );

      const uploadResp = await fetch(target.url, { method: "POST", body: form });
      if (!uploadResp.ok) throw new Error(`Staged upload HTTP ${uploadResp.status}`);
      imageUrl = target.resourceUrl;
    } catch (e) {
      console.warn("[addImageToProduct] staged upload failed:", e.message);
      return;
    }
  }

  if (!imageUrl) return;

  try {
    await admin.graphql(PRODUCT_CREATE_MEDIA_MUTATION, {
      variables: {
        productId,
        media: [{ originalSource: imageUrl, mediaContentType: "IMAGE" }],
      },
    });
  } catch (e) {
    console.warn("[addImageToProduct] productCreateMedia failed:", e.message);
  }
}

/** Fetch existing media URLs already attached to a Shopify product. */
async function getExistingProductMedia(admin, productId) {
  try {
    const resp = await admin.graphql(GET_PRODUCT_MEDIA_QUERY, { variables: { id: productId } });
    const json = await resp.json();
    return (json?.data?.product?.media?.edges || [])
      .map((e) => ({ id: e?.node?.id, url: e?.node?.image?.url }))
      .filter((m) => m.id);
  } catch (e) {
    console.warn("[getExistingProductMedia] failed:", e.message);
    return [];
  }
}

/**
 * Delete all existing media from a Shopify product, then optionally add a new image.
 * Used when the banner image is changed or removed on an existing box.
 */
async function replaceProductImage(admin, productId, imageSource) {
  try {
    const existing = await getExistingProductMedia(admin, productId);
    if (existing.length > 0) {
      const mediaIds = existing.map((m) => m.id);
      const delResp = await admin.graphql(PRODUCT_DELETE_MEDIA_MUTATION, {
        variables: { productId, mediaIds },
      });
      const delJson = await delResp.json();
      const delErrors = delJson?.data?.productDeleteMedia?.mediaUserErrors || [];
      if (delErrors.length) console.warn("[replaceProductImage] deleteMedia errors:", delErrors);
    }
  } catch (e) {
    console.warn("[replaceProductImage] delete existing media failed:", e.message);
  }

  if (imageSource) {
    await addImageToProduct(admin, productId, imageSource);
  }
}

function extractGraphqlMessages(payload) {
  const topLevelErrors = Array.isArray(payload?.errors)
    ? payload.errors
        .map((error) => error?.message)
        .filter((message) => typeof message === "string" && message.length > 0)
    : [];
  return topLevelErrors;
}

function formatUserErrors(userErrors) {
  return (userErrors || [])
    .map((err) => {
      const field = Array.isArray(err?.field)
        ? err.field.join(".")
        : err?.field || "unknown";
      const message = err?.message || "Unknown error";
      return `${field}: ${message}`;
    })
    .join("; ");
}

async function resolveDefaultVariantId(admin, shopifyProductId) {
  if (!shopifyProductId) return null;

  try {
    const resp = await admin.graphql(GET_PRODUCT_DEFAULT_VARIANT_QUERY, {
      variables: { id: shopifyProductId },
    });
    const json = await resp.json();

    const topLevelErrors = extractGraphqlMessages(json);
    if (topLevelErrors.length > 0) {
      console.error(
        "[resolveDefaultVariantId] GraphQL errors:",
        topLevelErrors,
      );
      return null;
    }

    return (
      json?.data?.product?.variants?.edges?.[0]?.node?.id ||
      null
    );
  } catch (e) {
    console.error("[resolveDefaultVariantId] error:", e);
    return null;
  }
}

export async function createShopifyBundleProduct(admin, title, bundlePrice, imageSource = null) {
  // Step 1: Create product
  const resp = await admin.graphql(CREATE_BUNDLE_PRODUCT_MUTATION, {
    variables: {
      product: {
        title,
        status: "ACTIVE",
        vendor: "ComboBuilder",
        tags: ["combo-builder-internal"],
      },
    },
  });
  const json = await resp.json();
  const topLevelErrors = extractGraphqlMessages(json);
  if (topLevelErrors.length > 0) {
    throw new Error(
      `Shopify productCreate failed: ${topLevelErrors.join(" | ")}`,
    );
  }

  const userErrors = json?.data?.productCreate?.userErrors || [];
  if (userErrors.length > 0) {
    throw new Error(
      `Shopify productCreate userErrors: ${formatUserErrors(userErrors)}`,
    );
  }

  const product = json?.data?.productCreate?.product;
  if (!product) {
    throw new Error("Shopify productCreate returned no product");
  }

  const shopifyProductId = product.id;
  let shopifyVariantId = product.variants?.edges?.[0]?.node?.id || null;
  if (!shopifyVariantId) {
    shopifyVariantId = await resolveDefaultVariantId(admin, shopifyProductId);
  }
  if (!shopifyVariantId) {
    throw new Error(
      "Shopify product created but default variant was not resolved",
    );
  }

  // Step 2: Update default variant price
  if (shopifyVariantId && bundlePrice > 0) {
    try {
      const priceResp = await admin.graphql(UPDATE_BUNDLE_PRODUCT_PRICE_MUTATION, {
        variables: {
          productId: shopifyProductId,
          variants: [{ id: shopifyVariantId, price: String(bundlePrice) }],
        },
      });
      const priceJson = await priceResp.json();
      const priceTopLevelErrors = extractGraphqlMessages(priceJson);
      const priceUserErrors =
        priceJson?.data?.productVariantsBulkUpdate?.userErrors || [];

      if (priceTopLevelErrors.length > 0 || priceUserErrors.length > 0) {
        console.error(
          "[createShopifyBundleProduct] productVariantsBulkUpdate errors:",
          {
            errors: priceTopLevelErrors,
            userErrors: priceUserErrors,
          },
        );
      }
    } catch (e) {
      console.error("[createShopifyBundleProduct] productVariantsBulkUpdate error:", e);
    }
  }

  // Step 3: Attach banner image if provided
  if (imageSource) {
    await addImageToProduct(admin, shopifyProductId, imageSource);
  }

  // Step 4: Publish to Online Store so /cart/add.js accepts it
  const pubId = await getOnlineStorePublicationId(admin);
  if (pubId) {
    try {
      const publishResp = await admin.graphql(PUBLISH_TO_CHANNEL_MUTATION, {
        variables: { id: shopifyProductId, input: [{ publicationId: pubId }] },
      });
      const publishJson = await publishResp.json();
      const publishTopLevelErrors = extractGraphqlMessages(publishJson);
      const publishUserErrors =
        publishJson?.data?.publishablePublish?.userErrors || [];

      if (publishTopLevelErrors.length > 0 || publishUserErrors.length > 0) {
        console.error(
          "[createShopifyBundleProduct] publishablePublish errors:",
          {
            errors: publishTopLevelErrors,
            userErrors: publishUserErrors,
          },
        );
      }
    } catch (e) {
      console.error("[createShopifyBundleProduct] publish error:", e);
    }
  } else {
    console.warn("[createShopifyBundleProduct] Could not find Online Store publication ID — product may not be purchasable via storefront");
  }

  return { shopifyProductId, shopifyVariantId };
}

function getBannerImageDataUri(box) {
  if (!box?.bannerImageData || !box?.bannerImageMimeType) return null;
  const base64 = Buffer.from(box.bannerImageData).toString("base64");
  return `data:${box.bannerImageMimeType};base64,${base64}`;
}

export function getBannerImageSrc(box) {
  return box?.bannerImageUrl || getBannerImageDataUri(box);
}

export async function listBoxes(shop, activeOnly = false, includeBannerBinary = false) {
  await ensureAppTables();
  const where = {
    shop,
    deletedAt: null,
    ...(activeOnly ? { isActive: true } : {}),
  };

  const boxes = await db.comboBox.findMany({
    where,
    select: {
      id: true,
      shop: true,
      boxName: true,
      displayTitle: true,
      comboProductButtonTitle: true,
      productButtonTitle: true,
      itemCount: true,
      bundlePrice: true,
      bundlePriceType: true,
      isGiftBox: true,
      allowDuplicates: true,
      bannerImageUrl: true,
      bannerImageMimeType: true,
      ...(includeBannerBinary ? { bannerImageData: true } : {}),
      sortOrder: true,
      isActive: true,
      giftMessageEnabled: true,
      shopifyProductId: true,
      shopifyVariantId: true,
      shopifyDiscountId: true,
      deletedAt: true,
      createdAt: true,
      updatedAt: true,
      comboStepsConfig: true,
      pageHandle: true,
      boxCode: true,
      simpleBoxPage: { select: { id: true, title: true, status: true, productConfiguration: true } },
      multipleBoxPage: { select: { id: true, title: true, status: true, productConfiguration: true } },
      _count: { select: { orders: true } },
    },
    orderBy: { sortOrder: "asc" },
  });

  // Lazy backfill: assign a boxCode to any existing box that doesn't have one
  const noCode = boxes.filter((b) => !b.boxCode);
  if (noCode.length > 0) {
    await Promise.all(
      noCode.map(async (b) => {
        const code = await getUniqueBoxCode(b.shop);
        await db.comboBox.update({ where: { id: b.id }, data: { boxCode: code } });
        b.boxCode = code;
      })
    );
  }

  if (includeBannerBinary) {
    return boxes.map((box) => ({ ...box, bundlePrice: toPlainNumber(box.bundlePrice) }));
  }

  return boxes.map((box) => ({
    ...box,
    bundlePrice: toPlainNumber(box.bundlePrice),
    boxType: box.simpleBoxPage ? "single" : box.multipleBoxPage ? "multiple" : "single",
    pageTitle: box.simpleBoxPage?.title || box.multipleBoxPage?.title || null,
    pageStatus: box.simpleBoxPage?.status || box.multipleBoxPage?.status || null,
  }));
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];

  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function buildImageDataUri(data, mimeType, url) {
  if (data) {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    return `data:${mimeType || "image/jpeg"};base64,${buffer.toString("base64")}`;
  }
  return url || null;
}

// Mirrors DEFAULT_DESIGN_SETTINGS in the edit forms (app.single.jsx etc):
// a handful of these are read back as strings even though the column is an
// Int, because the TextField controls that display them expect a string.
function buildDesignSettingsForRead(page) {
  return {
    backgroundColor: page.backgroundColor,
    cardBorderColor: page.cardBorderColor,
    imageHeight: page.imageHeight,
    imageHeightMobile: page.imageHeightMobile,
    imageDisplay: page.imageDisplay,
    productCardDesktopSize: page.productCardDesktopSize,
    productCardMobileSize: page.productCardMobileSize,
    borderWidth: String(page.borderWidth),
    borderRadius: page.borderRadius,
    titleTextColor: page.titleTextColor,
    titleSize: String(page.titleSize),
    titleStyle: page.titleStyle,
    productPriceColor: page.productPriceColor,
    productPriceSize: String(page.productPriceSize),
    productPriceStyle: page.productPriceStyle,
    compareAtPriceColor: page.compareAtPriceColor,
    compareAtPriceSize: String(page.compareAtPriceSize),
    compareAtPriceStyle: page.compareAtPriceStyle,
    ctaBackgroundColor: page.ctaBackgroundColor,
    ctaTextColor: page.ctaTextColor,
    ctaSize: String(page.ctaSize),
    ctaStyle: page.ctaStyle,
    variantSelectorColor: page.variantSelectorColor,
    variantSelectorSize: String(page.variantSelectorSize),
    variantSelectorStyle: page.variantSelectorStyle,
    imagePopupBackgroundColor: page.imagePopupBackgroundColor,
    imagePopupTextColor: page.imagePopupTextColor,
  };
}

// Prisma returns `Decimal` columns as Decimal.js instances, not plain
// numbers/strings. That's fine for routes that respond via Response.json()
// (JSON.stringify calls toString() on them correctly), but admin page loaders
// here return plain objects, which React Router serializes for hydration via
// turbo-stream — and turbo-stream has no revival logic for an arbitrary
// Decimal.js class instance, so the value silently breaks in transit to the
// browser. Convert every Decimal field to a plain number before it leaves
// this module so it's safe under either serialization path.
function toPlainNumber(value) {
  if (value === null || value === undefined) return value;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : value;
}

function buildPageConfigFromSimpleBoxPage(page) {
  if (!page) return null;

  const { bundleImageData, bannerImageData, ...rest } = page;
  return {
    ...rest,
    discountValue: toPlainNumber(page.discountValue),
    bundleImage: buildImageDataUri(bundleImageData, page.bundleImageMimeType, page.bundleImageUrl),
    bannerImage: buildImageDataUri(bannerImageData, page.bannerImageMimeType, page.bannerImageUrl),
    designSettings: buildDesignSettingsForRead(page),
    selectedProductIds: parseJsonArray(page.selectedProductIdsJson),
    selectedCollectionIds: parseJsonArray(page.selectedCollectionIdsJson),
    selectedGiftProductIds: parseJsonArray(page.selectedGiftProductIdsJson),
    eligibility: parseJsonArray(page.eligibilityJson),
  };
}

function buildPageConfigFromMultipleBoxPage(page) {
  if (!page) return null;

  const { bundleImageData, bannerImageData, ...rest } = page;
  return {
    ...rest,
    discountValue: toPlainNumber(page.discountValue),
    bundleImage: buildImageDataUri(bundleImageData, page.bundleImageMimeType, page.bundleImageUrl),
    bannerImage: buildImageDataUri(bannerImageData, page.bannerImageMimeType, page.bannerImageUrl),
    designSettings: buildDesignSettingsForRead(page),
    selectedProductIds: parseJsonArray(page.selectedProductIdsJson),
    selectedCollectionIds: parseJsonArray(page.selectedCollectionIdsJson),
    selectedGiftProductIds: parseJsonArray(page.selectedGiftProductIdsJson),
    eligibility: parseJsonArray(page.eligibilityJson),
    quantityPacks: (page.quantityPacks || []).map((pack) => ({
      ...pack,
      discountValue: toPlainNumber(pack.discountValue),
      selectedProductIds: parseJsonArray(pack.selectedProductIdsJson),
      selectedCollectionIds: parseJsonArray(pack.selectedCollectionIdsJson),
      selectedGiftProductIds: parseJsonArray(pack.selectedGiftProductIdsJson),
      eligibility: parseJsonArray(pack.eligibilityJson),
    })),
  };
}

export async function getBox(id, shop) {
  const box = await db.comboBox.findFirst({
    where: { id: parseInt(id), shop, deletedAt: null },
    select: {
      id: true,
      shop: true,
      boxName: true,
      displayTitle: true,
      comboProductButtonTitle: true,
      productButtonTitle: true,
      itemCount: true,
      bundlePrice: true,
      bundlePriceType: true,
      isGiftBox: true,
      allowDuplicates: true,
      bannerImageUrl: true,
      bannerImageFileName: true,
      bannerImageMimeType: true,
      sortOrder: true,
      isActive: true,
      giftMessageEnabled: true,
      shopifyProductId: true,
      shopifyVariantId: true,
      shopifyDiscountId: true,
      deletedAt: true,
      createdAt: true,
      updatedAt: true,
      comboStepsConfig: true,
      pageHandle: true,
      boxCode: true,
      simpleBoxPage: true,
      multipleBoxPage: {
        include: { quantityPacks: true },
      },
    },
  });

  if (!box) return null;

  const pageConfig = box.simpleBoxPage
    ? buildPageConfigFromSimpleBoxPage(box.simpleBoxPage)
    : buildPageConfigFromMultipleBoxPage(box.multipleBoxPage);

  return {
    ...box,
    bundlePrice: toPlainNumber(box.bundlePrice),
    pageConfig,
  };
}

export async function createBox(shop, data, admin) {
  const itemCount = parseInt(data.itemCount) || 1;
  const bundlePrice = parseFloat(data.bundlePrice) || 0;
  const discountConfig = normalizeDiscountConfigForPriceType({
    bundlePriceType: data.bundlePriceType === "dynamic" ? "dynamic" : "manual",
    discountMode: data.discountMode,
    discountType: data.discountType,
    discountValue: data.discountValue,
    buyQuantity: data.buyQuantity,
    getQuantity: data.getQuantity,
    selectedGiftProductIds: data.selectedGiftProductIds,
  });
  const bundleProductTitle = data.boxName || data.displayTitle;
  const comboProductButtonTitle =
    typeof data.comboProductButtonTitle === "string" && data.comboProductButtonTitle.trim()
      ? data.comboProductButtonTitle.trim()
      : null;
  const productButtonTitle =
    typeof data.productButtonTitle === "string" && data.productButtonTitle.trim()
      ? data.productButtonTitle.trim()
      : null;

  // Create hidden Shopify product for bundle pricing
  let shopifyProductId = null;
  let shopifyVariantId = null;

  if (admin) {
    try {
      const imageSource =
        data.bannerImageUrl ||
        (data.bannerImage?.bytes
          ? { bytes: data.bannerImage.bytes, mimeType: data.bannerImage.mimeType, fileName: data.bannerImage.fileName }
          : null);
      const result = await createShopifyBundleProduct(
        admin,
        bundleProductTitle,
        bundlePrice,
        imageSource,
      );
      shopifyProductId = result.shopifyProductId;
      shopifyVariantId = result.shopifyVariantId;
    } catch (e) {
      console.error("[createBox] Failed to create Shopify product", e);
      const message =
        e instanceof Error && e.message
          ? e.message
          : "Failed to create Shopify product in admin";
      throw new Error(message);
    }
  }

  const nextSortOrder = await getNextSortOrder(shop);
  const requestedBoxCode = await getRequestedBoxCode(shop, data.boxCode);
  const boxCode = requestedBoxCode || await getUniqueBoxCode(shop);

  const hasUploadedBanner = Boolean(data.bannerImage?.bytes);

  const box = await db.comboBox.create({
    data: {
      shop,
      boxCode,
      boxName: data.boxName,
      displayTitle: data.displayTitle,
      comboProductButtonTitle,
      productButtonTitle,
      itemCount,
      bundlePrice,
      isGiftBox: data.isGiftBox === "true" || data.isGiftBox === true,
      allowDuplicates:
        data.allowDuplicates === "true" || data.allowDuplicates === true,
      bannerImageUrl: hasUploadedBanner ? null : data.bannerImageUrl || null,
      bannerImageData: hasUploadedBanner ? data.bannerImage.bytes : null,
      bannerImageMimeType: hasUploadedBanner ? data.bannerImage.mimeType : null,
      bannerImageFileName: hasUploadedBanner ? data.bannerImage.fileName : null,
      sortOrder: nextSortOrder,
      isActive: data.isActive !== "false" && data.isActive !== false,
      giftMessageEnabled:
        data.giftMessageEnabled === "true" || data.giftMessageEnabled === true,
      bundlePriceType: discountConfig.bundlePriceType,
      shopifyProductId,
      shopifyVariantId,
      comboStepsConfig: JSON.stringify({
        bundlePriceType: discountConfig.bundlePriceType,
        discountType: discountConfig.discountType,
        discountValue: discountConfig.discountValue,
        buyQuantity: discountConfig.buyQuantity,
        getQuantity: discountConfig.getQuantity,
        selectedGiftProductIds: discountConfig.selectedGiftProductIds,
        discountMode: data.discountMode || null,
        ...(Array.isArray(data.quantityPacks) ? { quantityPacks: data.quantityPacks } : {}),
        ...(Array.isArray(data.selectedProductIds) ? { selectedProductIds: data.selectedProductIds } : {}),
        ...(Array.isArray(data.selectedCollectionIds) ? { selectedCollectionIds: data.selectedCollectionIds } : {}),
        ...(data.productConfiguration ? { productConfiguration: data.productConfiguration } : {}),
        bundlePrice: bundlePrice,
        boxSubtitle: typeof data.boxSubtitle === "string" ? data.boxSubtitle.trim() : "",
        ...(comboProductButtonTitle ? { ctaButtonLabel: comboProductButtonTitle } : {}),
        ...(productButtonTitle ? { addToCartLabel: productButtonTitle } : {}),
      }),
    },
  });

  // Create Shopify automatic discount for dynamic-priced boxes
  if (admin && discountConfig.bundlePriceType === "dynamic" && shopifyProductId) {
    if (discountConfig.discountType === "buy_x_get_y") {
      await syncShopifyBuyXGetYDiscount(admin, {
        boxId: box.id,
        existingDiscountId: null,
        title: `${data.boxName || data.displayTitle} Bundle Discount`,
        discountType: "buy_x_get_y",
        discountValue: "100",
        shopifyProductId,
        giftProductId: discountConfig.selectedGiftProductIds[0] || null,
        buyQuantity: discountConfig.buyQuantity,
        getQuantity: discountConfig.getQuantity,
      });
    } else {
      await syncShopifyDiscount(admin, {
        boxId: box.id,
        existingDiscountId: null,
        title: `${data.boxName || data.displayTitle} Bundle Discount`,
        discountType: discountConfig.discountType,
        discountValue: discountConfig.discountValue,
        shopifyProductId,
      });
    }
  }

  return db.comboBox.findUnique({ where: { id: box.id } });
}

/**
 * Sync a combo box's title and price to its associated Shopify bundle product.
 * Call this whenever combo config is saved (price or title may have changed).
 */
export async function syncShopifyBundleProduct(admin, shopifyProductId, shopifyVariantId, { title, bundlePrice }) {
  if (!admin || !shopifyProductId) return;

  try {
    await admin.graphql(ACTIVATE_BUNDLE_PRODUCT_MUTATION, {
      variables: {
        product: {
          id: shopifyProductId,
          status: "ACTIVE",
          title,
        },
      },
    });
  } catch (e) {
    console.error("[syncShopifyBundleProduct] Failed to update product title/status:", e);
  }

  if (bundlePrice != null) {
    const variantId = shopifyVariantId || (await resolveDefaultVariantId(admin, shopifyProductId));
    if (variantId) {
      try {
        await admin.graphql(UPDATE_BUNDLE_PRODUCT_PRICE_MUTATION, {
          variables: {
            productId: shopifyProductId,
            variants: [{ id: variantId, price: String(bundlePrice) }],
          },
        });
      } catch (e) {
        console.error("[syncShopifyBundleProduct] Failed to update product price:", e);
      }
    }
  }
}

export async function updateBox(id, shop, data, admin = null) {
  const existing = await db.comboBox.findFirst({
    where: { id: parseInt(id), shop, deletedAt: null },
  });
  if (!existing) throw new Error("Box not found");

  let existingConfig = {};
  if (existing.comboStepsConfig) {
    try { existingConfig = JSON.parse(existing.comboStepsConfig); } catch {}
  }

  const effectiveBundlePriceType = data.bundlePriceType !== undefined
    ? (data.bundlePriceType === "dynamic" ? "dynamic" : "manual")
    : (existing.bundlePriceType === "dynamic" ? "dynamic" : "manual");
  const discountConfig = normalizeDiscountConfigForPriceType({
    bundlePriceType: effectiveBundlePriceType,
    discountMode: data.discountMode,
    discountType: data.discountType,
    discountValue: data.discountValue,
    buyQuantity: data.buyQuantity,
    getQuantity: data.getQuantity,
    selectedGiftProductIds: data.selectedGiftProductIds,
    fallbackDiscountType: existingConfig.discountType,
    fallbackDiscountValue: existingConfig.discountValue,
    fallbackBuyQuantity: existingConfig.buyQuantity,
    fallbackGetQuantity: existingConfig.getQuantity,
    fallbackSelectedGiftProductIds: existingConfig.selectedGiftProductIds,
  });

  const requestedBoxCode = data.boxCode !== undefined
    ? await getRequestedBoxCode(shop, data.boxCode, id)
    : undefined;
  const nextBoxCode = data.boxCode !== undefined
    ? (requestedBoxCode || existing.boxCode || await getUniqueBoxCode(shop))
    : (existing.boxCode || await getUniqueBoxCode(shop));

  const bundlePrice = parseFloat(data.bundlePrice) || existing.bundlePrice;
  const nextComboProductButtonTitle = data.comboProductButtonTitle !== undefined
    ? (typeof data.comboProductButtonTitle === "string" && data.comboProductButtonTitle.trim()
      ? data.comboProductButtonTitle.trim()
      : null)
    : existing.comboProductButtonTitle;
  const nextProductButtonTitle = data.productButtonTitle !== undefined
    ? (typeof data.productButtonTitle === "string" && data.productButtonTitle.trim()
      ? data.productButtonTitle.trim()
      : null)
    : existing.productButtonTitle;
  const priceChanged =
    parseFloat(bundlePrice) !== parseFloat(existing.bundlePrice);

  // Ensure bundle product is ACTIVE (may be DRAFT from old boxes) and update price if changed
  let resolvedVariantId = existing.shopifyVariantId;
  const desiredBundleTitle = data.boxName ?? existing.boxName ?? data.displayTitle ?? existing.displayTitle;

  if (existing.shopifyProductId && admin) {
    if (!resolvedVariantId) {
      resolvedVariantId = await resolveDefaultVariantId(
        admin,
        existing.shopifyProductId,
      );
      if (resolvedVariantId) {
        try {
          await db.comboBox.update({
            where: { id: existing.id },
            data: { shopifyVariantId: resolvedVariantId },
          });
          console.log(
            "[updateBox] Repaired missing shopifyVariantId for box",
            existing.id,
          );
        } catch (e) {
          console.error(
            "[updateBox] Failed to persist repaired shopifyVariantId",
            e,
          );
        }
      }
    }

    try {
      await admin.graphql(ACTIVATE_BUNDLE_PRODUCT_MUTATION, {
        variables: {
          product: {
            id: existing.shopifyProductId,
            status: "ACTIVE",
            title: desiredBundleTitle,
          },
        },
      });
    } catch (e) {
      console.error("[updateBox] Failed to activate Shopify product", e);
    }
    if (priceChanged && resolvedVariantId) {
      try {
        await admin.graphql(UPDATE_BUNDLE_PRODUCT_PRICE_MUTATION, {
          variables: {
            productId: existing.shopifyProductId,
            variants: [
              { id: resolvedVariantId, price: String(bundlePrice) },
            ],
          },
        });
      } catch (e) {
        console.error("[updateBox] Failed to update Shopify product price", e);
      }
    }
  }

  const hasUploadedBanner = Boolean(data.bannerImage?.bytes);
  const shouldRemoveBanner = data.removeBannerImage === true;

  await db.comboBox.update({
    where: { id: parseInt(id) },
    data: {
      boxCode: nextBoxCode,
      boxName: data.boxName ?? existing.boxName,
      displayTitle: data.displayTitle ?? existing.displayTitle,
      comboProductButtonTitle: nextComboProductButtonTitle,
      productButtonTitle: nextProductButtonTitle,
      itemCount: data.itemCount ? parseInt(data.itemCount) : existing.itemCount,
      bundlePrice,
      isGiftBox:
        data.isGiftBox !== undefined
          ? data.isGiftBox === "true" || data.isGiftBox === true
          : existing.isGiftBox,
      allowDuplicates:
        data.allowDuplicates !== undefined
          ? data.allowDuplicates === "true" || data.allowDuplicates === true
          : existing.allowDuplicates,
      bannerImageUrl: hasUploadedBanner
        ? null
        : shouldRemoveBanner
          ? null
          : data.bannerImageUrl !== undefined
            ? data.bannerImageUrl || null
            : existing.bannerImageUrl,
      bannerImageData: hasUploadedBanner
        ? data.bannerImage.bytes
        : shouldRemoveBanner
          ? null
          : existing.bannerImageData,
      bannerImageMimeType: hasUploadedBanner
        ? data.bannerImage.mimeType
        : shouldRemoveBanner
          ? null
          : existing.bannerImageMimeType,
      bannerImageFileName: hasUploadedBanner
        ? data.bannerImage.fileName
        : shouldRemoveBanner
          ? null
          : existing.bannerImageFileName,
      isActive:
        data.isActive !== undefined
          ? data.isActive !== "false" && data.isActive !== false
          : existing.isActive,
      giftMessageEnabled:
        data.giftMessageEnabled !== undefined
          ? data.giftMessageEnabled === "true" ||
            data.giftMessageEnabled === true
          : existing.giftMessageEnabled,
      bundlePriceType: discountConfig.bundlePriceType,
    },
  });

  // Sync banner image to Shopify product (replace on upload, delete on removal)
  if (existing.shopifyProductId && admin) {
    if (hasUploadedBanner) {
      await replaceProductImage(admin, existing.shopifyProductId, {
        bytes: data.bannerImage.bytes,
        mimeType: data.bannerImage.mimeType,
        fileName: data.bannerImage.fileName,
      });
    } else if (shouldRemoveBanner) {
      await replaceProductImage(admin, existing.shopifyProductId, null);
    }
  }

  // Persist discount settings into comboStepsConfig (merge, preserve existing steps/config)
  if (
    data.bundlePriceType !== undefined ||
    data.discountType !== undefined ||
    data.discountValue !== undefined ||
    data.discountMode !== undefined ||
    data.selectedGiftProductIds !== undefined ||
    data.quantityPacks !== undefined ||
    data.selectedProductIds !== undefined ||
    data.selectedCollectionIds !== undefined ||
    data.productConfiguration !== undefined ||
    data.buyQuantity !== undefined ||
    data.getQuantity !== undefined ||
    data.boxSubtitle !== undefined ||
    data.comboProductButtonTitle !== undefined ||
    data.productButtonTitle !== undefined
  ) {
    let rawConfig = {};
    if (existing.comboStepsConfig) {
      try { rawConfig = JSON.parse(existing.comboStepsConfig); } catch {}
    }
    rawConfig.bundlePriceType = discountConfig.bundlePriceType;
    rawConfig.discountType = discountConfig.discountType;
    rawConfig.discountValue = discountConfig.discountValue;
    rawConfig.buyQuantity = discountConfig.buyQuantity;
    rawConfig.getQuantity = discountConfig.getQuantity;
    rawConfig.selectedGiftProductIds = discountConfig.selectedGiftProductIds;
    if (data.discountMode !== undefined) {
      rawConfig.discountMode = data.discountMode;
    }
    if (Array.isArray(data.quantityPacks)) {
      rawConfig.quantityPacks = data.quantityPacks;
    }
    if (Array.isArray(data.selectedProductIds)) {
      rawConfig.selectedProductIds = data.selectedProductIds;
    }
    if (Array.isArray(data.selectedCollectionIds)) {
      rawConfig.selectedCollectionIds = data.selectedCollectionIds;
    }
    if (data.productConfiguration !== undefined) {
      rawConfig.productConfiguration = data.productConfiguration;
    }
    rawConfig.bundlePrice = bundlePrice;
    if (data.boxSubtitle !== undefined) {
      rawConfig.boxSubtitle = typeof data.boxSubtitle === "string" ? data.boxSubtitle.trim() : "";
    }
    if (data.comboProductButtonTitle !== undefined) {
      if (nextComboProductButtonTitle) {
        rawConfig.ctaButtonLabel = nextComboProductButtonTitle;
      } else {
        delete rawConfig.ctaButtonLabel;
      }
    }
    if (data.productButtonTitle !== undefined) {
      if (nextProductButtonTitle) {
        rawConfig.addToCartLabel = nextProductButtonTitle;
      } else {
        delete rawConfig.addToCartLabel;
      }
    }
    await db.comboBox.update({
      where: { id: parseInt(id) },
      data: { comboStepsConfig: JSON.stringify(rawConfig) },
    });
  }

  // Sync Shopify automatic discount for dynamic-priced boxes
  if (admin && existing.shopifyProductId) {
    if (discountConfig.discountType === "buy_x_get_y") {
      await syncShopifyBuyXGetYDiscount(admin, {
        boxId: parseInt(id),
        existingDiscountId: existing.shopifyDiscountId || null,
        title: `${data.boxName ?? existing.boxName} Bundle Discount`,
        discountType: "buy_x_get_y",
        discountValue: "100",
        shopifyProductId: existing.shopifyProductId,
        giftProductId: discountConfig.selectedGiftProductIds[0] || null,
        buyQuantity: discountConfig.buyQuantity,
        getQuantity: discountConfig.getQuantity,
      });
    } else {
      await syncShopifyDiscount(admin, {
        boxId: parseInt(id),
        existingDiscountId: existing.shopifyDiscountId || null,
        title: `${data.boxName ?? existing.boxName} Bundle Discount`,
        discountType: discountConfig.discountType,
        discountValue: discountConfig.discountValue,
        shopifyProductId: existing.shopifyProductId,
      });
    }
  }

  return db.comboBox.findUnique({ where: { id: parseInt(id) } });
}

export async function deleteBox(id, shop, admin = null) {
  const existing = await db.comboBox.findFirst({
    where: { id: parseInt(id), shop, deletedAt: null },
  });
  if (!existing) throw new Error("Box not found");

  // Delete the associated Shopify bundle product
  if (admin && existing.shopifyProductId) {
    try {
      await admin.graphql(DELETE_BUNDLE_PRODUCT_MUTATION, {
        variables: { input: { id: existing.shopifyProductId } },
      });
    } catch (e) {
      console.error("[deleteBox] Failed to delete Shopify product", e);
    }
  }

  // Delete associated Shopify automatic discount
  if (admin && existing.shopifyDiscountId) {
    const deleted = await deleteShopifyAutomaticDiscount(
      admin,
      existing.shopifyDiscountId,
      "deleteBox",
    );
    if (!deleted) {
      console.error("[deleteBox] Failed to delete Shopify discount", existing.shopifyDiscountId);
    }
  }

  return db.comboBox.update({
    where: { id: parseInt(id) },
    data: { deletedAt: new Date(), isActive: false },
  });
}

export async function toggleBoxStatus(id, shop, isActive) {
  return db.comboBox.updateMany({
    where: { id: parseInt(id), shop, deletedAt: null },
    data: { isActive },
  });
}

export async function reorderBoxes(shop, orderedIds) {
  const updates = orderedIds.map((id, index) =>
    db.comboBox.updateMany({
      where: { id: parseInt(id), shop },
      data: { sortOrder: index },
    }),
  );
  return Promise.all(updates);
}

async function getNextSortOrder(shop) {
  const last = await db.comboBox.findFirst({
    where: { shop, deletedAt: null },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  return (last?.sortOrder ?? -1) + 1;
}

export async function activateAllBundleProducts(shop, admin) {
  const boxes = await db.comboBox.findMany({
    where: { shop, deletedAt: null, shopifyProductId: { not: null } },
    select: { id: true, shopifyProductId: true },
  });
  await Promise.all(boxes.map(async (box) => {
    try {
      await admin.graphql(ACTIVATE_BUNDLE_PRODUCT_MUTATION, {
        variables: { product: { id: box.shopifyProductId, status: "ACTIVE" } },
      });
    } catch (e) {
      console.error("[activateAllBundleProducts] Failed for box", box.id, e);
    }
  }));
}

export async function repairMissingShopifyProducts(shop, admin) {
  const boxes = await db.comboBox.findMany({
    where: { shop, deletedAt: null, shopifyProductId: null },
    select: { id: true, boxName: true, displayTitle: true, bundlePrice: true },
  });
  if (boxes.length === 0) return;

  await Promise.all(boxes.map(async (box) => {
    try {
      const { shopifyProductId, shopifyVariantId } = await createShopifyBundleProduct(
        admin,
        box.boxName || box.displayTitle,
        parseFloat(box.bundlePrice),
      );
      if (shopifyProductId) {
        await db.comboBox.update({
          where: { id: box.id },
          data: { shopifyProductId, shopifyVariantId },
        });
        console.log("[repairMissingShopifyProducts] Repaired box", box.id);
      }
    } catch (e) {
      console.error("[repairMissingShopifyProducts] Failed for box", box.id, e);
    }
  }));
}

export async function repairMissingShopifyVariantIds(shop, admin) {
  const boxes = await db.comboBox.findMany({
    where: {
      shop,
      deletedAt: null,
      shopifyProductId: { not: null },
      shopifyVariantId: null,
    },
    select: { id: true, shopifyProductId: true },
  });
  if (boxes.length === 0) return;

  await Promise.all(
    boxes.map(async (box) => {
      try {
        const shopifyVariantId = await resolveDefaultVariantId(
          admin,
          box.shopifyProductId,
        );
        if (shopifyVariantId) {
          await db.comboBox.update({
            where: { id: box.id },
            data: { shopifyVariantId },
          });
          console.log("[repairMissingShopifyVariantIds] Repaired box", box.id);
        } else {
          console.warn(
            "[repairMissingShopifyVariantIds] Variant not found for box",
            box.id,
          );
        }
      } catch (e) {
        console.error(
          "[repairMissingShopifyVariantIds] Failed for box",
          box.id,
          e,
        );
      }
    }),
  );
}

export async function getActiveBoxCount(shop) {
  return db.comboBox.count({
    where: { shop, isActive: true, deletedAt: null },
  });
  }
