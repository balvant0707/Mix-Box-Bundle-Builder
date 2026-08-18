const CUSTOMER_PAGE_SIZE = 50;

const CUSTOMERS_QUERY = `#graphql
  query ComboBuilderCustomers($first: Int!) {
    customers(
      first: $first
      sortKey: UPDATED_AT
      reverse: true
    ) {
      edges {
        node {
          id
          displayName
          firstName
          lastName
          email
          tags
        }
      }
    }
  }
`;

function customerColorFromId(id) {
  const colors = [
    "#36bffa",
    "#22c55e",
    "#a855f7",
    "#f97316",
    "#14b8a6",
    "#ef4444",
  ];

  const value = String(id || "");
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash + value.charCodeAt(index)) % colors.length;
  }

  return colors[hash];
}

function mapCustomerEdges(edges) {
  return (edges || [])
    .map((edge) => edge?.node)
    .filter(Boolean)
    .map((customer) => {
      const fullName = [customer.firstName, customer.lastName]
        .filter(Boolean)
        .join(" ")
        .trim();

      const name =
        customer.displayName ||
        fullName ||
        customer.email ||
        customer.id;

      return {
        id: customer.id,
        name,
        email: customer.email || "",
        tags: Array.isArray(customer.tags)
          ? customer.tags.filter(Boolean)
          : [],
        color: customerColorFromId(customer.id),
      };
    });
}

async function loadJsonOrNull(promise, label) {
  try {
    const response = await Promise.race([
      promise,
      new Promise((resolve) => {
        setTimeout(() => resolve(null), 2500);
      }),
    ]);

    if (!response) {
      console.warn(`[customer-eligibility] ${label} request timed out`);
      return null;
    }

    return await response.json();
  } catch (error) {
    console.warn(
      `[customer-eligibility] failed to load ${label}`,
      error,
    );
    return null;
  }
}

export async function loadCustomerEligibilityOptions(admin) {
  if (!admin?.graphql) {
    console.warn(
      "[customer-eligibility] Shopify admin GraphQL client is unavailable",
    );

    return {
      customers: [],
      customerTags: [],
    };
  }

  /*
   * Shopify Admin GraphQL does NOT expose customerTags on QueryRoot
   * for the API version used by this app.
   *
   * Customer tags are available on each Customer through Customer.tags.
   * Load customers once and derive the unique customer-tag list from them.
   */
  const customersJson = await loadJsonOrNull(
    admin.graphql(CUSTOMERS_QUERY, {
      variables: {
        first: CUSTOMER_PAGE_SIZE,
      },
    }),
    "customers",
  );

  if (customersJson?.errors?.length) {
    console.warn(
      "[customer-eligibility] customer GraphQL errors",
      customersJson.errors,
    );
  }

  const customers = mapCustomerEdges(
    customersJson?.data?.customers?.edges || [],
  );

  const customerTags = [
    ...new Set(
      customers.flatMap((customer) =>
        Array.isArray(customer.tags)
          ? customer.tags
          : [],
      ),
    ),
  ]
    .filter(Boolean)
    .sort((a, b) =>
      String(a).localeCompare(String(b)),
    );

  return {
    customers,
    customerTags,
  };
}
