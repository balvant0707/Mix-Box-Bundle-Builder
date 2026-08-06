import { useCallback, useEffect, useRef, useState } from "react";
import { useLoaderData, useLocation, useNavigate, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getAnalytics } from "../models/orders.server";
import { getShopCurrencyCode } from "../models/shop.server";
import { withEmbeddedAppParams } from "../utils/embedded-app";
import { formatCurrencyAmount } from "../utils/currency";
import { fetchOrderLabelsByOrderIds } from "../utils/shopify-orders.server";
import { fetchProductIdsByLabels, normalizeProductLookupLabel } from "../utils/shopify-products.server";
import {
  Badge,
  BlockStack,
  Box,
  Button,
  ButtonGroup,
  Banner,
  Card,
  DatePicker,
  Divider,
  EmptyState,
  Icon,
  IndexTable,
  InlineGrid,
  InlineStack,
  Link,
  Modal,
  Pagination,
  Page,
  Popover,
  ProgressBar,
  Select,
  Text,
  Tooltip,
} from "@shopify/polaris";
import {
  ArrowUpIcon,
  ArrowDownIcon,
  CalendarIcon,
  ChartLineIcon,
  CollectionListIcon,
  MoneyIcon,
  PackageIcon,
  RefreshIcon,
  ViewIcon,
} from "@shopify/polaris-icons";

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const period = url.searchParams.get("period") || "30";
  const customFrom = url.searchParams.get("from") || null;
  const customTo = url.searchParams.get("to") || null;
  const comboTypeParam = String(url.searchParams.get("comboType") || "all").toLowerCase();
  const comboType = comboTypeParam === "simple" || comboTypeParam === "specific" ? comboTypeParam : "all";

  let fromDate, toDate;
  if (customFrom && customTo) {
    fromDate = customFrom;
    toDate = customTo;
  } else if (period === "all") {
    fromDate = "1970-01-01";
    toDate = new Date().toISOString().slice(0, 10);
  } else {
    const days = parseInt(period) || 30;
    const toD = new Date();
    const fromD = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    fromDate = fromD.toISOString().slice(0, 10);
    toDate = toD.toISOString().slice(0, 10);
  }

  const [analytics, currencyCode] = await Promise.all([
    getAnalytics(session.shop, fromDate, toDate, {
      comboTypeFilter: comboType,
      recentOrdersLimit: null, // show full order list for selected period
    }),
    getShopCurrencyCode(session.shop),
  ]);

  const orderLabelsFromAdmin = await fetchOrderLabelsByOrderIds(
    admin,
    (analytics?.recentOrders || []).map((order) => order.orderId),
  );
  const hydratedRecentOrders = (analytics?.recentOrders || []).map((order) => {
    const normalizedOrderId = String(order.orderId || "").replace(/\D/g, "");
    const adminLabel = orderLabelsFromAdmin.get(normalizedOrderId);
    return {
      ...order,
      orderName: order.orderName || adminLabel?.orderName || null,
      orderNumber: order.orderNumber ?? adminLabel?.orderNumber ?? null,
    };
  });
  const selectedProductLabels = hydratedRecentOrders.flatMap((order) =>
    parseOrderSelectedProducts(order.selectedProducts),
  );
  const productIdByLabel = await fetchProductIdsByLabels(admin, selectedProductLabels);
  const enrichedRecentOrders = hydratedRecentOrders.map((order) => {
    const selected = parseOrderSelectedProducts(order.selectedProducts);
    return {
      ...order,
      selectedProductEntries: selected.map((label) => ({
        label,
        productId: productIdByLabel.get(normalizeProductLookupLabel(label)) || null,
      })),
    };
  });

  return {
    analytics: {
      ...analytics,
      recentOrders: enrichedRecentOrders,
    },
    currencyCode,
    shopDomain: session.shop,
    period: customFrom ? "custom" : period,
    fromDate,
    toDate,
    comboType,
  };
};

// ─── Helpers ────────────────────────────────────────────────────────────────
function fmtCurrency(val, currencyCode) {
  const numericValue = Number(val) || 0;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currencyCode || "USD",
      notation: "compact",
      maximumFractionDigits: 0,
    }).format(numericValue);
  } catch {
    return formatCurrencyAmount(numericValue, currencyCode || "USD", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  }
}

