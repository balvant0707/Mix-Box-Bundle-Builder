import { listBoxes } from "../models/boxes.server";
import { unauthenticated } from "../shopify.server";
import { getOrderCreditStatus } from "../models/order-credit.server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

async function getActiveBillingCycleForShop(shop) {
  try {
    const { admin } = await unauthenticated.admin(shop);
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

export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (!shop) {
    return Response.json({ error: "shop parameter required" }, { status: 400, headers: CORS_HEADERS });
  }

  const boxes = await listBoxes(shop, true, false);

  // Check order limits by billing cycle:
  // monthly plans => count current month, yearly plans => count current year.
  const { getSubscription } = await import("../models/subscription.server.js");
  const subscription = await getSubscription(shop);
  const billingCycle = await getActiveBillingCycleForShop(shop);
  const orderCredit = await getOrderCreditStatus({
    shop,
    subscription,
    billingCycle,
    now: new Date(),
  });
  const orderLimitReached = orderCredit.orderLimitReached;

  const publicBoxes = boxes.map((box) => {
    const bannerImageUrl = box.bannerImageUrl || null;
    // Flag so the widget can build the URL via the app proxy (avoids cross-origin issues)
    const hasUploadedBanner = !bannerImageUrl && !!box.bannerImageMimeType;
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
      boxCode: box.boxCode || null,
      boxName: box.boxName,
      displayTitle: box.displayTitle,
      boxSubtitle: typeof rawComboConfig?.boxSubtitle === "string" ? rawComboConfig.boxSubtitle : null,
      ctaButtonLabel,
      addToCartLabel,
      productButtonTitle: addToCartLabel,
      itemCount: box.itemCount,
      bundlePrice: parseFloat(box.bundlePrice),
      isGiftBox: box.isGiftBox,
      allowDuplicates: box.allowDuplicates,
      bannerImageUrl,
      hasUploadedBanner,
      giftMessageEnabled: giftMessageEnabledFromConfig !== null
        ? giftMessageEnabledFromConfig
        : box.giftMessageEnabled,
      shopifyProductId: box.shopifyProductId ? box.shopifyProductId.split('/').pop() : null,
      shopifyVariantId: box.shopifyVariantId ? box.shopifyVariantId.split('/').pop() : null,
      bundlePriceType: box.bundlePriceType || "manual",
      sortOrder: box.sortOrder,
      pageHandle: box.pageHandle || null,
      scopeType: box.scopeType || "specific_collections",
      comboConfig: (() => {
        // Fallback: parse raw comboStepsConfig JSON when ComboBoxConfig relation is missing
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
