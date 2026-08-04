function getAppOrigin(request) {
  const configuredUrl = process.env.SHOPIFY_APP_URL || process.env.APP_URL;
  if (configuredUrl) {
    try {
      return new URL(configuredUrl).origin;
    } catch {
      // Fall back to the current request origin below.
    }
  }

  return new URL(request.url).origin;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export const loader = async ({ request }) => {
  const origin = getAppOrigin(request);
  const urls = ["/", "/app"];
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (path) => `  <url>
    <loc>${escapeXml(new URL(path, origin).toString())}</loc>
  </url>`,
  )
  .join("\n")}
</urlset>
`;

  return new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
};
