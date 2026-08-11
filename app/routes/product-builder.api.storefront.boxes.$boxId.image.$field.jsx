import db from "../db.server";
import { authenticate } from "../shopify.server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const IMAGE_FIELDS = new Set(["bundleImage", "bannerImage"]);

function getImageSelection(field) {
  const prefix = field === "bundleImage" ? "bundleImage" : "bannerImage";
  return {
    [`${prefix}Data`]: true,
    [`${prefix}MimeType`]: true,
  };
}

function getImageFromPage(page, field) {
  if (!page) return null;
  const prefix = field === "bundleImage" ? "bundleImage" : "bannerImage";
  const data = page[`${prefix}Data`] || null;
  const mimeType = page[`${prefix}MimeType`] || null;
  if (!data || !mimeType) return null;

  return {
    data,
    mimeType,
  };
}

export const loader = async ({ request, params }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const url = new URL(request.url);
  const { session } = await authenticate.public.appProxy(request);
  const shop = session?.shop || url.searchParams.get("shop");
  const boxId = Number(params.boxId);
  const field = params.field;

  if (!shop || !boxId || !IMAGE_FIELDS.has(field)) {
    return new Response("Not found", { status: 404, headers: CORS_HEADERS });
  }

  const imageSelection = getImageSelection(field);
  const box = await db.comboBox.findFirst({
    where: { id: boxId, shop, deletedAt: null, isActive: true },
    select: {
      bannerImageData: true,
      bannerImageMimeType: true,
      simpleBoxPage: { select: imageSelection },
      multipleBoxPage: { select: imageSelection },
    },
  });

  const image =
    getImageFromPage(box?.simpleBoxPage, field) ||
    getImageFromPage(box?.multipleBoxPage, field) ||
    (field === "bannerImage"
      ? { data: box?.bannerImageData || null, mimeType: box?.bannerImageMimeType || null }
      : null);

  if (!image?.data || !image?.mimeType) {
    return new Response("Not found", { status: 404, headers: CORS_HEADERS });
  }

  return new Response(image.data, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": image.mimeType,
      "Cache-Control": "public, max-age=86400",
    },
  });
};
