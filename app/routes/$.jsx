// Catch-all for any path that doesn't match a real route (stray bot/crawler
// requests, misdirected webhook deliveries to a stale registered URL, manual
// browsing, etc.) — returns a plain 404 instead of letting React Router throw
// an internal "no route matched" error for every one of these.
const notFound = () => new Response("Not Found", { status: 404 });

export const loader = notFound;
export const action = notFound;
