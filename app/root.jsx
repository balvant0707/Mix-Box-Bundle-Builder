import { useEffect } from "react";
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

function LcpConsoleLogger() {
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.PerformanceObserver === "undefined") return;

    let observer;
    try {
      observer = new window.PerformanceObserver((entryList) => {
        const entries = entryList.getEntries();
        const lastEntry = entries[entries.length - 1];
        if (!lastEntry) return;

        console.log("[Page LCP]", {
          timeMs: Math.round(lastEntry.startTime),
          path: window.location.pathname,
          route: `${window.location.pathname}${window.location.search}`,
          element: lastEntry.element?.tagName || null,
          url: lastEntry.url || null,
        });
      });
      observer.observe({ type: "largest-contentful-paint", buffered: true });
    } catch (_) {
      // PerformanceObserver support varies in embedded browser contexts.
    }

    return () => {
      if (observer) observer.disconnect();
    };
  }, []);

  return null;
}

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
        <style>{`
          body,
          button,
          input,
          select,
          textarea {
            font-family: var(--p-font-family-sans);
          }

          input,
          select,
          textarea,
          .Polaris-TextField__Input,
          .Polaris-Select__Input {
            font-size: 12px !important;
          }

          input::placeholder,
          textarea::placeholder,
          .Polaris-TextField__Input::placeholder {
            text-transform: capitalize;
          }
        `}</style>
      </head>
      <body>
        <LcpConsoleLogger />
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
