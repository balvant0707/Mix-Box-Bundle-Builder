import { useState, useMemo, useEffect } from "react";
import { useFetcher, useLoaderData, useLocation, useNavigate, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  listBoxes,
  deleteBox,
  toggleBoxStatus,
  reorderBoxes,
  getProductHandlesByIds,
} from "../models/boxes.server";
import { AdminIcon } from "../components/admin-icons";
import { withEmbeddedAppParams } from "../utils/embedded-app";
import {
  ActionList,
  Avatar,
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  DatePicker,
  EmptyState,
  IndexTable,
  InlineStack,
  Modal,
  Page,
  Pagination,
  Popover,
  Select,
  Spinner,
  Text,
  TextField,
  Thumbnail,
  Tooltip,
  useIndexResourceState,
} from "@shopify/polaris";
import {
  CalendarIcon,
  GiftCardIcon,
  MenuHorizontalIcon,
} from "@shopify/polaris-icons";
function formatDate(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatDateTime(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function getBoxTypeLabel(box) {
  if (box?.boxType === "single" || box?.boxType === "simple") return "Single Product";
  if (box?.boxType === "multiple") return "Multi Product";
  if (box?.boxType === "specific" || box?.comboConfig) return "Specific Combo";
  return "Simple Box";
}

function getBoxSearchText(box) {
  return [box?.boxName, box?.displayTitle, box?.title, box?.boxCode]
    .filter((value) => value != null && String(value).trim() !== "")
    .join(" ")
    .toLowerCase();
}

function getBoxTypeBadgeTone(box) {
  if (box?.boxType === "specific" || box?.comboConfig) return "info";
  if (box?.boxType === "multiple") return "attention";
  return "success";
}

function buildBundlePreviewUrl(shopDomain, previewToken, fallbackBaseUrl) {
  if (!previewToken) return fallbackBaseUrl || null;
  const safeToken = String(previewToken).trim();
  if (!safeToken) return fallbackBaseUrl || null;

  try {
    // Use a real storefront page (bundle product URL when available), then pass preview token.
    // Direct /{boxId} paths can 404 on themes without that route.
    const baseUrl = fallbackBaseUrl || `https://${shopDomain}/`;
    const url = new URL(baseUrl);
    url.searchParams.set("cb_preview_box", safeToken);
    return url.toString();
  } catch {
    return fallbackBaseUrl || null;
  }
}

function getDiscountSummary(box) {
  // Multiple Box discount config lives exclusively in multiple_box_page —
  // never in ComboBox.comboStepsConfig.
  if (box.multipleBoxPage) {
    const type = box.multipleBoxPage.discountType;
    const value = box.multipleBoxPage.discountValue;
    if (!type || type === "none") return null;
    if (type !== "buy_x_get_y" && value == null) return null;
    const buyQuantity = Math.max(1, parseInt(String(box.multipleBoxPage.buyQuantity ?? 1), 10) || 1);
    const getQuantity = Math.max(1, parseInt(String(box.multipleBoxPage.getQuantity ?? 1), 10) || 1);
    return { discountType: type, discountValue: String(value), buyQuantity, getQuantity };
  }

  // Simple Box and legacy "Specific Combo" boxes still keep their discount
  // config in comboStepsConfig JSON.
  const src = box.comboStepsConfig;
  if (!src) return null;
  try {
    const p = JSON.parse(src);
    const type = p?.discountType;
    const value = p?.discountValue;
    if (!type || type === "none") return null;
    if (type !== "buy_x_get_y" && value == null) return null;
    const buyQuantity = Math.max(1, parseInt(String(p?.buyQuantity ?? 1), 10) || 1);
    const getQuantity = Math.max(1, parseInt(String(p?.getQuantity ?? 1), 10) || 1);
    return { discountType: type, discountValue: value, buyQuantity, getQuantity };
  } catch { return null; }
}

function getBoxStatusLabel(box) {
  const pageStatus = String(box?.pageStatus || "").toLowerCase();
  if (pageStatus === "scheduled") return "Scheduled";
  if (pageStatus === "inactive") return "Inactive";
  return box?.isActive ? "Active" : "Inactive";
}

function getBoxStatusTone(box) {
  const label = getBoxStatusLabel(box);
  if (label === "Active") return "success";
  if (label === "Scheduled") return "attention";
  return undefined;
}

function getComboConfigSummary(box) {
  if (!box.comboStepsConfig) return null;
  try {
    const parsed = JSON.parse(box.comboStepsConfig); // This is still used by getComboConfigSummary
    const comboType = parseInt(parsed?.type) || 0;
    if (comboType < 2) return null;
    const steps = Array.isArray(parsed?.steps) ? parsed.steps : [];
    if (steps.length === 0) return null;
    return { comboType, title: parsed?.title || null, isActive: parsed?.isActive !== false, stepsJson: JSON.stringify(steps) };
  } catch { return null; }
}

function getBannerImageDataUri(box) {
  if (!box?.bannerImageData || !box?.bannerImageMimeType) return null;
  const base64 = Buffer.from(box.bannerImageData).toString("base64");
  return `data:${box.bannerImageMimeType};base64,${base64}`;
}

function getBannerImageSrc(box) {
  return box?.bannerImageUrl || getBannerImageDataUri(box);
}

function getBoxListImageSrc(box) {
  return getBannerImageSrc(box);
}

function getShortProductUrl(url) {
  if (!url) return "No linked product";
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return url;
  }
}

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  let boxes = await listBoxes(session.shop);
  boxes = boxes.filter((box) => box.simpleBoxPage || box.multipleBoxPage);

  // Live Preview must open the box's own linked Shopify product page (so the
  // preview renders through the exact same storefront widget/config as the
  // real product page — see requirement that Manage Boxes and the Product
  // Page share one rendering path). Resolve each linked product's handle in
  // one batched call rather than per-row.
  const linkedProductIds = Array.from(new Set(
    boxes.map((b) => b.shopifyProductId).filter(Boolean),
  ));
  const productHandleById = linkedProductIds.length > 0
    ? await getProductHandlesByIds(admin, linkedProductIds).catch(() => ({}))
    : {};

  return {
    boxes: boxes.map((b) => {
      const numericProductId = b.shopifyProductId
        ? String(b.shopifyProductId).split("/").pop()
        : null;
      const linkedProductHandle = numericProductId ? productHandleById[numericProductId] : null;
      const previewBaseUrl = linkedProductHandle
        ? `https://${session.shop}/products/${linkedProductHandle}`
        : null;

      return {
        id: b.id,
        boxType: b.boxType || "single",
        boxCode: b.boxCode || null,
        boxName: b.boxName,
        displayTitle: b.displayTitle,
        itemCount: b.itemCount,
        bundlePrice: parseFloat(b.bundlePrice),
        bundlePriceType: b.bundlePriceType || "manual",
        isGiftBox: b.isGiftBox,
        isActive: b.isActive,
        sortOrder: b.sortOrder,
        createdAt: b.createdAt ? new Date(b.createdAt).toISOString() : null,
        updatedAt: b.updatedAt ? new Date(b.updatedAt).toISOString() : null,
        orderCount: b._count?.orders ?? 0,
        comboConfig: getComboConfigSummary(b),
        discount: getDiscountSummary(b),
        listImageSrc: getBoxListImageSrc(b),
        previewUrl: buildBundlePreviewUrl(
          session.shop,
          b.boxCode || b.id,
          previewBaseUrl,
        ),
        productPageUrl: previewBaseUrl,
      };
    }),
  };
};

