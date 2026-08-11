import { getStorefrontBoxes } from "../models/boxes.server";
import { authenticate } from "../shopify.server";
import { getOrderCreditStatus } from "../models/order-credit.server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

async function getActiveBillingCycleForShop(admin) {
  try {
    if (!admin) return "monthly";
    const response = await admin.graphql(`#graphql
      query ActiveSubscriptions {
        currentAppInstallation {
          activeSubscriptions {
            name
            status
          }
        }
      }
    `);
    const json = await response.json();
    const activeSub = (json?.data?.currentAppInstallation?.activeSubscriptions || [])
      .find((sub) => String(sub?.status || "").toUpperCase() === "ACTIVE");
    if (!activeSub?.name) return "monthly";

    const { getBillingCycleForPlanName } = await import("../config/billing.js");
    return getBillingCycleForPlanName(activeSub.name);
  } catch {
    return "monthly";
  }
}

function normalizeShopifyProductId(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  return raw.includes("/") ? raw.split("/").pop() : raw;
}

// Discount config is only meaningful for dynamically-priced boxes/packs — for
// "manual" pricing, `discountValue` doubles as the flat bundle price itself
// (set via the "fixed_amount" discountMode), not an amount to subtract from a
// computed total, so it must never be handed to the widget's discount-math
// functions. bundlePriceType is included so the widget can tell which case it
// is and either apply `getComboDiscountBreakdown` (dynamic) or just use the
// price directly (manual) — the exact same rule already applied to box-level
// pricing via `isDynamicBundlePrice(box)` + `box.bundlePrice`.
function buildDiscountConfig(pageConfig) {
  if (!pageConfig) return null;
  return {
    bundlePriceType: pageConfig.bundlePriceType || "manual",
    discountMode: pageConfig.discountMode || "fixed_amount",
    discountType: pageConfig.discountType || "fixed",
    discountValue: pageConfig.discountValue != null ? pageConfig.discountValue : 0,
    buyQuantity: pageConfig.buyQuantity || 1,
    getQuantity: pageConfig.getQuantity || 1,
    selectedGiftProductIds: Array.isArray(pageConfig.selectedGiftProductIds) ? pageConfig.selectedGiftProductIds : [],
  };
}

