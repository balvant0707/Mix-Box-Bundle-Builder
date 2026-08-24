export const loader = () => new Response(null, { status: 405 });

export const action = async ({ request }) => {
  let payload = null;
  try {
    payload = await request.json();
  } catch {
    payload = null;
  }

  console.info("[events.products] received Shopify Event", {
    topic: payload?.topic || null,
    action: payload?.action || null,
    handle: payload?.handle || null,
  });

  return Response.json({ ok: true });
};
