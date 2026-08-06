/* eslint-disable react/prop-types */
import { useRef, useState } from "react";
import { useLoaderData, useLocation, useNavigate, useNavigation } from "react-router";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  DataTable,
  Divider,
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
  Thumbnail,
  Tooltip,
} from "@shopify/polaris";
import {
  EmailIcon,
  QuestionCircleIcon,
  StarFilledIcon,
  ViewIcon,
} from "@shopify/polaris-icons";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { AdminIcon } from "../components/admin-icons";
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
import { fetchOrderLabelsByOrderIds } from "../utils/shopify-orders.server";
import { fetchProductIdsByLabels, normalizeProductLookupLabel } from "../utils/shopify-products.server";

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

function isSpecificComboFromBox(box) {
  if (!box) return false;
  const cfgType = Number.parseInt(box?.config?.comboType, 10);
  if (Number.isFinite(cfgType) && cfgType > 0) return true;
  const raw = typeof box?.comboStepsConfig === "string" ? box.comboStepsConfig.trim() : "";
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw);
    const parsedType = Number.parseInt(parsed?.comboType ?? parsed?.type, 10);
    if (Number.isFinite(parsedType) && parsedType > 0) return true;
    if (Array.isArray(parsed?.steps) && parsed.steps.length > 0) return true;
  } catch {
    return false;
  }
  return false;
}

async function getShopifyOrdersCount(admin, fromIso, toIso) {
  const ORDERS_COUNT_QUERY = `#graphql
    query OrdersCount($query: String!) {
      ordersCount(query: $query)
    }
  `;

  const fromDate = new Date(fromIso).toISOString().slice(0, 10);
  const toDate = new Date(toIso).toISOString().slice(0, 10);
  const query = `status:any created_at:>=${fromDate} created_at:<=${toDate}`;

  try {
    const response = await admin.graphql(ORDERS_COUNT_QUERY, { variables: { query } });
    const json = await response.json();
    const raw = json?.data?.ordersCount;
    if (Array.isArray(json?.errors) && json.errors.length > 0) {
      return await getShopifyOrdersCountByPagination(admin, query);
    }

    if (typeof raw === "number") return raw;
    if (raw && typeof raw.count === "number") return raw.count;
    const fallback = await getShopifyOrdersCountByPagination(admin, query);
    return fallback == null ? 0 : fallback;
  } catch {
    return await getShopifyOrdersCountByPagination(admin, query);
  }
}

async function getShopifyOrdersCountByPagination(admin, query) {
  const ORDERS_PAGE_QUERY = `#graphql
    query OrdersPage($query: String!, $after: String) {
      orders(first: 250, query: $query, after: $after, sortKey: CREATED_AT, reverse: true) {
        pageInfo { hasNextPage endCursor }
        nodes { id }
      }
    }
  `;

  try {
    let total = 0;
    let after = null;
    let safety = 0;

    do {
      const response = await admin.graphql(ORDERS_PAGE_QUERY, {
        variables: { query, after },
      });
      const json = await response.json();
      if (Array.isArray(json?.errors) && json.errors.length > 0) return null;
      const nodes = json?.data?.orders?.nodes || [];
      const pageInfo = json?.data?.orders?.pageInfo;

      total += nodes.length;
      after = pageInfo?.endCursor || null;
      safety += 1;

      if (!pageInfo?.hasNextPage) break;
      if (!after) break;
      if (safety > 40) break; // Hard cap: 10k orders for dashboard KPI.
    } while (true);

    return total;
  } catch {
    return null;
  }
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

  const now = new Date();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [activeBoxCount, bundlesSold, bundleRevenue, recentOrders, currencyCode, totalStoreOrdersLast30Days, storeOwnerName] =
    await Promise.all([
      getActiveBoxCount(shop),
      getBundlesSoldCount(shop),
      getBundleRevenue(shop),
      getRecentOrders(shop, 100),
      getShopCurrencyCode(shop),
      getShopifyOrdersCount(admin, thirtyDaysAgo.toISOString(), now.toISOString()),
      getShopOwnerDisplayName(shop),
    ]);

  const [themeEditorUrl, embedBlockUrl, embedBlockEnabled] = await Promise.all([
    buildThemeEditorUrl({ shop, admin }),
    buildEmbedBlockUrl({ shop, admin }),
    getEmbedBlockStatus({ shop, admin, session }),
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

  const orderLabelsFromAdmin = await fetchOrderLabelsByOrderIds(
    admin,
    recentOrders.map((order) => order.orderId),
  );
  const selectedProductLabels = recentOrders.flatMap((order) =>
    parseOrderSelectedProducts(order.selectedProducts),
  );
  const productIdByLabel = await fetchProductIdsByLabels(admin, selectedProductLabels);

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
      const normalizedOrderId = String(order.orderId || "").replace(/\D/g, "");
      const adminLabel = orderLabelsFromAdmin.get(normalizedOrderId);
      return {
      id: order.id,
      orderId: order.orderId,
      orderName:
        order.orderName ||
        adminLabel?.orderName ||
        null,
      orderNumber:
        order.orderNumber ??
        adminLabel?.orderNumber ??
        null,
      boxTitle: order.box?.displayTitle || "Unknown Box",
      itemCount: order.box?.itemCount || 0,
      comboType: isSpecificComboFromBox(order.box) ? "specific" : "simple",
      comboTypeLabel: isSpecificComboFromBox(order.box) ? "Specific" : "Simple",
      selectedProducts: parseOrderSelectedProducts(order.selectedProducts),
      selectedProductEntries: parseOrderSelectedProducts(order.selectedProducts).map((label) => ({
        label,
        productId: productIdByLabel.get(normalizeProductLookupLabel(label)) || null,
      })),
      bundlePrice: parseFloat(order.bundlePrice),
      orderDate: order.orderDate.toISOString(),
    };
    }),
  };
};

