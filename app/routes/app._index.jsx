/* eslint-disable react/prop-types */
import { useEffect, useRef, useState } from "react";
import { useLoaderData, useLocation, useNavigate, useNavigation } from "react-router";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  DataTable,
  EmptyState,
  Icon,
  InlineGrid,
  InlineStack,
  Link,
  Modal,
  Pagination,
  Page,
  Spinner,
  Text,
  Tooltip,
} from "@shopify/polaris";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  EmailIcon,
  PhoneIcon,
  QuestionCircleIcon,
  StarFilledIcon,
  ViewIcon,
} from "@shopify/polaris-icons";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getActiveBoxCount } from "../models/boxes.server";
import { getShopCurrencyCode, getShopOwnerDisplayName } from "../models/shop.server";
import {
  getBundlesSoldCount,
  getBundleRevenue,
  getRecentOrders,
} from "../models/orders.server";
import { getOrderCreditStatus } from "../models/order-credit.server";
import {
  buildThemeEditorUrl,
  buildEmbedBlockUrl,
  getEmbedBlockStatus,
} from "../utils/theme-editor.server";
import { withEmbeddedAppParams } from "../utils/embedded-app";
import { formatCurrencyAmount } from "../utils/currency";

function parseOrderSelectedProducts(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || "").trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((entry) => String(entry || "").trim()).filter(Boolean);
      }
    } catch {
      return [trimmed];
    }
    return [trimmed];
  }
  return [];
}

function getComboTypeFromBox(box) {
  if (!box) return "single";
  if (box.multipleBoxPage) return "multiple";
  if (box.simpleBoxPage) return "single";
  const cfgType = Number.parseInt(box?.config?.comboType, 10);
  if (Number.isFinite(cfgType) && cfgType > 0) return "multiple";
  const raw = typeof box?.comboStepsConfig === "string" ? box.comboStepsConfig.trim() : "";
  if (!raw) return "single";
  try {
    const parsed = JSON.parse(raw);
    const parsedType = Number.parseInt(parsed?.comboType ?? parsed?.type, 10);
    if (Number.isFinite(parsedType) && parsedType > 0) return "multiple";
    if (Array.isArray(parsed?.steps) && parsed.steps.length > 0) return "multiple";
  } catch {
    return "single";
  }
  return "single";
}

function getStoreHandle(shop) {
  return String(shop || "").replace(/\.myshopify\.com$/i, "");
}

function buildThemeEditorFallbackUrl(shop) {
  const storeHandle = getStoreHandle(shop);
  const apiKey = process.env.SHOPIFY_API_KEY?.trim();
  const destination = new URL(`https://admin.shopify.com/store/${storeHandle}/themes/current/editor`);
  destination.searchParams.set("template", "product");
  if (apiKey) {
    destination.searchParams.set("addAppBlockId", `${apiKey}/combo-builder`);
    destination.searchParams.set("target", "newAppsSection");
  }
  return destination.toString();
}

function buildEmbedFallbackUrl(shop) {
  const storeHandle = getStoreHandle(shop);
  const apiKey = process.env.SHOPIFY_API_KEY?.trim();
  const destination = new URL(`https://admin.shopify.com/store/${storeHandle}/themes/current/editor`);
  destination.searchParams.set("context", "apps");
  if (apiKey) {
    destination.searchParams.set("activateAppId", `${apiKey}/combo-embed`);
  }
  return destination.toString();
}

