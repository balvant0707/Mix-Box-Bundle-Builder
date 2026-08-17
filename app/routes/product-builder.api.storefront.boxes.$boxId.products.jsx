import db from "../db.server";
import { authenticate } from "../shopify.server";
import { resolveSelectableProducts } from "../models/boxes.server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

export const loader = async ({ request, params }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const url = new URL(request.url);
  const { session, admin } = await authenticate.public.appProxy(request);
  const shop = session?.shop || url.searchParams.get("shop");

  if (!shop || !admin) {
    return Response.json({ error: "shop parameter required" }, { status: 400, headers: CORS_HEADERS });
  }

  const boxId = parseInt(params.boxId);
  if (isNaN(boxId)) {
    return Response.json({ error: "Invalid box ID" }, { status: 400, headers: CORS_HEADERS });
  }

  const packKey = url.searchParams.get("packKey") || null;
  const rawPackIndex = url.searchParams.get("packIndex");
  const packIndex = rawPackIndex != null ? Number.parseInt(rawPackIndex, 10) : null;
  const previewBoxCode = (url.searchParams.get("previewBoxCode") || "").trim();
  const isPreviewRequest = !!previewBoxCode;

  // Verify box belongs to shop and is active, and pull whichever page config
  // (Simple or Multiple box) actually drives its product selection.
  const box = await db.comboBox.findFirst({
    where: {
      id: boxId,
      shop,
      deletedAt: null,
      ...(isPreviewRequest ? {} : { isActive: true }),
    },
    select: {
      id: true,
      boxCode: true,
      boxName: true,
      displayTitle: true,
      isActive: true,
      simpleBoxPage: {
        select: { productConfiguration: true, selectedProductIdsJson: true, selectedCollectionIdsJson: true, hideOutOfStockProducts: true },
      },
      multipleBoxPage: {
        select: {
          productConfiguration: true,
          selectedProductIdsJson: true,
          selectedCollectionIdsJson: true,
          hideOutOfStockProducts: true,
          quantityPacks: {
            orderBy: { sortOrder: "asc" },
            select: {
              packKey: true,
              productConfiguration: true,
              selectedProductIdsJson: true,
              selectedCollectionIdsJson: true,
            },
          },
        },
      },
    },
  });

  if (!box) {
    return Response.json({ error: "Box not found" }, { status: 404, headers: CORS_HEADERS });
  }

  if (!box.isActive) {
    const token = previewBoxCode.toLowerCase();
    const previewMatches =
      token &&
      (
        token === String(box.id).toLowerCase() ||
        token === String(box.boxCode || "").toLowerCase() ||
        token === String(box.boxName || "").toLowerCase() ||
        token === String(box.displayTitle || "").toLowerCase()
      );
    if (!previewMatches) {
      return Response.json({ error: "Box not found" }, { status: 404, headers: CORS_HEADERS });
    }
  }

  // A chosen pack's own product selection wins over the page-level one — each
  // pack is an independent bundle tier with its own product configuration.
  // Packs have no hideOutOfStockProducts column of their own, so that toggle
  // always comes from the page.
  const quantityPacks = box.multipleBoxPage?.quantityPacks || [];
  const packByIndex =
    Number.isInteger(packIndex) && packIndex >= 0 && packIndex < quantityPacks.length
      ? quantityPacks[packIndex]
      : null;
  const packByKey = packKey
    ? quantityPacks.find((quantityPack) => String(quantityPack.packKey || "") === String(packKey))
    : null;
  const pack = packByIndex || packByKey || null;
  const pageConfig = box.simpleBoxPage || box.multipleBoxPage;
  if (!pageConfig) {
    return Response.json([], { headers: CORS_HEADERS });
  }
  const productSourceConfig = pack || pageConfig;

  function parseJsonArray(value) {
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  try {
    const publicProducts = await resolveSelectableProducts(admin, {
      productConfiguration: productSourceConfig.productConfiguration,
      selectedProductIds: parseJsonArray(productSourceConfig.selectedProductIdsJson),
      selectedCollectionIds: parseJsonArray(productSourceConfig.selectedCollectionIdsJson),
      hideOutOfStockProducts: !!pageConfig.hideOutOfStockProducts,
    });

    return Response.json(publicProducts, { headers: CORS_HEADERS });
  } catch (e) {
    console.error("[product-builder.api.storefront.boxes.$boxId.products] error:", e);
    return Response.json({ error: "Failed to load products" }, { status: 500, headers: CORS_HEADERS });
  }
};