export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const url = new URL(request.url);
  const { session, admin } = await authenticate.public.appProxy(request);
  const shop = session?.shop || url.searchParams.get("shop");
  const productId = normalizeShopifyProductId(url.searchParams.get("productId"));

  if (!shop || !admin) {
    return Response.json({ error: "shop parameter required" }, { status: 400, headers: CORS_HEADERS });
  }

  const boxes = await getStorefrontBoxes(shop, undefined, {
    includeImageData: false,
    imageUrlBuilder: (field, _page, box) => `/api/storefront/boxes/${box.id}/image/${field}`,
  });

  // Check order limits by billing cycle:
  // monthly plans => count current month, yearly plans => count current year.
  const { getSubscription } = await import("../models/subscription.server.js");
  const subscription = await getSubscription(shop);
  const billingCycle = await getActiveBillingCycleForShop(admin);
  const orderCredit = await getOrderCreditStatus({
    shop,
    subscription,
    billingCycle,
    now: new Date(),
  });
  const orderLimitReached = orderCredit.orderLimitReached;

  const mappedBoxes = productId
    ? boxes.filter((box) => normalizeShopifyProductId(box.shopifyProductId) === productId)
    : boxes;

  const publicBoxes = mappedBoxes.map((box) => {
    const pageConfig = box.pageConfig || null;
    const bannerImageUrl = box.bannerImageUrl || null;
    const hasUploadedBundleImage =
      typeof pageConfig?.bundleImage === "string" &&
      pageConfig.bundleImage.includes(`/boxes/${box.id}/image/bundleImage`);
    // Flag so the widget can build the URL via the app proxy (avoids cross-origin issues)
    const hasUploadedBanner =
      (!bannerImageUrl && !!box.bannerImageMimeType) ||
      (
        typeof pageConfig?.bannerImage === "string" &&
        pageConfig.bannerImage.includes(`/boxes/${box.id}/image/bannerImage`)
      );
    let rawComboConfig = null;
    if (box.comboStepsConfig) {
      try { rawComboConfig = JSON.parse(box.comboStepsConfig); } catch {}
    }
    const ctaButtonLabelFromBox = typeof box.comboProductButtonTitle === "string" && box.comboProductButtonTitle.trim()
      ? box.comboProductButtonTitle.trim()
      : null;
    const addToCartLabelFromBox = typeof box.productButtonTitle === "string" && box.productButtonTitle.trim()
      ? box.productButtonTitle.trim()
      : null;
    const ctaButtonLabelFromConfig = typeof rawComboConfig?.ctaButtonLabel === "string" && rawComboConfig.ctaButtonLabel.trim()
      ? rawComboConfig.ctaButtonLabel.trim()
      : null;
    const addToCartLabelFromConfig = typeof rawComboConfig?.addToCartLabel === "string" && rawComboConfig.addToCartLabel.trim()
      ? rawComboConfig.addToCartLabel.trim()
      : null;
    const giftMessageEnabledFromConfig =
      rawComboConfig?.giftMessageEnabled !== undefined
        ? (rawComboConfig.giftMessageEnabled === true || String(rawComboConfig.giftMessageEnabled).toLowerCase() === "true")
        : null;
    const ctaButtonLabel = ctaButtonLabelFromBox || ctaButtonLabelFromConfig || null;
    const addToCartLabel = addToCartLabelFromBox || addToCartLabelFromConfig || null;

    return {
      id: box.id,
      boxType: box.simpleBoxPage ? "single" : "multiple",
      boxCode: box.boxCode || null,
      boxName: box.boxName,
      displayTitle: box.displayTitle,
      // Multiple/Single Box's subtitle and page fields live exclusively in
      // simple_box_page/multiple_box_page — never in ComboBox.comboStepsConfig.
      // Legacy "Specific Combo" boxes (no simpleBoxPage/multipleBoxPage relation)
      // still read boxSubtitle from the JSON blob.
      boxSubtitle: pageConfig
        ? (pageConfig.description || null)
        : (typeof rawComboConfig?.boxSubtitle === "string" ? rawComboConfig.boxSubtitle : null),
      ctaButtonLabel,
      addToCartLabel,
      productButtonTitle: addToCartLabel,
      itemCount: box.itemCount,
      bundlePrice: parseFloat(box.bundlePrice),
      isGiftBox: box.isGiftBox,
      isActive: true,
      allowDuplicates: box.allowDuplicates,
      bannerImageUrl,
      bannerImage: pageConfig?.bannerImage || null,
      bundleImage: pageConfig?.bundleImage || null,
      hasUploadedBundleImage,
      hasUploadedBanner,
      giftMessageEnabled: giftMessageEnabledFromConfig !== null
        ? giftMessageEnabledFromConfig
        : box.giftMessageEnabled,
      shopifyProductId: box.shopifyProductId ? box.shopifyProductId.split('/').pop() : null,
      shopifyVariantId: box.shopifyVariantId ? box.shopifyVariantId.split('/').pop() : null,
      bundlePriceType: box.bundlePriceType || "manual",
      sortOrder: box.sortOrder,
      pageHandle: box.pageHandle || null,
      // The widget only distinguishes "wholestore" (resolved client-side via
      // /products.json) from everything else (resolved by the server from the
      // box's Simple/Multiple Box Page product configuration).
      scopeType: pageConfig?.productConfiguration === "whole_store" ? "wholestore" : "specific",

      // ── Fields sourced from simple_box_page / multiple_box_page (never from
      // ComboBox JSON) — every admin-configured Single/Multiple Box field the
      // storefront widget needs to render without hardcoded stand-ins. ──
      stepTitle: pageConfig?.stepTitle || null,
      stepDescription: pageConfig?.stepDescription || null,
      buttonLabel: pageConfig?.buttonLabel || null,
      designSettings: pageConfig?.designSettings || null,
      // hideOutOfStockProducts is enforced server-side only, via
      // resolveSelectableProducts() in the per-box products endpoint — the
      // widget never needs to see or re-apply this toggle itself.
      showProductSearch: !!pageConfig?.showProductSearch,
      hideBundleHeader: !!pageConfig?.hideBundleHeader,
      hideBannerImage: !!pageConfig?.hideBannerImage,
      hideProductInfoModal: !!pageConfig?.hideProductInfoModal,
      productImageAutoHeight: !!pageConfig?.productImageAutoHeight,
      displayCompareAtPrice: !!pageConfig?.displayCompareAtPrice,
      redirectToCheckout: !!pageConfig?.redirectToCheckout,
      redirectToCart: !!pageConfig?.redirectToCart,
      // Only present when the box/page is dynamically priced — see
      // buildDiscountConfig() for why manual pricing must never reach here.
      pageDiscount: pageConfig?.bundlePriceType === "dynamic" ? buildDiscountConfig(pageConfig) : null,
      // Multiple Box only: the customer picks ONE pack, fills it, and the
      // resulting single bundle is added to cart at that pack's own price/
      // discount — see quantityPacks handling in combo-builder.js.
      quantityPacks: Array.isArray(pageConfig?.quantityPacks)
        ? pageConfig.quantityPacks.map((pack) => ({
            packKey: pack.packKey,
            title: pack.title,
            stepTitle: pack.stepTitle || null,
            stepDescription: pack.stepDescription || null,
            productItems: pack.productItems,
            buttonLabel: pack.buttonLabel || null,
            productConfiguration: pack.productConfiguration || "whole_store",
            ...buildDiscountConfig(pack),
          }))
        : [],

      comboConfig: (() => {
        if (box.comboStepsConfig) {
          try {
            const parsed = JSON.parse(box.comboStepsConfig);
            const steps = Array.isArray(parsed.steps) ? parsed.steps : [];
            return {
              comboType: parseInt(parsed.type) || 0,
              title: parsed.title || parsed.listingTitle || null,
              subtitle: parsed.subtitle || null,
              highlightText: typeof parsed.highlightText === "string" ? parsed.highlightText : "",
              supportText: typeof parsed.supportText === "string" ? parsed.supportText : "",
              bundlePriceType: parsed.bundlePriceType || box.bundlePriceType || 'manual',
              bundlePrice: parsed.bundlePrice != null ? parseFloat(parsed.bundlePrice) : 0,
              discountType: parsed.discountType || 'none',
              discountValue: String(parsed.discountValue || '0'),
              buyQuantity: Math.max(1, parseInt(String(parsed.buyQuantity ?? 1), 10) || 1),
              getQuantity: Math.max(1, parseInt(String(parsed.getQuantity ?? 1), 10) || 1),
              ctaButtonLabel: typeof parsed.ctaButtonLabel === "string" && parsed.ctaButtonLabel.trim()
                ? parsed.ctaButtonLabel.trim()
                : ctaButtonLabel,
              addToCartLabel: typeof parsed.addToCartLabel === "string" && parsed.addToCartLabel.trim()
                ? parsed.addToCartLabel.trim()
                : addToCartLabel,
              productButtonTitle: typeof parsed.productButtonTitle === "string" && parsed.productButtonTitle.trim()
                ? parsed.productButtonTitle.trim()
                : (typeof parsed.addToCartLabel === "string" && parsed.addToCartLabel.trim()
                  ? parsed.addToCartLabel.trim()
                  : addToCartLabel),
              steps,
            };
          } catch { return null; }
        }
        return null;
      })(),
    };
  });

  const publicSettings = {
    widgetHeadingText: "Pick your favorite products and build your own box!",
    ctaButtonLabel: null,
    addToCartLabel: null,
    buttonColor: "#2A7A4F",
    activeSlotColor: "#2A7A4F",
    showSavingsBadge: false,
    showProductPrices: false,
    forceShowOos: false,
    presetTheme: "custom",
    widgetMaxWidth: 1140,
    productCardsPerRow: 4,
    orderLimitReached,
  };

  return Response.json({ boxes: publicBoxes, settings: publicSettings }, { headers: CORS_HEADERS });
};