function withTimeout(promise, fallback, ms = 800) {
  return Promise.race([
    promise.catch(() => fallback),
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

export const loader = async ({ request }) => {
  const { session, admin, billing } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const rawWhatsappNumber =
    process.env.WHATSAPP_NUMBER ||
    process.env.WHATSAPP_PHONE ||
    process.env.WHATSAPP_CONTACT_NUMBER ||
    process.env.APP_WHATSAPP_NUMBER ||
    "";
  const whatsappDigits = String(rawWhatsappNumber).replace(/\D/g, "");
  const whatsappLink = whatsappDigits ? `https://wa.me/${whatsappDigits}` : null;
  const supportTicketLink = process.env.SUPPORT_TICKET_URL || null;
  const knowledgeBaseLink = process.env.KNOWLEDGE_BASE_URL || null;
  const reviewLink = process.env.REVIEW_LINK || process.env.APP_REVIEW_URL || null;
  const reportIssueLink = process.env.REPORT_ISSUE_URL || null;

  if (url.searchParams.get("subscribed") === "1") {
    const { syncSubscription } = await import("../models/billing.server.js");
    const { activatePaidPlan } = await import("../models/subscription.server.js");
    const { setShopPlanStatus } = await import("../models/shop.server.js");
    const { subscription } = await syncSubscription(billing, shop);

    if (subscription?.subscriptionId) {
      // Explicitly mark the plan ACTIVE in DB so hasPlanAccess works for all
      // subsequent requests (without ?subscribed=1 in the URL).
      await activatePaidPlan(shop, {
        plan: subscription?.plan || "PLUS",
        subscriptionId: subscription.subscriptionId,
        currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
      }).catch(() => { });
      await setShopPlanStatus(shop, "active").catch(() => { });
    }
  }

  const [activeBoxCount, bundlesSold, bundleRevenue, recentOrders, currencyCode, totalStoreOrdersLast30Days, storeOwnerName] =
    await Promise.all([
      getActiveBoxCount(shop),
      getBundlesSoldCount(shop),
      getBundleRevenue(shop),
      getRecentOrders(shop, 10),
      getShopCurrencyCode(shop),
      Promise.resolve(null),
      getShopOwnerDisplayName(shop),
    ]);

  const [themeEditorUrl, embedBlockUrl, embedBlockEnabled] = await Promise.all([
    withTimeout(buildThemeEditorUrl({ shop, admin }), buildThemeEditorFallbackUrl(shop)),
    withTimeout(buildEmbedBlockUrl({ shop, admin }), buildEmbedFallbackUrl(shop)),
    withTimeout(getEmbedBlockStatus({ shop, admin, session }), false),
  ]);

  // Order limit tracking for upgrade prompt
  const { getSubscription } = await import("../models/subscription.server.js");
  const { PLANS } = await import("../models/subscription.server.js");
  const { getActiveShopifySubscription } = await import("../models/billing.server.js");
  const { getBillingCycleForPlanName } = await import("../config/billing.js");
  const subscription = await getSubscription(shop);
  const currentPlan = PLANS[subscription?.plan] ?? PLANS.FREE;
  const activeShopifySubscription = await getActiveShopifySubscription(billing).catch(() => null);
  const currentPlanDisplayName = activeShopifySubscription?.name || currentPlan.name;
  const currentBillingCycle = activeShopifySubscription?.name
    ? getBillingCycleForPlanName(activeShopifySubscription.name)
    : "monthly";
  const currentPlanKey = String(subscription?.plan || "FREE").trim().toUpperCase();
  const nextPlanLabel = getNextPlanLabel(currentPlanKey);
  const now = new Date();

  const orderCredit = await getOrderCreditStatus({
    shop,
    subscription,
    billingCycle: currentBillingCycle,
    now,
  });
  const bundleConversionRate = totalStoreOrdersLast30Days == null
    ? null
    : totalStoreOrdersLast30Days > 0
      ? (bundlesSold / totalStoreOrdersLast30Days) * 100
      : 0;

  return {
    activeBoxCount,
    bundlesSold,
    bundleRevenue,
    themeEditorUrl,
    embedBlockUrl,
    embedBlockEnabled,
    whatsappLink,
    supportTicketLink,
    knowledgeBaseLink,
    reviewLink,
    reportIssueLink,
    currentPlanName: currentPlanDisplayName,
    orderLimit: orderCredit.orderLimit,
    periodOrderCount: orderCredit.usedOrders,
    orderCreditLeft: orderCredit.remainingOrderCredit,
    orderLimitPeriodLabel: orderCredit.periodLabel,
    nextPlanLabel,
    orderLimitReached: orderCredit.orderLimitReached,
    orderLimitWarning: orderCredit.orderLimitWarning,
    currencyCode,
    totalStoreOrdersLast30Days,
    bundleConversionRate,
    storeOwnerName,
    shopDomain: shop,
    recentOrders: recentOrders.map((order) => {
      return {
      id: order.id,
      orderId: order.orderId,
      orderName:
        order.orderName ||
        null,
      orderNumber:
        order.orderNumber ??
        null,
      boxTitle: order.box?.displayTitle || "Unknown Box",
      itemCount: order.box?.itemCount || 0,
      comboType: getComboTypeFromBox(order.box),
      comboTypeLabel: getComboTypeFromBox(order.box) === "multiple" ? "Multiple" : "Single",
      selectedProducts: parseOrderSelectedProducts(order.selectedProducts),
      selectedProductEntries: parseOrderSelectedProducts(order.selectedProducts).map((label) => ({
        label,
        productId: null,
      })),
      bundlePrice: parseFloat(order.bundlePrice),
      orderDate: order.orderDate.toISOString(),
    };
    }),
  };
};

const quickActions = [
  { key: "manage-boxes", label: "Manage Boxes", sub: "Edit existing combos", href: "/app/boxes" },
  { key: "analytics", label: "View Analytics", sub: "Sales and revenue", href: "/app/analytics" },
];

const promotedApps = [
  {
    key: "fomoify",
    title: "Fomoify Sales Popup and Proof",
    tag: "Social Proof",
    url: "https://apps.shopify.com/fomoify-sales-popup-proof",
    image: "/images/fomoify.png",
    description: "Increase trust using real-time sales popups and conversion proof nudges.",
  },
  {
    key: "boltr-bulk-price-editor",
    title: "Boltr Bulk Price Editor",
    tag: "Pricing",
    url: "https://apps.shopify.com/boltr-bulk-price-editor",
    image: "/images/c0a4f57c6f2803211055e011288accb6_200x200.png",
    description: "Update product prices in bulk and manage pricing changes faster.",
  },
  {
    key: "nex-ai-seo-product-description",
    title: "Nex AI SEO Product Description",
    tag: "SEO",
    url: "https://apps.shopify.com/ai-seo-product-description",
    image: "/images/AI Content App - Final Logo 1.png",
    description: "Generate SEO-friendly content to improve visibility and conversion.",
  },
  {
    key: "cartlift",
    title: "CartLift: Cart Drawer and Upsell",
    tag: "Upsell",
    url: "https://apps.shopify.com/cartlift-cart-drawer-upsell",
    image: "/images/cartlift.png",
    description: "Create a high-converting cart drawer with upsells and progress offers.",
  },
  {
    key: "aria-ai-chatbot-live-chat",
    title: "Aria AI Chatbot & Live Chat",
    tag: "AI Support",
    url: "https://apps.shopify.com/aria-ai-sales-support-agen",
    image: "/images/AI-chat.png",
    description: "Help shoppers faster with AI-powered chat and live support.",
  },
];

function chunkItems(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function PromotedAppBox({ appItem }) {
  return (
    <div
      style={{
        minHeight: "200px",
        padding: "16px",
        border: "1px solid #dcdfe4",
        background: "#ffffff",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "12px",
          height: "100%",
        }}
      >
        <InlineStack align="space-between" blockAlign="start" wrap={false}>
          <img
            src={appItem.image}
            alt={appItem.title}
            loading="lazy"
            style={{
              width: "58px",
              height: "58px",
              objectFit: "contain",
              borderRadius: "8px",
              flexShrink: 0,
            }}
          />
          <Box
            background="bg-surface-secondary"
            borderRadius="200"
            paddingBlock="200"
            paddingInline="300"
          >
            <Text as="span" variant="bodySm" fontWeight="semibold">
              {appItem.tag}
            </Text>
          </Box>
        </InlineStack>
        <Text as="h3" variant="headingSm" fontWeight="bold">
          {appItem.title}
        </Text>
        <Text as="p" tone="subdued" variant="bodyMd">
          {appItem.description}
        </Text>
        <div style={{ marginTop: "auto" }}>
          <a
            href={appItem.url}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: "34px",
              padding: "6px 16px",
              borderRadius: "8px",
              background: "#303030",
              color: "#ffffff",
              fontWeight: 700,
              textDecoration: "none",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.22), 0 1px 2px rgba(0,0,0,0.18)",
            }}
          >
            View app
          </a>
        </div>
      </div>
    </div>
  );
}

function GrowthAppsSlider({ apps }) {
  const slides = chunkItems(apps, 3);
  const [activeSlide, setActiveSlide] = useState(0);
  const [transitionEnabled, setTransitionEnabled] = useState(true);
  const slideCount = slides.length;
  const renderedSlides = slideCount > 1 ? [...slides, slides[0]] : slides;

  useEffect(() => {
    if (slideCount <= 1) return undefined;
    const timer = window.setInterval(() => {
      setTransitionEnabled(true);
      setActiveSlide((current) => current + 1);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [slideCount]);

  if (slideCount === 0) return null;

  const goToPrevious = () => {
    setTransitionEnabled(true);
    setActiveSlide((current) => (current - 1 + slideCount) % slideCount);
  };
  const goToNext = () => {
    setTransitionEnabled(true);
    if (activeSlide >= slideCount) return;
    setActiveSlide((current) => current + 1);
  };
  const handleTrackTransitionEnd = () => {
    if (slideCount <= 1 || activeSlide < slideCount) return;
    setTransitionEnabled(false);
    setActiveSlide(0);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => setTransitionEnabled(true));
    });
  };

  return (
    <BlockStack gap="300">
      <div style={{ overflow: "hidden" }}>
        <div
          style={{
            display: "flex",
            transform: `translateX(-${activeSlide * 100}%)`,
            transition: transitionEnabled ? "transform 520ms ease" : "none",
          }}
          onTransitionEnd={handleTrackTransitionEnd}
        >
          {renderedSlides.map((slide, slideIndex) => (
            <div
              key={`${slide.map((appItem) => appItem.key).join("-")}-${slideIndex}`}
              style={{
                flex: "0 0 100%",
                minWidth: "100%",
              }}
            >
              <InlineGrid columns={{ xs: 1, sm: 2, md: 3 }} gap="400">
                {slide.map((appItem) => (
                  <PromotedAppBox key={appItem.key} appItem={appItem} />
                ))}
              </InlineGrid>
            </div>
          ))}
        </div>
      </div>
      {slideCount > 1 && (
        <InlineStack align="center" blockAlign="center" gap="300">
          <Button
            variant="plain"
            icon={ChevronLeftIcon}
            accessibilityLabel="Previous recommended apps"
            onClick={goToPrevious}
          />
          <InlineStack gap="100" blockAlign="center">
            {slides.map((slide, index) => (
              <button
                key={slide.map((appItem) => appItem.key).join("-")}
                type="button"
                aria-label={`Show recommended apps slide ${index + 1}`}
                aria-current={index === activeSlide % slideCount ? "true" : undefined}
                onClick={() => {
                  setTransitionEnabled(true);
                  setActiveSlide(index);
                }}
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "999px",
                  border: 0,
                  padding: 0,
                  cursor: "pointer",
                  background: index === activeSlide % slideCount ? "#303030" : "#c9cccf",
                }}
              />
            ))}
          </InlineStack>
          <Button
            variant="plain"
            icon={ChevronRightIcon}
            accessibilityLabel="Next recommended apps"
            onClick={goToNext}
          />
        </InlineStack>
      )}
    </BlockStack>
  );
}

