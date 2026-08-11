import db from "../db.server";
import { authenticate } from "../shopify.server";

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
  return {
    data: page?.[`${prefix}Data`] || null,
    mimeType: page?.[`${prefix}MimeType`] || null,
  };
}

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const boxId = Number(params.id);
  const field = params.field;

  if (!boxId || !IMAGE_FIELDS.has(field)) {
    return new Response("Not found", { status: 404 });
  }

  const imageSelection = getImageSelection(field);
  const box = await db.comboBox.findFirst({
    where: { id: boxId, shop: session.shop, deletedAt: null },
    select: {
      simpleBoxPage: { select: imageSelection },
      multipleBoxPage: { select: imageSelection },
    },
  });

  const image =
    getImageFromPage(box?.simpleBoxPage, field) ||
    getImageFromPage(box?.multipleBoxPage, field);

  if (!image?.data || !image?.mimeType) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(image.data, {
    status: 200,
    headers: {
      "Content-Type": image.mimeType,
      "Cache-Control": "private, max-age=300",
    },
  });
};