const createBoxActions = [
  {
    key: "create-box",
    icon: "package",
    label: "Create Simple Box",
    sub: "Preconfigured Shopify product bundle to increase average order value faster.",
    href: "#",
  },
  {
    key: "create-specific-combo",
    icon: "target",
    label: "Create Specific Box",
    sub: "Step-by-step bundle builder that lets shoppers create a personalized product box.",
    href: "#",
  },
];

const quickActions = [
  { key: "manage-boxes", label: "Manage Boxes", sub: "Edit existing combos", href: "/app/boxes" },
  { key: "analytics", label: "View Analytics", sub: "Sales and revenue", href: "/app/analytics" },
];

const promotedApps = [
  {
    key: "cartlift",
    title: "CartLift: Cart Drawer and Upsell",
    tag: "Upsell",
    url: "https://apps.shopify.com/cartlift-cart-drawer-upsell",
    image: "/images/cartlift.png",
    description: "Grow average order value with cart drawer Upsells,Shipping,Discounts and smart cart offers.",
  },
  {
    key: "fomoify",
    title: "Fomoify Sales Popup and Proof",
    tag: "Social Proof",
    url: "https://apps.shopify.com/fomoify-sales-popup-proof",
    image: "/images/fomoify.png",
    description: "Increase trust using real-time sales popups and conversion proof nudges.",
  },
];
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
  const [showCreateBoxModal, setShowCreateBoxModal] = useState(false);
  const [pendingCreateAction, setPendingCreateAction] = useState(null);
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

  function closeCreateBoxModal() {
    setShowCreateBoxModal(false);
    setPendingCreateAction(null);
  }

  function handleCreateBoxAction(action) {
    setPendingCreateAction(action.key);
    navigateTo(action.href);
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
      const isSpecific = order.comboType === "specific";
      return (
        <Badge tone={isSpecific ? "info" : "success"}>
          {isSpecific ? "Specific" : "Simple"}
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
        content: "Create Box",
        onAction: () => setShowCreateBoxModal(true),
      }}
      secondaryActions={[
        {
          content: "View Analytics",
          onAction: () => navigateTo("/app/analytics"),
        },
      ]}
    >
      <BlockStack gap="500">
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
                  onClick={() => setShowCreateBoxModal(true)}
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
                  onAction: () => setShowCreateBoxModal(true),
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
                  <Text as="h3" variant="headingSm">Book a free 30-minute setup call</Text>
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
                  <InlineStack gap="200" blockAlign="center">
                    <Icon source={EmailIcon} tone="subdued" />
                    <Text as="h3" variant="headingSm">Support ticket</Text>
                  </InlineStack>
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
                  <InlineStack gap="200" blockAlign="center">
                    <Icon source={QuestionCircleIcon} tone="subdued" />
                    <Text as="h3" variant="headingSm">Knowledge base</Text>
                  </InlineStack>
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
          <BlockStack gap="400">
            <InlineStack gap="200" blockAlign="center">
              <AdminIcon type="collection-list" size="base" style={{ color: "#111827" }} />
              <Text as="h2" variant="headingMd">
                Recommended Our Growth Apps
              </Text>
            </InlineStack>
            <Divider />
            <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
              {promotedApps.map((appItem) => (
                <Card key={appItem.key}>
                  <BlockStack gap="200">
                    <InlineStack align="space-between" blockAlign="center" wrap={false}>
                      <InlineStack gap="200" blockAlign="center" wrap={false}>
                        <Thumbnail source={appItem.image} alt={appItem.title} size="small" />
                        <Text as="h3" variant="headingSm">
                          {appItem.title}
                        </Text>
                      </InlineStack>
                      <Badge>{appItem.tag}</Badge>
                    </InlineStack>
                    <Text as="p" tone="subdued" variant="bodySm">
                      {appItem.description}
                    </Text>
                    <Button url={appItem.url} target="_blank" variant="primary">
                      Add app
                    </Button>
                  </BlockStack>
                </Card>
              ))}
            </InlineGrid>
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

      <Modal
        open={showCreateBoxModal}
        onClose={closeCreateBoxModal}
        title="Choose Bundle Type"
        size="medium"
      >
        <Modal.Section>
          <BlockStack gap="300">
            {createBoxActions.map((action) => (
              <Card key={action.key}>
                <BlockStack gap="200">
                  <InlineStack gap="200" blockAlign="center">
                    <AdminIcon type={action.icon} size="base" />
                    <Text as="h3" variant="headingSm">
                      {action.label}
                    </Text>
                  </InlineStack>
                  <Text as="p" tone="subdued" variant="bodySm">
                    {action.sub}
                  </Text>
                  <Button
                    variant="primary"
                    disabled={pendingCreateAction !== null}
                    onClick={() => handleCreateBoxAction(action)}
                  >
                    Create Box
                  </Button>
                </BlockStack>
              </Card>
            ))}
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
