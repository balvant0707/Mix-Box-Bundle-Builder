import db from "../db.server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const loader = async ({ request, params }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const boxId = parseInt(params.boxId);
  if (!boxId) {
    return new Response("Not found", { status: 404 });
  }

  const box = await db.comboBox.findFirst({
    where: { id: boxId, deletedAt: null },
    select: { bannerImageData: true, bannerImageMimeType: true },
  });

  if (!box?.bannerImageData || !box?.bannerImageMimeType) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(box.bannerImageData, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": box.bannerImageMimeType,
      "Cache-Control": "public, max-age=86400",
    },
  });
};