export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("_action");
  if (intent === "delete") {
    const id = formData.get("id");
    await deleteBox(id, shop, admin);
    return { ok: true };
  }
  if (intent === "reorder") {
    const orderedIds = JSON.parse(formData.get("orderedIds") || "[]");
    await reorderBoxes(shop, orderedIds);
    return { ok: true };
  }
  if (intent === "toggle_status") {
    const id = formData.get("id");
    const isActive = formData.get("isActive") === "true";
    await toggleBoxStatus(id, shop, isActive);
    return { ok: true };
  }
  if (intent === "bulk_delete") {
    const ids = JSON.parse(formData.get("ids") || "[]");
    if (Array.isArray(ids) && ids.length > 0) {
      // In a real app, you'd likely want to delete these in a transaction
      await Promise.all(ids.map(id => deleteBox(id, shop, admin)));
    }
    return { ok: true };
  }
  return { ok: false };
};

export default function ManageBoxesPage() {
  const { boxes } = useLoaderData();
  const location = useLocation();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const fetcher = useFetcher();
  const toggleFetcher = useFetcher();

  const PAGE_SIZE = 10;
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [boxTypeFilter, setBoxTypeFilter] = useState("all");
  const [{ month, year }, setDate] = useState({ month: new Date().getMonth(), year: new Date().getFullYear() });
  const [selectedDates, setSelectedDates] = useState({ start: null, end: null });
  const [datePickerActive, setDatePickerActive] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false);
  const [manualPageLoading, setManualPageLoading] = useState(false);
  const [openActionMenuId, setOpenActionMenuId] = useState(null);
  const isDeleteSubmitting =
    fetcher.state !== "idle" &&
    fetcher.formData?.get("_action") === "delete";
  const isBulkDeleteSubmitting =
    fetcher.state !== "idle" &&
    fetcher.formData?.get("_action") === "bulk_delete";
  const isReorderSubmitting =
    fetcher.state !== "idle" &&
    fetcher.formData?.get("_action") === "reorder";
  const isToggleSubmitting =
    toggleFetcher.state !== "idle" &&
    toggleFetcher.formData?.get("_action") === "toggle_status";
  const pendingToggleId = isToggleSubmitting ? parseInt(toggleFetcher.formData?.get("id"), 10) : null;
  const pendingToggleState = isToggleSubmitting ? toggleFetcher.formData?.get("isActive") === "true" : null;
  const isPageLoading =
    manualPageLoading ||
    navigation.state !== "idle" ||
    isDeleteSubmitting ||
    isBulkDeleteSubmitting ||
    isReorderSubmitting ||
    isToggleSubmitting;

  function startPageLoading() {
    setManualPageLoading(true);
  }

  useEffect(() => {
    if (
      manualPageLoading &&
      navigation.state === "idle" &&
      !isDeleteSubmitting &&
      !isBulkDeleteSubmitting &&
      !isReorderSubmitting &&
      !isToggleSubmitting
    ) {
      setManualPageLoading(false);
    }
  }, [
    manualPageLoading,
    navigation.state,
    isDeleteSubmitting,
    isBulkDeleteSubmitting,
    isReorderSubmitting,
    isToggleSubmitting,
  ]);

  function navigateTo(path) {
    startPageLoading();
    navigate(withEmbeddedAppParams(path, location.search));
  }

  function handleDateSelection(range) {
    setSelectedDates(range);
    if (range?.start && range?.end) {
      setDatePickerActive(false);
    }
  }

  function handleMonthChange(nextMonth, nextYear) {
    setDate({ month: nextMonth, year: nextYear });
  }

  function handleDelete(id, name) { setDeleteConfirm({ id, name }); }

  function confirmDelete() {
    if (deleteConfirm) {
      startPageLoading();
      fetcher.submit({ _action: "delete", id: String(deleteConfirm.id) }, { method: "POST" });
    }
    setDeleteConfirm(null);
  }

  function toggleStatus(id, nextState) {
    toggleFetcher.submit(
      { _action: "toggle_status", id: String(id), isActive: String(nextState) },
      { method: "POST" },
    );
  }

  const baseBoxes = useMemo(() => {
    const action = fetcher.formData?.get("_action");
    if (action === "delete") {
      const deletedId = parseInt(fetcher.formData.get("id"));
      return boxes.filter((b) => b.id !== deletedId);
    }
    if (action === "bulk_delete") {
      try {
        const deletedIds = new Set(JSON.parse(fetcher.formData.get("ids")));
        return boxes.filter((b) => !deletedIds.has(b.id));
      } catch {
        return boxes;
      }
    }
    return boxes;
  }, [boxes, fetcher.formData]);

  const boxesWithPendingToggle = useMemo(
    () => (
      pendingToggleId === null
        ? baseBoxes
        : baseBoxes.map((b) => (b.id === pendingToggleId ? { ...b, isActive: pendingToggleState } : b))
    ),
    [baseBoxes, pendingToggleId, pendingToggleState],
  );

  const filteredBoxes = useMemo(() => {
    let result = boxesWithPendingToggle;
    if (statusFilter !== "all") {
      result = result.filter((b) => getBoxStatusLabel(b).toLowerCase() === statusFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter((b) => getBoxSearchText(b).includes(q));
    }
    if (boxTypeFilter !== "all") {
      result = result.filter((b) => b.boxType === boxTypeFilter);
    }
    if (selectedDates.start && selectedDates.end) {
      const startDate = new Date(selectedDates.start);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(selectedDates.end);
      endDate.setHours(23, 59, 59, 999);
      result = result.filter((b) => {
        if (!b.createdAt) return false;
        const createdAt = new Date(b.createdAt);
        if (Number.isNaN(createdAt.getTime())) return false;
        return createdAt >= startDate && createdAt <= endDate;
      });
    }
    return [...result].sort(
      (a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0),
    );
  }, [boxesWithPendingToggle, statusFilter, search, boxTypeFilter, selectedDates]);

  const totalPages = Math.max(1, Math.ceil(filteredBoxes.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const displayBoxes = filteredBoxes.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );
  const hasMultiplePages = totalPages > 1;

  const resourceIDResolver = (item) => String(item.id);
  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(displayBoxes, { resourceIDResolver });

  const bulkActions = [
    {
      content: `Delete ${selectedResources.length} selected boxes`,
      destructive: true,
      onAction: () => setShowBulkDeleteModal(true),
    },
  ];

  const confirmBulkDelete = () => {
    startPageLoading();
    fetcher.submit(
      { _action: "bulk_delete", ids: JSON.stringify(selectedResources) },
      { method: "POST" },
    );
    setShowBulkDeleteModal(false);
  };

  // Reset to page 1 when filter/search changes
  useEffect(() => { setCurrentPage(1); }, [statusFilter, search, boxTypeFilter, selectedDates]);

  const activeCount = boxesWithPendingToggle.filter((b) => getBoxStatusLabel(b) === "Active").length;
  const scheduledCount = boxesWithPendingToggle.filter((b) => getBoxStatusLabel(b) === "Scheduled").length;
  const inactiveCount = boxesWithPendingToggle.filter((b) => getBoxStatusLabel(b) === "Inactive").length;

  const performanceRows = useMemo(() => {
    const filteredOrderTotal = filteredBoxes.reduce(
      (sum, box) => sum + Number(box.orderCount || 0),
      0,
    );

    return [...filteredBoxes]
      .filter((box) => Number(box.orderCount || 0) > 0)
      .sort((a, b) => Number(b.orderCount || 0) - Number(a.orderCount || 0))
      .slice(0, 10)
      .map((box, index) => ({
        ...box,
        rank: index + 1,
        orderShare: filteredOrderTotal > 0
          ? (Number(box.orderCount || 0) / filteredOrderTotal) * 100
          : 0,
      }));
  }, [filteredBoxes]);

  const statusTabs = [
    { key: "all", label: `All (${baseBoxes.length})` },
    { key: "active", label: `Active (${activeCount})` },
    { key: "scheduled", label: `Scheduled (${scheduledCount})` },
    { key: "inactive", label: `Inactive (${inactiveCount})` },
  ];

  return (
    <Page
      title="Manage Boxes"
      primaryAction={{ content: "+ Create Box", onAction: () => navigateTo("/app/create-bundle") }}
    >
      {/* <ui-title-bar title="MixBox – Box & Bundle Builder">
        <button variant="primary" onClick={openCreateBoxModal}>
          + Create Box
        </button>
      </ui-title-bar> */}

      <BlockStack gap="400">
        {/* Main content card */}
        <Card padding="0">
          {/* Toolbar */}
          <Box padding="300" borderBlockEndWidth="025" borderColor="border-secondary">
            <InlineStack align="space-between" blockAlign="center" gap="300" wrap>
              <div
                style={{
                  display: "inline-flex",
                  gap: "4px",
                  background: "var(--p-color-bg-surface-secondary, #F1F2F4)",
                  borderRadius: "8px",
                  padding: "4px",
                }}
              >
                {statusTabs.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setStatusFilter(tab.key)}
                    style={{
                      border: "none",
                      borderRadius: "6px",
                      padding: "6px 14px",
                      fontSize: "13px",
                      fontWeight: 600,
                      cursor: "pointer",
                      background: statusFilter === tab.key ? "var(--p-color-bg-surface, #FFFFFF)" : "transparent",
                      boxShadow: statusFilter === tab.key ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
                      color: statusFilter === tab.key ? "var(--p-color-text, #1a1a1a)" : "var(--p-color-text-secondary, #6b6f76)",
                    }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <InlineStack gap="200" blockAlign="center" wrap>
                <Box minWidth="200px">
                  <TextField
                    label=""
                    labelHidden
                    placeholder="Search box by name or code..."
                    value={search}
                    onChange={(val) => setSearch(val)}
                    clearButton
                    onClearButtonClick={() => setSearch("")}
                    prefix={(
                      <span style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
                        <AdminIcon type="search" size="small" style={{ color: "#9ca3af" }} />
                      </span>
                    )}
                    autoComplete="off"
                  />
                </Box>
                <Box minWidth="160px">
                  <Select
                    label="Box type"
                    labelHidden
                    options={[
                      { label: "All Types", value: "all" },
                      { label: "Single Product", value: "single" },
                      { label: "Multi Product", value: "multiple" },
                    ]}
                    value={boxTypeFilter}
                    onChange={setBoxTypeFilter}
                  />
                </Box>
                <Box>
                  <Popover
                    active={datePickerActive}
                    activator={
                      <Button
                        onClick={() => setDatePickerActive(!datePickerActive)}
                        icon={CalendarIcon}
                        disclosure
                      >
                        {selectedDates.start && selectedDates.end
                          ? `${formatDate(selectedDates.start)} - ${formatDate(selectedDates.end)}`
                          : "Select Date Range"}
                      </Button>
                    }
                    onClose={() => setDatePickerActive(false)}
                    preferredAlignment="right"
                  >
                    <DatePicker
                      month={month}
                      year={year}
                      onChange={handleDateSelection}
                      onMonthChange={handleMonthChange}
                      selected={
                        selectedDates.start && selectedDates.end
                          ? selectedDates
                          : { start: new Date(), end: new Date() }
                      }
                      allowRange
                    />
                    {(selectedDates.start || selectedDates.end) && (
                      <Box padding="400">
                        <InlineStack align="end">
                          <Button
                            onClick={() => {
                              setSelectedDates({ start: null, end: null });
                              setDatePickerActive(false);
                            }}
                          >
                            Clear Dates
                          </Button>
                        </InlineStack>
                      </Box>
                    )}
                  </Popover>
                </Box>
              </InlineStack>
            </InlineStack>
          </Box>

          {/* Bundle performance — Polaris IndexTable, no chart dependency */}
          {/* {baseBoxes.length > 0 && (
            <Box
              padding="400"
              borderBlockEndWidth="025"
              borderColor="border-secondary"
            >
              <BlockStack gap="300">
                {performanceRows.length > 0 ? (
                  <Card padding="0">
                    <IndexTable
                      resourceName={{ singular: "bundle", plural: "bundles" }}
                      itemCount={performanceRows.length}
                      selectable={false}
                      headings={[
                        { title: "Rank" },
                        { title: "Bundle" },
                        { title: "Type" },
                        { title: "Orders", alignment: "end" },
                        { title: "Order Share", alignment: "end" },
                        { title: "Status" },
                      ]}
                    >
                      {performanceRows.map((box, index) => (
                        <IndexTable.Row
                          key={`performance-${box.id}`}
                          id={`performance-${box.id}`}
                          position={index}
                        >
                          <IndexTable.Cell>
                            <Text as="span" variant="bodySm" fontWeight="semibold">
                              #{box.rank}
                            </Text>
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            <Text as="span" variant="bodySm" fontWeight="semibold">
                              {box.boxName}
                            </Text>
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            <Badge tone={getBoxTypeBadgeTone(box)}>
                              {getBoxTypeLabel(box)}
                            </Badge>
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            <Text as="span" alignment="end" fontWeight="bold">
                              {box.orderCount}
                            </Text>
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            <Text as="span" alignment="end">
                              {box.orderShare.toFixed(1)}%
                            </Text>
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            <Badge tone={getBoxStatusTone(box)}>
                              {getBoxStatusLabel(box)}
                            </Badge>
                          </IndexTable.Cell>
                        </IndexTable.Row>
                      ))}
                    </IndexTable>
                  </Card>
                ) : (
                  <Text as="p" tone="subdued">
                    
                  </Text>
                )}
              </BlockStack>
            </Box>
          )} */}

          {baseBoxes.length === 0 ? (
            /* Empty state — no boxes at all */
            <EmptyState
              heading="No Boxes yet"
              action={{ content: "Create Box", onAction: () => navigateTo("/app/create-bundle") }}
              image=""
            >
              <p>Create your first box to let customers build custom bundles on your storefront.</p>
            </EmptyState>
          ) : filteredBoxes.length === 0 ? (
            /* No search/filter results */
            <Box padding="800">
              <BlockStack gap="200" align="center" inlineAlign="center">
                <AdminIcon type="search" size="large" style={{ color: "#d1d5db" }} />
                <Text as="p" tone="subdued">
                  No boxes match<strong>{search}</strong>;
                </Text>
              </BlockStack>
            </Box>
          ) : (
            <>
              <style>{`
                .Polaris-IndexTable__TableHeading,
                .Polaris-IndexTable__TableCell,
                .Polaris-IndexTable__TableHeading *,
                .Polaris-IndexTable__TableCell * {
                  font-size: 12px;
                }
              `}</style>
              <IndexTable
                resourceName={{ singular: "box", plural: "boxes" }}
                itemCount={displayBoxes.length}
                headings={[
                  { title: "Name" },
                  { title: "Live Preview" },
                  { title: "Code" },
                  { title: "Type" },
                  { title: "Status" },
                  { title: "Last Edited" },
                  { title: "More" },
                ]}
                selectable
                selectedItemsCount={
                  allResourcesSelected ? "All" : selectedResources.length
                }
                onSelectionChange={handleSelectionChange}
                bulkActions={bulkActions}
              >
                {displayBoxes.map((box, index) => {
                  return (
                    <IndexTable.Row
                      key={box.id}
                      id={String(box.id)}
                      selected={selectedResources.includes(String(box.id))}
                      position={index}
                    >
                      {/* Bundle Name */}
                      <IndexTable.Cell>
                        <InlineStack gap="300" blockAlign="center">
                          {box.listImageSrc ? (
                            <Thumbnail source={box.listImageSrc} alt={box.boxName} size="small" />
                          ) : (
                            <Avatar
                              size="sm"
                              name={box.boxName}
                              initials={box.boxName?.charAt(0)?.toUpperCase()}
                            />
                          )}
                          <BlockStack gap="050">
                            <InlineStack gap="150" blockAlign="center">
                              <Text variant="bodySm" fontWeight="semibold" as="span">{box.boxName}</Text>
                              {box.isGiftBox && (
                                <Tooltip content="Gift bundle">
                                  <Badge tone="warning" icon={GiftCardIcon}>Gift</Badge>
                                </Tooltip>
                              )}
                            </InlineStack>
                          </BlockStack>
                        </InlineStack>
                      </IndexTable.Cell>

                      {/* Live Preview */}
                      <IndexTable.Cell>
                        <BlockStack gap="100">
                          <InlineStack gap="150" blockAlign="center" wrap={false}>
                            <Button
                              size="slim"
                              disabled={!box.previewUrl}
                              onClick={() => {
                                if (box.previewUrl) window.open(box.previewUrl, "_blank", "noopener,noreferrer");
                              }}
                            >
                              Preview
                            </Button>
                            <Button
                              size="slim"
                              disabled={!box.productPageUrl}
                              onClick={() => {
                                if (box.productPageUrl) window.open(box.productPageUrl, "_blank", "noopener,noreferrer");
                              }}
                            >
                              Product page
                            </Button>
                          </InlineStack>
                          <Text as="span" variant="bodySm" tone={box.productPageUrl ? "subdued" : "critical"}>
                            {getShortProductUrl(box.productPageUrl)}
                          </Text>
                        </BlockStack>
                      </IndexTable.Cell>

                      {/* Code */}
                      <IndexTable.Cell>
                        <Text as="span" variant="bodySm" tone={box.boxCode ? undefined : "subdued"}>
                          {box.boxCode || "-"}
                        </Text>
                      </IndexTable.Cell>

                      {/* Type */}
                      <IndexTable.Cell>
                        <Badge tone={getBoxTypeBadgeTone(box)}>
                          {getBoxTypeLabel(box)}
                        </Badge>
                      </IndexTable.Cell>

                      {/* Status */}
                      <IndexTable.Cell>
                        <Badge tone={getBoxStatusTone(box)}>
                          {getBoxStatusLabel(box)}
                        </Badge>
                      </IndexTable.Cell>

                      {/* Last Edited */}
                      <IndexTable.Cell>
                        <Text as="span" variant="bodySm" tone="subdued">
                          {formatDateTime(box.updatedAt || box.createdAt)}
                        </Text>
                      </IndexTable.Cell>

                      {/* More */}
                      <IndexTable.Cell>
                        <Popover
                          active={openActionMenuId === box.id}
                          onClose={() => setOpenActionMenuId(null)}
                          preferredAlignment="right"
                          activator={
                            <Button
                              size="slim"
                              icon={MenuHorizontalIcon}
                              accessibilityLabel="More actions"
                              onClick={() =>
                                setOpenActionMenuId((current) => (current === box.id ? null : box.id))
                              }
                            />
                          }
                        >
                          <ActionList
                            items={[
                              {
                                content: box.isActive ? "Deactivate" : "Activate",
                                disabled: isToggleSubmitting,
                                onAction: () => {
                                  setOpenActionMenuId(null);
                                  toggleStatus(box.id, !box.isActive);
                                },
                              },
                              {
                                content: "Edit Bundle",
                                onAction: () => {
                                  setOpenActionMenuId(null);
                                  const editUrl = box.boxType === "single" || box.boxType === "simple"
                                    ? `/app/boxes/${box.id}/edit-single`
                                    : box.boxType === "multiple"
                                      ? `/app/boxes/${box.id}/edit-multiple`
                                      : box.comboConfig
                                        ? `/app/boxes/${box.id}/combo`
                                        : `/app/boxes/${box.id}`;
                                  navigateTo(editUrl);
                                },
                              },
                              {
                                content: "Live Preview",
                                disabled: !box.previewUrl,
                                onAction: () => {
                                  setOpenActionMenuId(null);
                                  if (box.previewUrl) window.open(box.previewUrl, "_blank", "noopener,noreferrer");
                                },
                              },
                              ...(box.orderCount === 0
                                ? [{
                                    content: "Delete Bundle",
                                    destructive: true,
                                    onAction: () => {
                                      setOpenActionMenuId(null);
                                      handleDelete(box.id, box.boxName);
                                    },
                                  }]
                                : []),
                            ]}
                          />
                        </Popover>
                      </IndexTable.Cell>
                    </IndexTable.Row>
                  );
                })}
              </IndexTable>

              {/* Pagination */}
              <Box padding="400" borderBlockStartWidth="025" borderColor="border-secondary">
                <InlineStack align="space-between" blockAlign="center" wrap>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Showing {filteredBoxes.length === 0 ? 0 : ((safePage - 1) * PAGE_SIZE + 1)}–{Math.min(safePage * PAGE_SIZE, filteredBoxes.length)} of {filteredBoxes.length} boxes (Page {safePage} of {totalPages})
                  </Text>
                  <Pagination
                    hasPrevious={hasMultiplePages && safePage > 1}
                    hasNext={hasMultiplePages && safePage < totalPages}
                    onPrevious={() => { if (!hasMultiplePages) return; setCurrentPage((p) => Math.max(1, p - 1)); }}
                    onNext={() => { if (!hasMultiplePages) return; setCurrentPage((p) => Math.min(totalPages, p + 1)); }}
                  />
                </InlineStack>
              </Box>
            </>
          )}
        </Card>
      </BlockStack>

      {/* Loading overlay */}
      {isPageLoading && (
        <div
          aria-live="polite"
          aria-busy="true"
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


      {/* Delete confirmation modal */}
      <Modal
        open={deleteConfirm !== null}
        onClose={() => setDeleteConfirm(null)}
        title="Delete box?"
        primaryAction={{ content: "Delete", destructive: true, onAction: confirmDelete }}
        secondaryActions={[{ content: "Cancel", onAction: () => setDeleteConfirm(null) }]}
      >
        <Modal.Section>
          <Text as="p">
            Are you sure you want to delete &ldquo;<strong>{deleteConfirm?.name}</strong>&rdquo;? Its Shopify product will be permanently removed.
          </Text>
        </Modal.Section>
      </Modal>

      {/* Bulk Delete confirmation modal */}
      <Modal
        open={showBulkDeleteModal}
        onClose={() => setShowBulkDeleteModal(false)}
        title={`Delete ${selectedResources.length} boxes?`}
        primaryAction={{ content: "Delete", destructive: true, onAction: confirmBulkDelete, loading: isBulkDeleteSubmitting }}
        secondaryActions={[{ content: "Cancel", onAction: () => setShowBulkDeleteModal(false) }]}
      >
        <Modal.Section>
          <Text as="p">
            Are you sure you want to delete the selected boxes? Their Shopify
            products will be permanently removed. This action cannot be undone.
          </Text>
        </Modal.Section>
      </Modal>

    </Page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
