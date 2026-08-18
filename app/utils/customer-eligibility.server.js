const CUSTOMER_PAGE_SIZE = 50;
const CUSTOMER_TAG_PAGE_SIZE = 100;

const CUSTOMERS_QUERY = `#graphql
  query ComboBuilderCustomers($first: Int!) {
    customers(first: $first, sortKey: UPDATED_AT, reverse: true) {
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

const CUSTOMER_TAGS_QUERY = `#graphql
  query ComboBuilderCustomerTags($first: Int!) {
    customerTags(first: $first) {
      edges {
        node
      }
    }
  }
`;

function customerColorFromId(id) {
  const colors = ['#36bffa', '#22c55e', '#a855f7', '#f97316', '#14b8a6', '#ef4444'];
  const value = String(id || '');
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash + value.charCodeAt(index)) % colors.length;
  }
  return colors[hash];
}

function mapCustomerEdges(edges) {
  return (edges || [])
    .map(({ node }) => node)
    .filter(Boolean)
    .map((customer) => {
      const name =
        customer.displayName ||
        [customer.firstName, customer.lastName].filter(Boolean).join(' ') ||
        customer.email ||
        customer.id;

      return {
        id: customer.id,
        name,
        email: customer.email || '',
        tags: Array.isArray(customer.tags) ? customer.tags.filter(Boolean) : [],
        color: customerColorFromId(customer.id),
      };
    });
}

function mapCustomerTagEdges(edges) {
  return (edges || [])
    .map(({ node }) => (typeof node === 'string' ? node.trim() : ''))
    .filter(Boolean);
}

async function loadJsonOrNull(promise, label) {
  try {
    const response = await Promise.race([
      promise,
      new Promise((resolve) => setTimeout(() => resolve(null), 2500)),
    ]);
    if (!response) return null;
    return await response.json();
  } catch (error) {
    console.warn(`[customer-eligibility] failed to load ${label}`, error);
    return null;
  }
}

export async function loadCustomerEligibilityOptions(admin) {
  const [customersJson, tagsJson] = await Promise.all([
    loadJsonOrNull(
      admin.graphql(CUSTOMERS_QUERY, {
        variables: { first: CUSTOMER_PAGE_SIZE },
      }),
      'customers',
    ),
    loadJsonOrNull(
      admin.graphql(CUSTOMER_TAGS_QUERY, {
        variables: { first: CUSTOMER_TAG_PAGE_SIZE },
      }),
      'customer tags',
    ),
  ]);

  if (customersJson?.errors?.length || tagsJson?.errors?.length) {
    console.warn('[customer-eligibility] GraphQL errors', {
      customers: customersJson?.errors,
      customerTags: tagsJson?.errors,
    });
  }

  const customers = mapCustomerEdges(customersJson?.data?.customers?.edges);
  const customerTags = mapCustomerTagEdges(tagsJson?.data?.customerTags?.edges);
  const tagsFromCustomers = customers.flatMap((customer) => customer.tags || []);

  return {
    customers,
    customerTags: [...new Set([...customerTags, ...tagsFromCustomers])].sort((a, b) =>
      a.localeCompare(b),
    ),
  };
}