function fmtShortDate(isoStr) {
  if (!isoStr) return "";
  const d = new Date(isoStr + "T00:00:00");
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function fmtDate(isoStr) {
  return new Date(isoStr).toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

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

// ─── Date Range Picker ────────────────────────────────────────────────────────
const DATE_PRESETS = [
  { key: "7", label: "Last 7 days" },
  { key: "30", label: "Last 30 Days" },
  { key: "90", label: "Last 90 days" },
  { key: "all", label: "All time" },
  { key: "custom", label: "Custom range" },
];

function isoToDate(iso) {
  return iso ? new Date(`${iso}T00:00:00`) : new Date();
}

function dateToIso(date) {
  return date.toISOString().slice(0, 10);
}

function DateRangePicker({ period, fromDate: initFrom, toDate: initTo }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const todayStr = dateToIso(new Date());

  const [selectedPreset, setSelectedPreset] = useState(period === "custom" ? "custom" : (period || "30"));
  const [fromDate, setFromDate] = useState(initFrom || todayStr);
  const [toDate, setToDate] = useState(initTo || todayStr);

  const initDate = isoToDate(fromDate);
  const [{ month, year }, setDate] = useState({ month: initDate.getMonth(), year: initDate.getFullYear() });

  const activeLabel = (() => {
    if (period === "custom" && initFrom && initTo) {
      return `${fmtShortDate(initFrom)} - ${fmtShortDate(initTo)}`;
    }
    return DATE_PRESETS.find((p) => p.key === period)?.label || "Last 30 Days";
  })();

  function handlePresetChange(key) {
    setSelectedPreset(key);
    if (key !== "custom") {
      const to = todayStr;
      const from = key === "all"
        ? "1970-01-01"
        : dateToIso(new Date(Date.now() - (parseInt(key) || 30) * 86400000));
      setFromDate(from);
      setToDate(to);
      const d = isoToDate(from);
      setDate({ month: d.getMonth(), year: d.getFullYear() });
    }
  }

  function handleDateSelection({ start, end }) {
    setSelectedPreset("custom");
    setFromDate(dateToIso(start));
    setToDate(dateToIso(end));
  }

  function handleMonthChange(nextMonth, nextYear) {
    setDate({ month: nextMonth, year: nextYear });
  }

  function handleApply() {
    setOpen(false);
    const currentParams = new URLSearchParams(location.search);
    const comboType = currentParams.get("comboType");
    const nextParams = new URLSearchParams();
    if (comboType && comboType !== "all") nextParams.set("comboType", comboType);
    if (selectedPreset !== "custom") {
      nextParams.set("period", selectedPreset);
    } else if (fromDate && toDate) {
      nextParams.set("from", fromDate);
      nextParams.set("to", toDate);
    } else {
      return;
    }
    const nextQuery = nextParams.toString();
    navigate(withEmbeddedAppParams(`${location.pathname}${nextQuery ? `?${nextQuery}` : ""}`, location.search));
  }

  function handleCancel() {
    setOpen(false);
    setSelectedPreset(period === "custom" ? "custom" : (period || "30"));
    setFromDate(initFrom || todayStr);
    setToDate(initTo || todayStr);
  }

  return (
    <Popover
      active={open}
      activator={
        <Button onClick={() => setOpen((o) => !o)} icon={CalendarIcon} disclosure>
          {activeLabel}
        </Button>
      }
      onClose={handleCancel}
      preferredAlignment="right"
    >
      <Box padding="400" minWidth="320px">
        <BlockStack gap="400">
          <Select
            label="Date range"
            labelHidden
            options={DATE_PRESETS.map((p) => ({ label: p.label, value: p.key }))}
            value={selectedPreset}
            onChange={handlePresetChange}
          />
          <DatePicker
            month={month}
            year={year}
            onChange={handleDateSelection}
            onMonthChange={handleMonthChange}
            selected={{ start: isoToDate(fromDate), end: isoToDate(toDate) }}
            allowRange
            multiMonth
          />
          <InlineStack align="end">
            <ButtonGroup>
              <Button onClick={handleCancel}>Cancel</Button>
              <Button variant="primary" onClick={handleApply}>Apply</Button>
            </ButtonGroup>
          </InlineStack>
        </BlockStack>
      </Box>
    </Popover>
  );
}

function ComboTypeFilter({ value = "all" }) {
  const location = useLocation();
  const navigate = useNavigate();

  function handleChange(nextValue) {
    const normalized = nextValue === "simple" || nextValue === "specific" ? nextValue : "all";
    // Build params from current search to preserve date / period params
    const params = new URLSearchParams(location.search);
    if (normalized === "all") params.delete("comboType");
    else params.set("comboType", normalized);
    // Remove embedded-only params — withEmbeddedAppParams will re-add them
    for (const key of ["embedded", "host", "shop", "locale"]) {
      if (params.has(key)) params.delete(key);
    }
    const nextQuery = params.toString();
    navigate(
      withEmbeddedAppParams(
        `${location.pathname}${nextQuery ? `?${nextQuery}` : ""}`,
        location.search,
      ),
    );
  }

  return (
    <Box minWidth="190px">
      <Select
        label="Type filter"
        labelInline
        options={[
          { label: "All Box", value: "all" },
          { label: "Simple", value: "simple" },
          { label: "Specific", value: "specific" },
        ]}
        value={value}
        onChange={handleChange}
      />
    </Box>
  );
}

// ─── KPI Card ────────────────────────────────────────────────────────────────
const KPI_ICONS = {
  money: MoneyIcon,
  package: PackageIcon,
  "chart-line": ChartLineIcon,
  "collection-list": CollectionListIcon,
};

function KpiCard({ label, value, subLabel, change, iconType, subtitle }) {
  const isUp = change === null || change === undefined ? null : change >= 0;
  const icon = KPI_ICONS[iconType];

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack gap="200" blockAlign="center" wrap={false}>
          {icon ? (
            <Box background="bg-fill-info" borderRadius="200" padding="150">
              <Icon source={icon} tone="info" />
            </Box>
          ) : null}
          <Text as="p" variant="bodySm" tone="subdued">
            {label}
          </Text>
        </InlineStack>

        <Text as="p" variant="heading2xl">
          {value}
        </Text>

        <InlineStack gap="200" blockAlign="center" wrap>
          {isUp !== null ? (
            <Badge tone={isUp ? "success" : "critical"} icon={isUp ? ArrowUpIcon : ArrowDownIcon}>
              {`${Math.abs(change).toFixed(0)}%`}
            </Badge>
          ) : null}
          {subLabel ? (
            <Text as="span" variant="bodySm" tone="subdued">
              {subLabel}
            </Text>
          ) : null}
        </InlineStack>

        {subtitle ? (
          <Text as="p" variant="bodySm" tone="subdued">
            {subtitle}
          </Text>
        ) : null}
      </BlockStack>
    </Card>
  );
}

// ─── Polaris-style Interactive Line Chart ─────────────────────────────────────
function LineChart({
  title,
  totalValue,
  change,
  data = [],
  prevData = [],
  periodLabel,
  prevPeriodLabel,
  formatY,
  color = "#20a8e8",
  color2 = "#7dd3fc",
}) {
  const [hoverIdx, setHoverIdx] = useState(null);
  const svgRef = useRef(null);

  const W = 1200;
  const H = 300;
  const ML = 56;
  const MR = 20;
  const MB = 42;
  const MT = 18;
  const chartW = W - ML - MR;
  const chartH = H - MB - MT;
  const pointCount = Math.max(data.length, prevData.length, 1);

  function niceMax(value) {
    const safeValue = Number(value) || 0;
    if (safeValue <= 0) return 10;

    const rough = safeValue * 1.08;
    const magnitude = 10 ** Math.floor(Math.log10(rough));
    const normalized = rough / magnitude;
    const niceNormalized =
      normalized <= 1 ? 1 :
        normalized <= 2 ? 2 :
          normalized <= 2.5 ? 2.5 :
            normalized <= 5 ? 5 : 10;

    return niceNormalized * magnitude;
  }

  const allValues = [
    ...data.map((item) => Number(item?.value) || 0),
    ...prevData.map((item) => Number(item?.value) || 0),
    0,
  ];
  const yMax = niceMax(Math.max(...allValues));

  function xPos(index) {
    return ML + (pointCount > 1 ? (index / (pointCount - 1)) * chartW : chartW / 2);
  }

  function yPos(value) {
    const numericValue = Math.max(0, Number(value) || 0);
    return MT + chartH - (numericValue / yMax) * chartH;
  }

  function buildSmoothPath(items) {
    if (!items?.length) return "";
    if (items.length === 1) {
      return `M ${xPos(0).toFixed(2)},${yPos(items[0].value).toFixed(2)}`;
    }

    let path = `M ${xPos(0).toFixed(2)},${yPos(items[0].value).toFixed(2)}`;

    for (let index = 1; index < items.length; index += 1) {
      const x0 = xPos(index - 1);
      const y0 = yPos(items[index - 1].value);
      const x1 = xPos(index);
      const y1 = yPos(items[index].value);
      const middleX = (x0 + x1) / 2;

      path += ` C ${middleX.toFixed(2)},${y0.toFixed(2)} ${middleX.toFixed(2)},${y1.toFixed(2)} ${x1.toFixed(2)},${y1.toFixed(2)}`;
    }

    return path;
  }

  const tickCount = 3;
  const yTicks = Array.from({ length: tickCount + 1 }, (_, index) =>
    (yMax / tickCount) * index,
  );

  const xLabelIndexes = (() => {
    const sourceLength = data.length || prevData.length;
    if (!sourceLength) return [];
    if (sourceLength <= 5) return Array.from({ length: sourceLength }, (_, index) => index);

    const indexes = new Set([0, sourceLength - 1]);
    const desiredLabels = 5;
    for (let index = 1; index < desiredLabels - 1; index += 1) {
      indexes.add(Math.round((index * (sourceLength - 1)) / (desiredLabels - 1)));
    }
    return [...indexes].sort((a, b) => a - b);
  })();

  const safeId = String(title || "analytics-chart")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const currentGradientId = `${safeId}-current-gradient`;

  const currentPoint = hoverIdx !== null ? data[hoverIdx] : null;
  const previousPoint = hoverIdx !== null ? prevData[hoverIdx] : null;
  const hoverRows = [
    currentPoint
      ? {
        key: "current",
        label: periodLabel || "Current period",
        date: currentPoint.date,
        value: currentPoint.value,
        color,
        dashed: false,
      }
      : null,
    previousPoint
      ? {
        key: "previous",
        label: prevPeriodLabel || "Previous period",
        date: previousPoint.date,
        value: previousPoint.value,
        color: "#86ccef",
        dashed: true,
      }
      : null,
  ].filter(Boolean);

  const activePoint = currentPoint || previousPoint;
  const tooltipX = hoverIdx !== null ? xPos(hoverIdx) : 0;
  const tooltipY = activePoint ? yPos(activePoint.value) : MT + chartH;
  const placeTooltipLeft = tooltipX > W * 0.68;

  const handlePointerMove = useCallback((event) => {
    const svg = svgRef.current;
    if (!svg || pointCount <= 0) return;

    const rect = svg.getBoundingClientRect();
    if (!rect.width) return;

    const relativeX = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    const svgX = (relativeX / rect.width) * W;
    const approximateIndex = Math.round(((svgX - ML) / chartW) * (pointCount - 1));
    const nextIndex = Math.max(0, Math.min(pointCount - 1, approximateIndex));

    setHoverIdx(nextIndex);
  }, [chartW, pointCount]);

  const handlePointerLeave = useCallback(() => setHoverIdx(null), []);
  const isUp = change === null || change === undefined ? null : change >= 0;

  return (
    <BlockStack gap="300">
      <InlineStack align="space-between" blockAlign="start" wrap>
        <BlockStack gap="100">
          <Text as="p" variant="bodySm" tone="subdued">
            {title}
          </Text>
          <Text as="p" variant="headingXl">
            {totalValue}
          </Text>
        </BlockStack>

        {change !== null && change !== undefined ? (
          <Badge tone={isUp ? "success" : "critical"} icon={isUp ? ArrowUpIcon : ArrowDownIcon}>
            {`${Math.abs(change).toFixed(0)}% vs previous period`}
          </Badge>
        ) : null}
      </InlineStack>

      <Box
        position="relative"
        width="100%"
        minHeight="280px"
        overflowX="hidden"
        overflowY="hidden"
        background="bg-surface"
        borderRadius="200"
      >
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          role="img"
          aria-label={`${title} line chart`}
          preserveAspectRatio="none"
          style={{ display: "block", width: "100%", height: "300px", cursor: "crosshair" }}
          onPointerMove={handlePointerMove}
          onPointerDown={handlePointerMove}
          onPointerLeave={handlePointerLeave}
        >
          <defs>
            <linearGradient id={currentGradientId} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={color} />
              <stop offset="100%" stopColor={color2} />
            </linearGradient>
          </defs>

          <rect x="0" y="0" width={W} height={H} fill="#ffffff" />

          {yTicks.map((tick, index) => {
            const y = yPos(tick);
            return (
              <g key={`y-${index}`}>
                <line
                  x1={ML}
                  y1={y}
                  x2={W - MR}
                  y2={y}
                  stroke="#e6ebef"
                  strokeWidth="1"
                />
                <text
                  x={ML - 12}
                  y={y + 4}
                  textAnchor="end"
                  fontSize="11"
                  fontWeight="600"
                  fill="#4b5563"
                >
                  {formatY(tick)}
                </text>
              </g>
            );
          })}

          {prevData.length > 0 ? (
            <path
              d={buildSmoothPath(prevData)}
              fill="none"
              stroke="#86ccef"
              strokeWidth="2"
              strokeDasharray="5 8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null}

          {data.length > 0 ? (
            <path
              d={buildSmoothPath(data)}
              fill="none"
              stroke={`url(#${currentGradientId})`}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null}

          {xLabelIndexes.map((index) => {
            const point = data[index] || prevData[index];
            if (!point) return null;
            return (
              <text
                key={`x-${index}`}
                x={xPos(index)}
                y={H - 12}
                textAnchor="middle"
                fontSize="11"
                fontWeight="600"
                fill="#4b5563"
              >
                {fmtShortDate(point.date)}
              </text>
            );
          })}

          {hoverIdx !== null && hoverRows.length > 0 ? (
            <g pointerEvents="none">
              <line
                x1={tooltipX}
                y1={MT}
                x2={tooltipX}
                y2={MT + chartH}
                stroke="#111827"
                strokeWidth="1"
                strokeDasharray="3 4"
                opacity="0.18"
              />

              {currentPoint ? (
                <circle
                  cx={tooltipX}
                  cy={yPos(currentPoint.value)}
                  r="5"
                  fill="#ffffff"
                  stroke={color}
                  strokeWidth="2.5"
                />
              ) : null}

              {previousPoint ? (
                <circle
                  cx={tooltipX}
                  cy={yPos(previousPoint.value)}
                  r="4.5"
                  fill="#ffffff"
                  stroke="#86ccef"
                  strokeWidth="2.5"
                />
              ) : null}
            </g>
          ) : null}
        </svg>

        {hoverIdx !== null && hoverRows.length > 0 ? (
          <div
            style={{
              position: "absolute",
              left: `${(tooltipX / W) * 100}%`,
              top: `${Math.max(12, Math.min(86, (tooltipY / H) * 100))}%`,
              transform: placeTooltipLeft
                ? "translate(calc(-100% - 14px), -50%)"
                : "translate(14px, -50%)",
              width: "min(230px, calc(100vw - 48px))",
              pointerEvents: "none",
              zIndex: 4,
            }}
          >
            <div
              style={{
                background: "#ffffff",
                border: "1px solid #dfe3e8",
                borderRadius: "10px",
                boxShadow: "0 10px 28px rgba(17, 24, 39, 0.14)",
                padding: "12px",
              }}
            >
              <div
                style={{
                  color: "#202223",
                  fontSize: "13px",
                  fontWeight: 700,
                  marginBottom: "8px",
                }}
              >
                {activePoint?.date
                  ? new Date(`${activePoint.date}T00:00:00`).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })
                  : ""}
              </div>

              <div style={{ display: "grid", gap: "6px" }}>
                {hoverRows.map((row) => (
                  <div
                    key={row.key}
                    style={{
                      display: "grid",
                      gap: "3px",
                      padding: "8px 9px",
                      borderRadius: "7px",
                      background: "#f6f6f7",
                      border: "1px solid #ebebed",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "7px",
                        minWidth: 0,
                      }}
                    >
                      <span
                        aria-hidden="true"
                        style={{
                          width: "9px",
                          height: "9px",
                          borderRadius: "50%",
                          flexShrink: 0,
                          background: row.color,
                        }}
                      />
                      <span
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          color: "#4b5563",
                          fontSize: "11px",
                          fontWeight: 600,
                        }}
                      >
                        {row.label}
                      </span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        justifyContent: "space-between",
                        gap: "8px",
                      }}
                    >
                      <strong style={{ color: "#202223", fontSize: "14px" }}>
                        {formatY(row.value)}
                      </strong>
                      <span style={{ color: "#8c9196", fontSize: "10px" }}>
                        {fmtShortDate(row.date)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </Box>

      <InlineStack gap="400" wrap>
        <InlineStack gap="200" blockAlign="center" wrap={false}>
          <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: color, flexShrink: 0 }} />
          <Text as="span" variant="bodySm" tone="subdued">
            {periodLabel}
          </Text>
        </InlineStack>
        {prevData.length > 0 ? (
          <InlineStack gap="200" blockAlign="center" wrap={false}>
            <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#86ccef", flexShrink: 0 }} />
            <Text as="span" variant="bodySm" tone="subdued">
              {prevPeriodLabel}
            </Text>
          </InlineStack>
        ) : null}
      </InlineStack>
    </BlockStack>
  );
}

// ─── Top Products Horizontal Bar Chart ───────────────────────────────────────
function TopProductsChart({ data }) {
  if (!data || data.length === 0) {
    return (
      <EmptyState heading="No product selection data yet" image="">
        <Text as="p" tone="subdued">Product picks will appear here once customers start building boxes.</Text>
      </EmptyState>
    );
  }

  const maxCount = Math.max(...data.map((d) => d.count), 1);
  const total = data.reduce((s, d) => s + d.count, 0);

  const rows = data.map((p, i) => {
    const pct = Math.round((p.count / maxCount) * 100);
    const sharePct = total > 0 ? Math.round((p.count / total) * 100) : 0;
    const shortId = p.productId.includes("/") ? p.productId.split("/").pop() : p.productId;
    return (
      <IndexTable.Row id={p.productId} key={p.productId} position={i}>
        <IndexTable.Cell>
          <Text as="span" tone="subdued" numeric>{i + 1}</Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" truncate title={p.productId}>{`#${shortId}`}</Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <InlineStack gap="200" blockAlign="center" wrap={false}>
            <Box minWidth="90px">
              <ProgressBar progress={pct} size="small" tone="primary" />
            </Box>
            <Text as="span" variant="bodySm" tone="subdued">{`${p.count}x`}</Text>
          </InlineStack>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" alignment="end" numeric>{`${sharePct}%`}</Text>
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  return (
    <IndexTable
      itemCount={data.length}
      selectable={false}
      headings={[
        { title: "#" },
        { title: "Product" },
        { title: "Picked" },
        { title: "Share", alignment: "end" },
      ]}
    >
      {rows}
    </IndexTable>
  );
}

// ─── Box Performance Chart ────────────────────────────────────────────────────
function BoxPerformanceChart({ data, currencyCode }) {
  if (!data || data.length === 0) {
    return (
      <EmptyState heading="No box order data yet" image="">
        <Text as="p" tone="subdued">Box performance will appear here once orders come in.</Text>
      </EmptyState>
    );
  }

  const maxRev = Math.max(...data.map((d) => d.revenue), 1);
  const totalOrders = data.reduce((s, d) => s + d.orders, 0);
  const totalRev = data.reduce((s, d) => s + d.revenue, 0);

  const rows = data.map((b, i) => {
    const revPct = Math.round((b.revenue / maxRev) * 100);
    const shareOrders = totalOrders > 0 ? Math.round((b.orders / totalOrders) * 100) : 0;
    const shareRev = totalRev > 0 ? Math.round((b.revenue / totalRev) * 100) : 0;
    return (
      <IndexTable.Row id={String(b.boxId)} key={b.boxId} position={i}>
        <IndexTable.Cell>
          <Text as="span" fontWeight="semibold" truncate>{b.boxTitle}</Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <InlineStack gap="200" blockAlign="center" wrap={false}>
            <Box minWidth="90px">
              <ProgressBar progress={revPct} size="small" tone="success" />
            </Box>
            <Text as="span" variant="bodySm" tone="subdued">{`${shareRev}% rev`}</Text>
          </InlineStack>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" numeric>{b.orders}</Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <BlockStack gap="0">
            <Text as="span" alignment="end">{fmtCurrency(b.revenue, currencyCode)}</Text>
            <Text as="span" alignment="end" variant="bodySm" tone="subdued">{`${shareOrders}% of orders`}</Text>
          </BlockStack>
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  return (
    <IndexTable
      itemCount={data.length}
      selectable={false}
      headings={[
        { title: "Box" },
        { title: "Revenue share" },
        { title: "Orders", alignment: "end" },
        { title: "Revenue", alignment: "end" },
      ]}
    >
      {rows}
    </IndexTable>
  );
}

function RecentOrdersTable({ data, currencyCode, onOpenItemsPopup, shopDomain }) {
  if (!data || data.length === 0) {
    return (
      <EmptyState heading="No bundle orders in this period" image="">
        <Text as="p" tone="subdued">Orders placed for your boxes will show up here.</Text>
      </EmptyState>
    );
  }

  const rows = data.map((order, index) => {
    const selected = parseOrderSelectedProducts(order.selectedProducts);
    const comboTypeText = String(order.comboTypeLabel || order.comboType || "")
      .replace(/\s*Bundle\b/gi, "")
      .trim() || "—";
    const detailsText = selected.length > 0
      ? selected[0]
      : `${order.itemCount || 0} step${Number(order.itemCount || 0) === 1 ? "" : "s"}`;
    const moreCount = Math.max(0, selected.length - 1);
    const orderUrl = buildAdminOrderLink(shopDomain, order.orderId);
    const orderLabel = formatOrderPrefixLabel(order.orderName, order.orderNumber, order.orderId);
    const rowId = String(order.id || `${order.orderId}-${index}`);

    return (
      <IndexTable.Row id={rowId} key={rowId} position={index}>
        <IndexTable.Cell>
          {orderUrl ? (
            <Link url={orderUrl} external removeUnderline>
              <Badge tone="info">{orderLabel}</Badge>
            </Link>
          ) : (
            <Badge tone="info">{orderLabel}</Badge>
          )}
        </IndexTable.Cell>
        <IndexTable.Cell>
          {orderUrl ? (
            <Link url={orderUrl} external monochrome removeUnderline>
              <Text as="span" fontWeight="semibold">{order.boxTitle}</Text>
            </Link>
          ) : (
            <Text as="span" fontWeight="semibold">{order.boxTitle}</Text>
          )}
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Badge tone={order.comboType === "specific" ? "info" : "success"}>{comboTypeText}</Badge>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <InlineStack gap="100" blockAlign="center" wrap={false}>
            <Text as="span" truncate title={selected.join(", ")}>{detailsText}</Text>
            {moreCount > 0 && (
              <Button variant="plain" onClick={() => onOpenItemsPopup?.(order)}>
                {`+${moreCount} more`}
              </Button>
            )}
          </InlineStack>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Badge tone="success">{formatCurrencyAmount(Number(order.bundlePrice || 0), currencyCode)}</Badge>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" tone="subdued" variant="bodySm">
            {new Date(order.orderDate).toLocaleDateString(undefined)}
          </Text>
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  return (
    <IndexTable
      itemCount={data.length}
      selectable={false}
      headings={[
        { title: "Order ID" },
        { title: "Name" },
        { title: "Type" },
        { title: "Products" },
        { title: "Revenue" },
        { title: "Date" },
      ]}
    >
      {rows}
    </IndexTable>
  );
}

// ─── Comparison Period Banner ─────────────────────────────────────────────────
function ComparisonBanner({ period, prevPeriod }) {
  if (!period || !prevPeriod) return null;
  return (
    <Banner tone="info" icon={CalendarIcon}>
      <InlineStack gap="150" wrap>
        <Text as="span" fontWeight="semibold">Current:</Text>
        <Text as="span">{`${fmtDate(period.from)} - ${fmtDate(period.to)}`}</Text>
        <Text as="span" tone="subdued">vs</Text>
        <Text as="span" fontWeight="semibold">Previous:</Text>
        <Text as="span">{`${fmtDate(prevPeriod.from)} - ${fmtDate(prevPeriod.to)}`}</Text>
      </InlineStack>
    </Banner>
  );
}

// ─── Sync Orders Button ───────────────────────────────────────────────────────
function SyncOrdersButton() {
  const { revalidate } = useRevalidator();
  const [state, setState] = useState("idle"); // idle | loading | success | error
  const [result, setResult] = useState(null);

  async function handleSync() {
    setState("loading");
    setResult(null);
    try {
      const resp = await fetch("/api/admin/sync-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days: 90 }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.error || "Sync failed");
      setResult(data);
      setState("success");
      revalidate();
    } catch (err) {
      setResult({ error: err.message });
      setState("error");
    }
  }

  const isLoading = state === "loading";

  return (
    <InlineStack gap="200" blockAlign="center">
      <Button icon={RefreshIcon} loading={isLoading} onClick={handleSync} disabled={isLoading}>
        Sync Orders
      </Button>
      {state === "success" && result && (
        <Text as="span" variant="bodySm" tone="success" fontWeight="semibold">
          {`+${result.synced} new order${result.synced !== 1 ? "s" : ""} synced`}
        </Text>
      )}
      {state === "error" && (
        <Text as="span" variant="bodySm" tone="critical" fontWeight="semibold">
          {result?.error || "Sync failed"}
        </Text>
      )}
    </InlineStack>
  );
}

// ─── Main Analytics Page ──────────────────────────────────────────────────────
export default function AnalyticsPage() {
  const {
    analytics,
    period,
    fromDate,
    toDate,
    comboType,
    currencyCode,
    shopDomain,
  } = useLoaderData();
  const {
    totalOrders,
    totalRevenue,
    avgBundleValue,
    activeBoxCount,
    prevTotalOrders,
    prevTotalRevenue,
    revenueChange,
    ordersChange,
    topProducts,
    dailyTrend,
    prevDailyTrend,
    boxPerformance,
    recentOrders,
    period: periodRange,
    prevPeriod,
  } = analytics;

  const periodLabel = periodRange ? `${fmtDate(periodRange.from)} - ${fmtDate(periodRange.to)}` : "Current";
  const prevPeriodLabel = prevPeriod ? `${fmtDate(prevPeriod.from)} - ${fmtDate(prevPeriod.to)}` : "Previous";

  const analyticsScopeLabel = comboType === "simple"
    ? "Simple"
    : comboType === "specific"
      ? "Specific"
      : "All";
  const analyticsScopePluralLabel = comboType === "simple"
    ? "Simple"
    : comboType === "specific"
      ? "Specific"
      : "All";

  const revData = (dailyTrend || []).map((d) => ({ date: d.date, value: d.revenue }));
  const prevRevData = (prevDailyTrend || []).map((d) => ({ date: d.date, value: d.revenue }));
  const ordData = (dailyTrend || []).map((d) => ({ date: d.date, value: d.orders }));
  const prevOrdData = (prevDailyTrend || []).map((d) => ({ date: d.date, value: d.orders }));

  const avgChange =
    prevTotalOrders > 0 && prevTotalRevenue > 0
      ? ((avgBundleValue - prevTotalRevenue / prevTotalOrders) / (prevTotalRevenue / prevTotalOrders)) * 100
      : null;
  const [itemsPopup, setItemsPopup] = useState({
    open: false,
    boxTitle: "",
    items: [],
  });
  const RECENT_ORDERS_PAGE_SIZE = 10;
  const [recentOrdersPage, setRecentOrdersPage] = useState(1);
  const recentOrdersTotalPages = Math.max(1, Math.ceil((recentOrders?.length || 0) / RECENT_ORDERS_PAGE_SIZE));
  const safeRecentOrdersPage = Math.min(recentOrdersPage, recentOrdersTotalPages);
  const paginatedRecentOrders = (recentOrders || []).slice(
    (safeRecentOrdersPage - 1) * RECENT_ORDERS_PAGE_SIZE,
    safeRecentOrdersPage * RECENT_ORDERS_PAGE_SIZE,
  );

  useEffect(() => {
    setRecentOrdersPage(1);
  }, [period, fromDate, toDate, comboType]);

  function openItemsPopup(order) {
    const items = Array.isArray(order?.selectedProductEntries)
      ? order.selectedProductEntries
      : parseOrderSelectedProducts(order?.selectedProducts).map((label) => ({
        label,
        productId: null,
      }));
    setItemsPopup({
      open: true,
      boxTitle: order?.boxTitle || "Order",
      items,
    });
  }

  return (
    <Page
      title="Analytics"
    >
      <BlockStack gap="500">
        {/* ── Period Selector + Comparison Banner ── */}
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center" wrap>
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">{analyticsScopeLabel} Performance Overview</Text>
                <Text as="p" tone="subdued" variant="bodySm"></Text>
              </BlockStack>
              <InlineStack gap="300" wrap>
                <ComboTypeFilter value={comboType} />
                <DateRangePicker period={period} fromDate={fromDate} toDate={toDate} />
                <SyncOrdersButton />
              </InlineStack>
            </InlineStack>
            <ComparisonBanner period={periodRange} prevPeriod={prevPeriod} />
          </BlockStack>
        </Card>

        {/* ── KPI Cards ── */}
        <InlineGrid columns={{ xs: 2, md: 4 }} gap="400">
          <KpiCard
            label={`Total ${analyticsScopeLabel} Revenue`}
            value={formatCurrencyAmount(totalRevenue, currencyCode, {
              minimumFractionDigits: 0,
              maximumFractionDigits: 0,
            })}
            subLabel={prevTotalRevenue ? `prev ${formatCurrencyAmount(prevTotalRevenue || 0, currencyCode, {
              minimumFractionDigits: 0,
              maximumFractionDigits: 0,
            })}` : null}
            change={revenueChange}
            accentColor="#3b82f6"
            iconType="money"
          />
          <KpiCard
            label={`Total ${analyticsScopePluralLabel} Sold`}
            value={totalOrders}
            subLabel={prevTotalOrders ? `prev ${prevTotalOrders}` : null}
            change={ordersChange}
            accentColor="#2A7A4F"
            iconType="package"
          />
          <KpiCard
            label={`Average ${analyticsScopeLabel} Order Value`}
            value={formatCurrencyAmount(avgBundleValue, currencyCode, {
              minimumFractionDigits: 0,
              maximumFractionDigits: 0,
            })}
            subLabel={null}
            change={avgChange}
            accentColor="#8b5cf6"
            iconType="chart-line"
          />
          <KpiCard
            label={`Active ${analyticsScopePluralLabel}`}
            value={activeBoxCount}
            subLabel={null}
            change={null}
            accentColor="#f59e0b"
            iconType="collection-list"
            subtitle={`Total live ${analyticsScopePluralLabel.toLowerCase()}`}
          />
        </InlineGrid>

        {/* ── Top Products + Box Performance ── */}
        <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Most Picked {analyticsScopeLabel} Products</Text>
              <TopProductsChart data={topProducts} />
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">{analyticsScopeLabel} Box Performance</Text>
              <BoxPerformanceChart data={boxPerformance} currencyCode={currencyCode} />
            </BlockStack>
          </Card>
        </InlineGrid>

        {/* ── Revenue & Orders Charts ── */}
        <BlockStack gap="400">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">{analyticsScopeLabel} Revenue Over Time</Text>
              <Divider />
              <LineChart
                title={`Total Revenue from ${analyticsScopePluralLabel}`}
                totalValue={formatCurrencyAmount(totalRevenue, currencyCode, {
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 0,
                })}
                change={revenueChange}
                data={revData}
                prevData={prevRevData}
                periodLabel={periodLabel}
                prevPeriodLabel={prevPeriodLabel}
                formatY={(value) => fmtCurrency(value, currencyCode)}
                color="#60a5fa"
                color2="#818cf8"
              />
              <Divider />
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">{analyticsScopeLabel} Orders Over Time</Text>
              <Divider />
              <LineChart
                title={`${analyticsScopeLabel} Orders Over Time`}
                totalValue={String(totalOrders)}
                change={ordersChange}
                data={ordData}
                prevData={prevOrdData}
                periodLabel={periodLabel}
                prevPeriodLabel={prevPeriodLabel}
                formatY={(v) => String(Math.round(v))}
                color="#34d399"
                color2="#059669"
              />
              <Divider />
            </BlockStack>
          </Card>
        </BlockStack>

        {/* ── Recent Orders ── */}
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Recent {analyticsScopeLabel} Orders</Text>
            <RecentOrdersTable
              data={paginatedRecentOrders}
              currencyCode={currencyCode}
              onOpenItemsPopup={openItemsPopup}
              shopDomain={shopDomain}
            />
            <InlineStack align="space-between" blockAlign="center" wrap>
              <Text as="p" variant="bodySm" tone="subdued">
                Showing {recentOrders.length === 0 ? 0 : ((safeRecentOrdersPage - 1) * RECENT_ORDERS_PAGE_SIZE + 1)}–{Math.min(safeRecentOrdersPage * RECENT_ORDERS_PAGE_SIZE, recentOrders.length)} of {recentOrders.length} orders (Page {safeRecentOrdersPage} of {recentOrdersTotalPages})
              </Text>
              <Pagination
                hasPrevious={safeRecentOrdersPage > 1}
                hasNext={safeRecentOrdersPage < recentOrdersTotalPages}
                onPrevious={() => setRecentOrdersPage((page) => Math.max(1, page - 1))}
                onNext={() => setRecentOrdersPage((page) => Math.min(recentOrdersTotalPages, page + 1))}
              />
            </InlineStack>
          </BlockStack>
        </Card>
      </BlockStack>

      <Modal
        open={itemsPopup.open}
        onClose={() => setItemsPopup({ open: false, boxTitle: "", items: [] })}
        title={`All Items — ${itemsPopup.boxTitle}`}
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
    </Page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};


