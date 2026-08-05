import { redirect } from "react-router";
import { isbot } from "isbot";

export const loader = async ({ request }) => {
  if (isbot(request.headers.get("User-Agent") || "")) {
    throw new Response(null, { status: 204 });
  }

  const url = new URL(request.url);
  const target = new URL("/app", url.origin);

  for (const [key, value] of url.searchParams.entries()) {
    target.searchParams.append(key, value);
  }

  throw redirect(`${target.pathname}${target.search}`);
};

export default function Index() {
  return null;
}
