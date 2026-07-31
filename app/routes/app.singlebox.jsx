import {useCallback, useMemo, useState} from 'react';
import {
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  Checkbox,
  ChoiceList,
  Divider,
  DropZone,
  EmptyState,
  Form,
  Grid,
  Icon,
  InlineGrid,
  InlineStack,
  Page,
  RadioButton,
  Select,
  Text,
  TextField,
  Thumbnail,
} from '@shopify/polaris';
import {
  ArrowLeftIcon,
  DeleteIcon,
  ImageIcon,
  InfoIcon,
  PlusIcon,
  SearchIcon,
} from '@shopify/polaris-icons';

const layoutOptions = [
  {label: 'Top bar template', value: 'top'},
  {label: 'Side bar template', value: 'side'},
  {label: 'Full page template', value: 'full'},
  {label: 'Table template', value: 'table'},
];

const eligibilityOptions = [
  {label: 'All Customers', value: 'all'},
  {label: 'Customer Tags', value: 'tags'},
  {label: 'Specific Customer', value: 'specific'},
];

const emptyPack = () => ({
  id: crypto.randomUUID(),
  title: '',
  quantity: '2',
  discountType: 'percentage',
  discountValue: '10',
});

function SectionHeader({title, description, action}) {
  return (
    <BlockStack gap="400">
      <InlineStack align="space-between" blockAlign="center" gap="300">
        <BlockStack gap="100">
          <Text as="h2" variant="headingMd">{title}</Text>
          {description ? <Text as="p" tone="subdued">{description}</Text> : null}
        </BlockStack>
        {action}
      </InlineStack>
      <Divider />
    </BlockStack>
  );
}

function LayoutCard({option, selected, onChange}) {
  return (
    <div
      onClick={() => onChange(option.value)}
      style={{
        cursor: 'pointer',
        border: selected ? '2px solid var(--p-color-border-emphasis)' : '1px solid var(--p-color-border)',
        borderRadius: 12,
        overflow: 'hidden',
        background: 'var(--p-color-bg-surface)',
      }}
    >
      <Box padding="300">
        <BlockStack gap="300">
          <RadioButton
            label={option.label}
            checked={selected}
            id={`layout-${option.value}`}
            name="layout"
            onChange={() => onChange(option.value)}
          />
          <div
            style={{
              minHeight: 120,
              padding: 12,
              borderRadius: 8,
              background: 'var(--p-color-bg-surface-secondary)',
              display: 'grid',
              gap: 8,
            }}
          >
            <div style={{height: 12, width: '55%', borderRadius: 5, background: 'var(--p-color-bg-fill-tertiary)'}} />
            <div style={{display: 'grid', gridTemplateColumns: option.value === 'side' ? '1fr 2fr' : 'repeat(3, 1fr)', gap: 8}}>
              {[1, 2, 3].map((item) => (
                <div key={item} style={{height: 62, borderRadius: 7, background: 'var(--p-color-bg-surface)'}} />
              ))}
            </div>
          </div>
        </BlockStack>
      </Box>
    </div>
  );
}

function QuantityPack({pack, index, onChange, onDelete}) {
  return (
    <Box padding="400" background="bg-surface-secondary" borderRadius="300">
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h3" variant="headingSm">Quantity pack {index + 1}</Text>
          <Button icon={DeleteIcon} tone="critical" variant="tertiary" accessibilityLabel="Delete quantity pack" onClick={onDelete} />
        </InlineStack>
        <InlineGrid columns={{xs: 1, sm: 2}} gap="300">
          <TextField
            label="Pack title"
            value={pack.title}
            placeholder="Buy 2 and save"
            onChange={(value) => onChange('title', value)}
            autoComplete="off"
          />
          <TextField
            label="Required quantity"
            type="number"
            min={1}
            value={pack.quantity}
            onChange={(value) => onChange('quantity', value)}
            autoComplete="off"
          />
          <Select
            label="Discount type"
            options={[
              {label: 'Percentage', value: 'percentage'},
              {label: 'Fixed amount', value: 'fixed'},
              {label: 'Fixed bundle price', value: 'bundle-price'},
            ]}
            value={pack.discountType}
            onChange={(value) => onChange('discountType', value)}
          />
          <TextField
            label="Discount value"
            type="number"
            min={0}
            value={pack.discountValue}
            suffix={pack.discountType === 'percentage' ? '%' : undefined}
            prefix={pack.discountType !== 'percentage' ? '$' : undefined}
            onChange={(value) => onChange('discountValue', value)}
            autoComplete="off"
          />
        </InlineGrid>
      </BlockStack>
    </Box>
  );
}

