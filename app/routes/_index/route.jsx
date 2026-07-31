import { redirect } from "react-router";

export const loader = async ({ request }) => {
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