function StatCard({ label, value, sub }) {
  return (
    <Card>
      <BlockStack gap="100">
        <Text as="p" variant="bodySm" tone="subdued">
          {label}
        </Text>
        <Text as="p" variant="heading2xl">
          {value}
        </Text>
        <Text as="p" variant="bodySm" tone="subdued">
          {sub}
        </Text>
      </BlockStack>
    </Card>
  );
}

function formatRecentOrderItems(selectedProducts) {
  const items = Array.isArray(selectedProducts)
    ? selectedProducts.map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];
  if (items.length === 0) return "-";
  return items[0];
}

function getNextPlanLabel(planKey) {
  const normalized = String(planKey || "FREE").trim().toUpperCase();
  if (normalized === "FREE") return "Basic";
  if (normalized === "BASIC") return "Advance";
  if (normalized === "ADVANCE") return "Plus";
  return null;
}

function formatOrderPrefixLabel(orderName, orderNumber, orderId) {
  const name = String(orderName || "").trim();
  if (/^#\d+/.test(name)) return name;

  const parsedOrderNumber = Number.parseInt(String(orderNumber), 10);
  if (Number.isFinite(parsedOrderNumber) && parsedOrderNumber > 0) {
    return `#${parsedOrderNumber}`;
  }

  return "-";
}

function buildAdminOrderLink(shopDomain, orderId) {
  const shop = String(shopDomain || "").trim();
  const rawOrderId = String(orderId || "").trim();
  if (!shop || !rawOrderId) return null;
  const storeHandle = shop.replace(/\.myshopify\.com$/i, "");
  if (!storeHandle) return null;
  return `https://admin.shopify.com/store/${storeHandle}/orders/${rawOrderId}`;
}

function buildAdminProductLink(shopDomain, productId) {
  const shop = String(shopDomain || "").trim();
  const numericProductId = String(productId || "").replace(/\D/g, "");
  if (!shop || !numericProductId) return null;
  const storeHandle = shop.replace(/\.myshopify\.com$/i, "");
  if (!storeHandle) return null;
  return `https://admin.shopify.com/store/${storeHandle}/products/${numericProductId}`;
}

export default function DashboardPage() {
  const {
    activeBoxCount,
    bundlesSold,
    bundleRevenue,
    orderLimit,
    periodOrderCount,
    orderCreditLeft,
    themeEditorUrl,
    embedBlockUrl,
    embedBlockEnabled,
    whatsappLink,
    recentOrders,
    currentPlanName,
    currencyCode,
    totalStoreOrdersLast30Days,
    bundleConversionRate,
    storeOwnerName,
    shopDomain,
  } = useLoaderData();

  const location = useLocation();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const [itemsPopup, setItemsPopup] = useState({
    open: false,
    boxTitle: "",
    items: [],
  });
  const navInFlightRef = useRef(false);

  const justSubscribed = new URLSearchParams(location.search).get("subscribed") === "1";
  const isPageLoading = navigation.state !== "idle";
  const RECENT_ORDERS_PAGE_SIZE = 10;

  function navigateTo(path) {
    if (navInFlightRef.current || navigation.state !== "idle") return;
    const target = withEmbeddedAppParams(path, location.search);
    const current = `${location.pathname}${location.search}`;
    if (target === current) return;

    navInFlightRef.current = true;
    try {
      navigate(target);
    } finally {
      setTimeout(() => { navInFlightRef.current = false; }, 500);
    }
  }

  function openItemsPopup(order) {
    const items = Array.isArray(order?.selectedProductEntries)
      ? order.selectedProductEntries
      : Array.isArray(order?.selectedProducts)
        ? order.selectedProducts
          .map((entry) => String(entry || "").trim())
          .filter(Boolean)
          .map((label) => ({ label, productId: null }))
        : [];
    setItemsPopup({
      open: true,
      boxTitle: order?.boxTitle || "Bundle",
      items,
    });
  }

  const stats = [
    { label: "Live", value: activeBoxCount, sub: "" },
    {
      label: "Order Credit Left",
      value: orderLimit == null ? "Unlimited" : `${orderCreditLeft}`,
      sub: orderLimit == null ? "Current billing cycle" : `${periodOrderCount}/${orderLimit} used`,
    },
    { label: "Orders", value: bundlesSold, sub: "Last 30 days" },
    {
      label: "Total Revenue",
      value: formatCurrencyAmount(Number(bundleRevenue || 0), currencyCode, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }),
      sub: "Last 30 days",
    },
    {
      label: "Conversion Rate",
      value: bundleConversionRate == null ? "-" : `${Number(bundleConversionRate).toFixed(0)}%`,
      sub: totalStoreOrdersLast30Days == null
        ? "Unavailable (orders permission/query)"
        : "Last 30 days",
    },
  ];

  const orderTableRows = recentOrders.map((order) => [
    (() => {
      const orderUrl = buildAdminOrderLink(shopDomain, order.orderId);
      const label = formatOrderPrefixLabel(order.orderName, order.orderNumber, order.orderId);
      if (!orderUrl) return label;
      return (
        <Link url={orderUrl} external monochrome removeUnderline>
          <Badge tone="info">{label}</Badge>
        </Link>
      );
    })(),
    (() => {
      const orderUrl = buildAdminOrderLink(shopDomain, order.orderId);
      if (!orderUrl) return order.boxTitle;
      return (
        <Link url={orderUrl} external monochrome removeUnderline>
          {order.boxTitle}
        </Link>
      );
    })(),
    (() => {
      const isMultiple = order.comboType === "multiple";
      return (
        <Badge tone={isMultiple ? "info" : "success"}>
          {isMultiple ? "Multiple" : "Single"}
        </Badge>
      );
    })(),
    (() => {
      const items = Array.isArray(order.selectedProducts)
        ? order.selectedProducts.map((entry) => String(entry || "").trim()).filter(Boolean)
        : [];
      const previewText = formatRecentOrderItems(items);
      const moreCount = Math.max(0, items.length - 1);

      return (
        <InlineStack gap="100" blockAlign="center">
          <Tooltip content={items.join(", ")}>
            <Text as="span" variant="bodySm" truncate>
              {previewText}
            </Text>
          </Tooltip>
          {moreCount > 0 && (
            <Button variant="plain" onClick={() => openItemsPopup(order)}>
              +{moreCount} more
            </Button>
          )}
        </InlineStack>
      );
    })(),
    <Badge tone="success">
      {formatCurrencyAmount(Number(order.bundlePrice || 0), currencyCode)}
    </Badge>,
    new Date(order.orderDate).toLocaleDateString(undefined, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }),
  ]);
  const recentOrdersTotalPages = Math.max(1, Math.ceil(orderTableRows.length / RECENT_ORDERS_PAGE_SIZE));
  const [recentOrdersPage, setRecentOrdersPage] = useState(1);
  const safeRecentOrdersPage = Math.min(recentOrdersPage, recentOrdersTotalPages);
  const paginatedOrderTableRows = orderTableRows.slice(
    (safeRecentOrdersPage - 1) * RECENT_ORDERS_PAGE_SIZE,
    safeRecentOrdersPage * RECENT_ORDERS_PAGE_SIZE,
  );

  return (
    <Page
      title={`Welcome To ${storeOwnerName}`}
      primaryAction={{
        content: "Create Bundle Box",
        onAction: () => navigateTo("/app/create-bundle"),
      }}
      secondaryActions={[
        {
          content: "View Analytics",
          onAction: () => navigateTo("/app/analytics"),
        },
      ]}
    >
      <BlockStack gap="200">
        {/* ── Banners ── */}
        {justSubscribed && (
          <Banner tone="success" title={`Plan activated: ${currentPlanName || "Plan"}`}>
            <InlineStack gap="200" blockAlign="center">
              <p>All features for your new plan are now unlocked.</p>
              <Badge tone="success">{currentPlanName || "Plan"}</Badge>
            </InlineStack>
          </Banner>
        )}

        {/* ── Stats row ── */}
        <InlineGrid columns={{ xs: 2, md: 5 }} gap="400">
          {stats.map((stat) => (
            <StatCard key={stat.label} {...stat} />
          ))}
        </InlineGrid>

        {/* -- Theme App Embed + Theme Setup + Quick Actions -- */}
        <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  Theme App Embed Status
                </Text>
                {embedBlockEnabled ? (
                  <Badge tone="success">On</Badge>
                ) : (
                  <Button url={embedBlockUrl} target="_blank" variant="primary">
                    Activate
                  </Button>
                )}
              </InlineStack>
              <Text as="p" tone="subdued" variant="bodySm">
                Enable the MixBox – Box & Bundle Builder app embed in Theme Customize.
              </Text>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Theme Widget Setup
              </Text>

              <BlockStack gap="150">
                {[
                  "Opens Theme Customization on your live product template.",
                  "Combo Builder block is auto-added to the Apps section.",
                  "Drag the block to the right position.",
                  "Click Save and your storefront is live.",
                ].map((step, i) => (
                  <Text key={i} as="p" variant="bodySm">
                    {i + 1}. {step}
                  </Text>
                ))}
              </BlockStack>

              <Button url={themeEditorUrl} target="_blank" variant="primary" fullWidth>
                Open Shopify Theme Editor
              </Button>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Quick Actions
              </Text>
              <BlockStack gap="200">
                <Button
                  onClick={() => navigateTo("/app/create-bundle")}
                  variant="primary"
                  fullWidth
                >
                  Create Bundle Box
                </Button>
                {quickActions.map((action) => (
                  <Button
                    key={action.key}
                    onClick={() => navigateTo(action.href)}
                    fullWidth
                  >
                    {action.label}
                  </Button>
                ))}
              </BlockStack>
            </BlockStack>
          </Card>
        </InlineGrid>

        {/* -- Recent Orders -- */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                Recent Orders
              </Text>
              <Button variant="plain" onClick={() => navigateTo("/app/analytics")}>
                View all
              </Button>
            </InlineStack>

            {recentOrders.length === 0 ? (
              <EmptyState
                heading="No combo box orders yet"
                action={{
                  content: "Create bundle box",
                  onAction: () => navigateTo("/app/create-bundle"),
                }}
                secondaryAction={{
                  content: "View analytics",
                  onAction: () => navigateTo("/app/analytics"),
                }}
              >
                <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                  Once customers purchase a combo box, orders will appear here.
                </Text>
              </EmptyState>
            ) : (
              <>
                <DataTable
                  columnContentTypes={["text", "text", "text", "text", "text", "text"]}
                  headings={["Order ID", "Name", "Type", "Products", "Revenue", "Date"]}
                  rows={paginatedOrderTableRows}
                  hoverable
                />
                {recentOrdersTotalPages > 1 && (
                  <Box paddingBlockStart="300">
                    <InlineStack align="space-between" blockAlign="center" wrap>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Showing {(safeRecentOrdersPage - 1) * RECENT_ORDERS_PAGE_SIZE + 1}–{Math.min(safeRecentOrdersPage * RECENT_ORDERS_PAGE_SIZE, orderTableRows.length)} of {orderTableRows.length} orders
                      </Text>
                      <Pagination
                        hasPrevious={safeRecentOrdersPage > 1}
                        hasNext={safeRecentOrdersPage < recentOrdersTotalPages}
                        onPrevious={() => setRecentOrdersPage((page) => Math.max(1, page - 1))}
                        onNext={() => setRecentOrdersPage((page) => Math.min(recentOrdersTotalPages, page + 1))}
                      />
                    </InlineStack>
                  </Box>
                )}
              </>
            )}
          </BlockStack>
        </Card>

        {/* Support */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Support</Text>
            <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">

              {/* Book a setup call */}
              <Card>
                <BlockStack gap="300">
                  <div style={{ width: "fit-content" }}>
                  <InlineStack align="space-between" blockAlign="center" gap="200" wrap={false}>
                      <Icon source={PhoneIcon} tone="base" />
                    <Text as="h3" variant="headingSm">Book a free 30-minute setup call</Text>
                  </InlineStack>
                  </div>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Get help with app setup, best practices, and growth recommendations.
                  </Text>
                  <Box>
                    <Button variant="primary">Schedule call</Button>
                  </Box>
                </BlockStack>
              </Card>

              {/* Support ticket */}
              <Card>
                <BlockStack gap="300">
                  <div style={{ width: "fit-content" }}>
                  <InlineStack gap="200" blockAlign="center">
                    <Icon source={EmailIcon} tone="base" />
                    <Text as="h3" variant="headingSm">Support ticket</Text>
                  </InlineStack>
                  </div>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Reach our team during office hours for issue resolution and guidance.
                  </Text>
                  <InlineStack gap="300" wrap>
                    <Button url="https://mixboxbundlebuilder.tawk.help/category/features" target="_blank">
                      Email support
                    </Button>
                    {whatsappLink && (
                      <Button url={whatsappLink} target="_blank">
                        WhatsApp
                      </Button>
                    )}
                  </InlineStack>
                </BlockStack>
              </Card>

              {/* Knowledge base */}
              <Card>
                <BlockStack gap="300">
                  <div style={{ width: "fit-content" }}>
                  <InlineStack gap="200" blockAlign="center">
                    <Icon source={QuestionCircleIcon} tone="Base" />
                    <Text as="h3" variant="headingSm">Knowledge base</Text>
                  </InlineStack>
                  </div>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Browse setup guides and troubleshooting docs.
                  </Text>
                  <InlineStack gap="300" wrap>
                    <Button url="https://mixboxbundlebuilder.tawk.help/category/features" target="_blank">
                      View docs
                    </Button>
                    <Button
                      url="https://apps.shopify.com/mixbox-box-bundle-builder#modal-show=WriteReviewModal"
                      target="_blank"
                      icon={StarFilledIcon}
                    >
                      Write a review
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Card>

            </InlineGrid>
          </BlockStack>
        </Card>
        {/* ── Promoted Apps ── */}
        <Card>
          <BlockStack gap="300">
            <InlineStack blockAlign="center">
              <Text as="h2" variant="headingMd">
                Recommended Our Growth Apps
              </Text>
            </InlineStack>
            <GrowthAppsSlider apps={promotedApps} />
          </BlockStack>
        </Card>
      </BlockStack>

      {/* ── Create Box Modal ── */}
      <Modal
        open={itemsPopup.open}
        onClose={() => setItemsPopup({ open: false, boxTitle: "", items: [] })}
        title={`All Bundle Items — ${itemsPopup.boxTitle}`}
        primaryAction={{
          content: "Close",
          onAction: () => setItemsPopup({ open: false, boxTitle: "", items: [] }),
        }}
      >
        <Modal.Section>
          <BlockStack gap="200">
            <Text as="p" variant="bodySm" tone="subdued">
              {itemsPopup.items.length} item{itemsPopup.items.length === 1 ? "" : "s"} in this order
            </Text>
            {itemsPopup.items.length === 0 ? (
              <Text as="p" variant="bodySm" tone="subdued">No items found for this order.</Text>
            ) : (
              <BlockStack gap="100">
                {itemsPopup.items.map((item, idx) => {
                  const itemLabel = typeof item === "string" ? item : String(item?.label || "");
                  const productUrl = buildAdminProductLink(
                    shopDomain,
                    typeof item === "string" ? null : item?.productId,
                  );
                  return (
                    <InlineStack key={`${itemLabel}-${idx}`} align="space-between" blockAlign="center" wrap={false}>
                      <Text as="span" variant="bodySm">{itemLabel}</Text>
                      {productUrl ? (
                        <Tooltip content={`Open ${itemLabel} product`}>
                          <Button
                            size="slim"
                            url={productUrl}
                            target="_blank"
                            variant="plain"
                            icon={ViewIcon}
                            accessibilityLabel={`Open ${itemLabel} product`}
                          />
                        </Tooltip>
                      ) : (
                        <Text as="span" variant="bodySm" tone="subdued">No link</Text>
                      )}
                    </InlineStack>
                  );
                })}
              </BlockStack>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>
      {/* ── Full-page loading overlay ── */}
      {isPageLoading && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10001,
            background: "rgba(255,255,255,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Spinner accessibilityLabel="Loading page" size="large" />
        </div>
      )}
    </Page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