export default function MixMatchBundleForm({
  initialData,
  selectedProducts = [],
  onBack,
  onBrowseProducts,
  onSubmit,
}) {
  const [form, setForm] = useState({
    bundleTitle: initialData?.bundleTitle ?? '',
    bundleDescription: initialData?.bundleDescription ?? '',
    sellAsBundleOnly: initialData?.sellAsBundleOnly ?? false,
    productSearch: '',
    layout: initialData?.layout ?? 'top',
    eligibility: initialData?.eligibility ?? ['all'],
    customerTags: initialData?.customerTags ?? '',
    customers: initialData?.customers ?? '',
    status: initialData?.status ?? 'active',
    sectionTitle: initialData?.sectionTitle ?? 'Build your bundle',
    showSectionTitle: initialData?.showSectionTitle ?? true,
    showProductPrice: initialData?.showProductPrice ?? true,
    customCss: initialData?.customCss ?? '',
  });
  const [packs, setPacks] = useState(initialData?.packs?.length ? initialData.packs : []);
  const [files, setFiles] = useState([]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const setField = useCallback((key, value) => {
    setForm((current) => ({...current, [key]: value}));
  }, []);

  const updatePack = useCallback((id, key, value) => {
    setPacks((current) => current.map((pack) => pack.id === id ? {...pack, [key]: value} : pack));
  }, []);

  const handleDrop = useCallback((_droppedFiles, acceptedFiles) => {
    setFiles((current) => [...current, ...acceptedFiles]);
  }, []);

  const fileUpload = !files.length && <DropZone.FileUpload actionTitle="Upload New Image" actionHint="Accepts SVG, JPG, and PNG" />;
  const uploadedFiles = files.length > 0 && (
    <InlineGrid columns={{xs: 2, sm: 3}} gap="300">
      {files.map((file, index) => (
        <Box key={`${file.name}-${index}`} padding="200" borderWidth="025" borderColor="border" borderRadius="200">
          <BlockStack gap="200">
            <Thumbnail size="large" alt={file.name} source={file.type.startsWith('image/') ? window.URL.createObjectURL(file) : ImageIcon} />
            <Text as="span" variant="bodySm" truncate>{file.name}</Text>
            <Button size="slim" tone="critical" variant="tertiary" onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}>Remove</Button>
          </BlockStack>
        </Box>
      ))}
    </InlineGrid>
  );

  const filteredProducts = useMemo(() => {
    const query = form.productSearch.trim().toLowerCase();
    if (!query) return selectedProducts;
    return selectedProducts.filter((product) => product.title?.toLowerCase().includes(query));
  }, [form.productSearch, selectedProducts]);

  const submit = async () => {
    const payload = {...form, packs, files, selectedProducts};
    try {
      setSaving(true);
      await onSubmit?.(payload);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Page>
      <Form onSubmit={submit}>
        <BlockStack gap="500">
          <InlineStack gap="300" blockAlign="center">
            <Button icon={ArrowLeftIcon} variant="tertiary" accessibilityLabel="Go back" onClick={onBack} />
            <Text as="h1" variant="headingLg">Create Mix n Match Bundle (Multi Product)</Text>
          </InlineStack>

          <Grid>
            <Grid.Cell columnSpan={{xs: 6, sm: 6, md: 6, lg: 8, xl: 8}}>
              <BlockStack gap="400">
                <Card>
                  <BlockStack gap="400">
                    <SectionHeader title="Bundle Information" description="Set the title displayed on your storefront." />
                    <TextField
                      label="Bundle Product Title"
                      name="bundleTitle"
                      value={form.bundleTitle}
                      placeholder="Title displayed above the bundle on the product page"
                      maxLength={150}
                      showCharacterCount
                      onChange={(value) => setField('bundleTitle', value)}
                      autoComplete="off"
                    />
                    <TextField
                      label="Description"
                      name="bundleDescription"
                      value={form.bundleDescription}
                      placeholder="Enter bundle description"
                      multiline={4}
                      onChange={(value) => setField('bundleDescription', value)}
                      autoComplete="off"
                    />
                  </BlockStack>
                </Card>

                <Card>
                  <BlockStack gap="400">
                    <SectionHeader
                      title="Select a product"
                      description="Select the products to include in the bundle."
                      action={
                        <InlineStack gap="100" blockAlign="center">
                          <Checkbox label="Sell as bundle only" checked={form.sellAsBundleOnly} onChange={(value) => setField('sellAsBundleOnly', value)} />
                          <Icon source={InfoIcon} tone="subdued" />
                        </InlineStack>
                      }
                    />
                    <TextField
                      label="Browse products"
                      labelHidden
                      prefix={<Icon source={SearchIcon} />}
                      placeholder="Browse products"
                      value={form.productSearch}
                      onChange={(value) => setField('productSearch', value)}
                      connectedRight={<Button onClick={onBrowseProducts}>Browse</Button>}
                      autoComplete="off"
                    />
                    {filteredProducts.length ? (
                      <BlockStack gap="200">
                        {filteredProducts.map((product) => (
                          <Box key={product.id} padding="300" borderWidth="025" borderColor="border" borderRadius="200">
                            <InlineStack align="space-between" blockAlign="center" gap="300">
                              <InlineStack gap="300" blockAlign="center">
                                <Thumbnail source={product.image || ImageIcon} alt={product.title} size="small" />
                                <BlockStack gap="050">
                                  <Text as="span" fontWeight="semibold">{product.title}</Text>
                                  <Text as="span" tone="subdued" variant="bodySm">{product.variantsCount ?? 0} variants selected</Text>
                                </BlockStack>
                              </InlineStack>
                              <Badge>{product.status || 'Selected'}</Badge>
                            </InlineStack>
                          </Box>
                        ))}
                      </BlockStack>
                    ) : (
                      <EmptyState heading="No products selected" image="" action={{content: 'Browse products', onAction: onBrowseProducts}}>
                        <p>Select one or more products for this mix-and-match bundle.</p>
                      </EmptyState>
                    )}
                  </BlockStack>
                </Card>

                <Card>
                  <BlockStack gap="400">
                    <SectionHeader title="Quantity Pack" description="Create quantity packs and discount options for your storefront." />
                    {packs.map((pack, index) => (
                      <QuantityPack
                        key={pack.id}
                        pack={pack}
                        index={index}
                        onChange={(key, value) => updatePack(pack.id, key, value)}
                        onDelete={() => setPacks((current) => current.filter((item) => item.id !== pack.id))}
                      />
                    ))}
                    <InlineStack gap="300" blockAlign="center">
                      <Button icon={PlusIcon} variant="primary" onClick={() => setPacks((current) => [...current, emptyPack()])}>Add Quantity Pack</Button>
                      <Text as="p" tone="subdued">Create custom quantity packs for your store.</Text>
                    </InlineStack>
                  </BlockStack>
                </Card>

                <Card>
                  <BlockStack gap="400">
                    <SectionHeader title="Upload Images" description="Upload images for this bundle product." />
                    <DropZone accept="image/jpeg,image/png,image/svg+xml" type="image" allowMultiple onDrop={handleDrop}>
                      {uploadedFiles}
                      {fileUpload}
                    </DropZone>
                  </BlockStack>
                </Card>

                <Card>
                  <BlockStack gap="400">
                    <SectionHeader title="Layout Display" description="Select the storefront layout for your bundle." />
                    <InlineGrid columns={{xs: 1, sm: 2}} gap="400">
                      {layoutOptions.map((option) => (
                        <LayoutCard key={option.value} option={option} selected={form.layout === option.value} onChange={(value) => setField('layout', value)} />
                      ))}
                    </InlineGrid>
                  </BlockStack>
                </Card>

                <Card>
                  <BlockStack gap="400">
                    <SectionHeader title="Customer Eligibility" />
                    <ChoiceList
                      title="Eligible customers"
                      titleHidden
                      choices={eligibilityOptions}
                      selected={form.eligibility}
                      onChange={(value) => setField('eligibility', value)}
                    />
                    {form.eligibility.includes('tags') ? (
                      <TextField label="Customer tags" value={form.customerTags} placeholder="VIP, wholesale" onChange={(value) => setField('customerTags', value)} autoComplete="off" />
                    ) : null}
                    {form.eligibility.includes('specific') ? (
                      <TextField label="Specific customers" value={form.customers} placeholder="Search or enter customer IDs" onChange={(value) => setField('customers', value)} autoComplete="off" />
                    ) : null}
                  </BlockStack>
                </Card>

                <Card>
                  <BlockStack gap="400">
                    <SectionHeader title="Status" />
                    <ChoiceList
                      title="Bundle status"
                      titleHidden
                      choices={[{label: 'Active', value: 'active'}, {label: 'Inactive', value: 'inactive'}]}
                      selected={[form.status]}
                      onChange={(value) => setField('status', value[0])}
                    />
                  </BlockStack>
                </Card>

                <Card>
                  <BlockStack gap="400">
                    <SectionHeader
                      title="Advance Options"
                      action={<Button disclosure={advancedOpen ? 'up' : 'down'} onClick={() => setAdvancedOpen((open) => !open)}>{advancedOpen ? 'Show Less' : 'Show More'}</Button>}
                    />
                    {advancedOpen ? (
                      <BlockStack gap="400">
                        <InlineStack gap="200" wrap>
                          <Button>Display Settings</Button>
                          <Button>Theme Customize</Button>
                          <Button>Add to Cart</Button>
                          <Button>Custom CSS</Button>
                        </InlineStack>
                        <TextField label="Section Title" value={form.sectionTitle} onChange={(value) => setField('sectionTitle', value)} autoComplete="off" />
                        <ChoiceList
                          title="Section Title Visibility"
                          choices={[{label: 'Show', value: 'show'}, {label: 'Hide', value: 'hide'}]}
                          selected={[form.showSectionTitle ? 'show' : 'hide']}
                          onChange={(value) => setField('showSectionTitle', value[0] === 'show')}
                          alignment="horizontal"
                        />
                        <ChoiceList
                          title="Product Price Visibility"
                          choices={[{label: 'Show', value: 'show'}, {label: 'Hide', value: 'hide'}]}
                          selected={[form.showProductPrice ? 'show' : 'hide']}
                          onChange={(value) => setField('showProductPrice', value[0] === 'show')}
                          alignment="horizontal"
                        />
                        <TextField label="Custom CSS" value={form.customCss} onChange={(value) => setField('customCss', value)} multiline={5} monospaced autoComplete="off" />
                      </BlockStack>
                    ) : null}
                  </BlockStack>
                </Card>
              </BlockStack>
            </Grid.Cell>

            <Grid.Cell columnSpan={{xs: 6, sm: 6, md: 6, lg: 4, xl: 4}}>
              <div style={{position: 'sticky', top: 16}}>
                <BlockStack gap="400">
                  <Card>
                    <BlockStack gap="400">
                      <Text as="h2" variant="headingMd">Summary</Text>
                      <Divider />
                      <InlineStack align="space-between"><Text as="span" tone="subdued">Title</Text><Text as="span">{form.bundleTitle || '—'}</Text></InlineStack>
                      <InlineStack align="space-between"><Text as="span" tone="subdued">Bundle Type</Text><Text as="span">Mix & Match</Text></InlineStack>
                      <InlineStack align="space-between"><Text as="span" tone="subdued">Product Count</Text><Text as="span">{selectedProducts.length}</Text></InlineStack>
                      <InlineStack align="space-between"><Text as="span" tone="subdued">Quantity Packs</Text><Text as="span">{packs.length}</Text></InlineStack>
                      <InlineStack align="space-between"><Text as="span" tone="subdued">Status</Text><Badge tone={form.status === 'active' ? 'success' : undefined}>{form.status === 'active' ? 'Active' : 'Inactive'}</Badge></InlineStack>
                      <InlineStack align="space-between"><Text as="span" tone="subdued">Customer Eligibility</Text><Text as="span">{eligibilityOptions.find((item) => item.value === form.eligibility[0])?.label}</Text></InlineStack>
                    </BlockStack>
                  </Card>

                  <Card>
                    <BlockStack gap="400">
                      <Text as="h2" variant="headingMd">Demo Layout Preview</Text>
                      <div style={{borderRadius: 12, background: 'var(--p-color-bg-surface-secondary)', padding: 16, minHeight: 280}}>
                        <BlockStack gap="300">
                          {form.showSectionTitle ? <Text as="h3" variant="headingSm">{form.sectionTitle || 'Build your bundle'}</Text> : null}
                          <Text as="p" tone="subdued">{form.bundleDescription || 'Your bundle description will appear here.'}</Text>
                          <InlineGrid columns={2} gap="200">
                            {(selectedProducts.length ? selectedProducts.slice(0, 4) : [{id: 1, title: 'Product one'}, {id: 2, title: 'Product two'}]).map((product) => (
                              <Box key={product.id} padding="200" background="bg-surface" borderRadius="200">
                                <BlockStack gap="150">
                                  <div style={{height: 72, borderRadius: 6, background: 'var(--p-color-bg-fill-tertiary)'}} />
                                  <Text as="span" variant="bodySm">{product.title}</Text>
                                  {form.showProductPrice ? <Text as="span" variant="bodySm" fontWeight="semibold">$100.00</Text> : null}
                                  <Button size="slim" fullWidth disabled>Add</Button>
                                </BlockStack>
                              </Box>
                            ))}
                          </InlineGrid>
                        </BlockStack>
                      </div>
                    </BlockStack>
                  </Card>
                </BlockStack>
              </div>
            </Grid.Cell>
          </Grid>

          <InlineStack align="end" gap="300">
            <Button onClick={onBack}>Cancel</Button>
            <Button variant="primary" submit loading={saving}>Save Bundle</Button>
          </InlineStack>
        </BlockStack>
      </Form>
    </Page>
  );
}