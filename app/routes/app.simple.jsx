import {useCallback, useEffect, useMemo, useState} from 'react';
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
  Image,
  InlineGrid,
  InlineStack,
  Modal,
  Page,
  ResourceItem,
  ResourceList,
  Select,
  Text,
  TextField,
  Thumbnail,
} from '@shopify/polaris';
import {
  CollectionIcon,
  ImageIcon,
  PlusIcon,
  ProductIcon,
  SearchIcon,
} from '@shopify/polaris-icons';

const DISCOUNT_OPTIONS = [
  {label: 'Fixed bundle price', value: 'fixed_bundle_price'},
  {label: 'Percentage discount %', value: 'percentage'},
  {label: 'Fixed amount discount $', value: 'fixed_amount'},
];

const PRODUCT_CONFIGURATION_OPTIONS = [
  {label: 'Whole store', value: 'whole_store'},
  {label: 'Select products', value: 'selected_products'},
  {label: 'Select collections', value: 'selected_collections'},
];

function SectionHeading({title, description}) {
  return (
    <BlockStack gap="300">
      <BlockStack gap="100">
        <Text as="h2" variant="headingMd">{title}</Text>
        {description ? <Text as="p" tone="subdued">{description}</Text> : null}
      </BlockStack>
      <Divider />
    </BlockStack>
  );
}

function useFilePreview(file) {
  const [url, setUrl] = useState('');

  useEffect(() => {
    if (!file || typeof file === 'string') {
      setUrl(typeof file === 'string' ? file : '');
      return undefined;
    }

    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  return url;
}

function ImageUploader({label, value, onChange}) {
  const previewUrl = useFilePreview(value);

  const handleDrop = useCallback(
    (_droppedFiles, acceptedFiles) => onChange(acceptedFiles?.[0] ?? null),
    [onChange],
  );

  return (
    <BlockStack gap="200">
      <Text as="p" variant="bodyMd" fontWeight="medium">{label}</Text>
      <DropZone accept="image/*" type="image" allowMultiple={false} onDrop={handleDrop}>
        {value ? (
          <Box padding="300">
            <InlineStack gap="300" blockAlign="center" wrap={false}>
              <Thumbnail source={previewUrl || ImageIcon} alt={value?.name || label} size="large" />
              <BlockStack gap="100">
                <Text as="p" fontWeight="semibold">{value?.name || label}</Text>
                {value?.size ? (
                  <Text as="p" tone="subdued" variant="bodySm">
                    {(value.size / 1024).toFixed(1)} KB
                  </Text>
                ) : null}
                <Button variant="plain" tone="critical" onClick={() => onChange(null)}>
                  Remove
                </Button>
              </BlockStack>
            </InlineStack>
          </Box>
        ) : (
          <DropZone.FileUpload actionTitle={`Upload ${label}`} actionHint="PNG, JPG, WEBP or SVG" />
        )}
      </DropZone>
    </BlockStack>
  );
}

function PickerModal({open, title, items, selectedIds, onClose, onSave, type}) {
  const [query, setQuery] = useState('');
  const [draftSelected, setDraftSelected] = useState(selectedIds);

  useEffect(() => {
    if (open) setDraftSelected(selectedIds);
  }, [open, selectedIds]);

  const filteredItems = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) return items;
    return items.filter((item) => item.title.toLowerCase().includes(search));
  }, [items, query]);

  const toggleItem = useCallback((id) => {
    setDraftSelected((current) =>
      current.includes(id)
        ? current.filter((currentId) => currentId !== id)
        : [...current, id],
    );
  }, []);

  const handleClose = () => {
    setQuery('');
    setDraftSelected(selectedIds);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={title}
      primaryAction={{
        content: `Add selected ${type}`,
        onAction: () => {
          onSave(draftSelected);
          setQuery('');
        },
      }}
      secondaryActions={[{content: 'Cancel', onAction: handleClose}]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          <TextField
            label={`Search ${type}`}
            labelHidden
            prefix={<Icon source={SearchIcon} />}
            placeholder={`Search ${type}...`}
            value={query}
            onChange={setQuery}
            autoComplete="off"
          />

          {filteredItems.length ? (
            <ResourceList
              resourceName={{singular: type === 'products' ? 'product' : 'collection', plural: type}}
              items={filteredItems}
              renderItem={(item) => {
                const selected = draftSelected.includes(item.id);
                return (
                  <ResourceItem
                    id={item.id}
                    accessibilityLabel={`Select ${item.title}`}
                    onClick={() => toggleItem(item.id)}
                    media={
                      <Thumbnail
                        source={item.image || (type === 'products' ? ProductIcon : CollectionIcon)}
                        alt={item.title}
                        size="small"
                      />
                    }
                  >
                    <InlineStack align="space-between" blockAlign="center" wrap={false}>
                      <BlockStack gap="050">
                        <Text as="h3" variant="bodyMd" fontWeight="semibold">{item.title}</Text>
                        {item.subtitle ? <Text as="p" tone="subdued">{item.subtitle}</Text> : null}
                      </BlockStack>
                      <Checkbox
                        label={`Select ${item.title}`}
                        labelHidden
                        checked={selected}
                        onChange={() => toggleItem(item.id)}
                      />
                    </InlineStack>
                  </ResourceItem>
                );
              }}
            />
          ) : (
            <EmptyState heading={`No ${type} found`} image="">
              <p>Try another search term.</p>
            </EmptyState>
          )}
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}

function SelectedItems({items, selectedIds, onRemove, emptyText}) {
  const selectedItems = items.filter((item) => selectedIds.includes(item.id));

  if (!selectedItems.length) {
    return <Text as="p" tone="subdued">{emptyText}</Text>;
  }

  return (
    <ResourceList
      resourceName={{singular: 'item', plural: 'items'}}
      items={selectedItems}
      renderItem={(item) => (
        <ResourceItem
          id={item.id}
          media={<Thumbnail source={item.image || ImageIcon} alt={item.title} size="small" />}
          accessibilityLabel={item.title}
        >
          <InlineStack align="space-between" blockAlign="center" wrap={false}>
            <BlockStack gap="050">
              <Text as="p" fontWeight="semibold">{item.title}</Text>
              {item.subtitle ? <Text as="p" tone="subdued" variant="bodySm">{item.subtitle}</Text> : null}
            </BlockStack>
            <Button variant="plain" tone="critical" onClick={() => onRemove(item.id)}>
              Remove
            </Button>
          </InlineStack>
        </ResourceItem>
      )}
    />
  );
}

export default function MixMatchBundleForm({
  initialData,
  products = [],
  collections = [],
  onBack,
  onSubmit,
}) {
  const [form, setForm] = useState({
    status: initialData?.status || 'active',
    title: initialData?.title || '',
    description: initialData?.description || '',
    bundleImage: initialData?.bundleImage || null,
    bannerImage: initialData?.bannerImage || null,
    stepTitle: initialData?.stepTitle || 'Choose your products',
    stepDescription: initialData?.stepDescription || 'Select products to create your custom bundle.',
    productItems: initialData?.productItems || '3',
    buttonLabel: initialData?.buttonLabel || 'Add bundle to cart',
    discountType: initialData?.discountType || 'percentage',
    discountValue: initialData?.discountValue || '10',
    productConfiguration: initialData?.productConfiguration || 'whole_store',
  });

  const [selectedProductIds, setSelectedProductIds] = useState(initialData?.selectedProductIds || []);
  const [selectedCollectionIds, setSelectedCollectionIds] = useState(initialData?.selectedCollectionIds || []);
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [collectionModalOpen, setCollectionModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const bannerPreview = useFilePreview(form.bannerImage);

  const setField = useCallback((field, value) => {
    setForm((current) => ({...current, [field]: value}));
  }, []);

  const selectedCount =
    form.productConfiguration === 'selected_products'
      ? selectedProductIds.length
      : form.productConfiguration === 'selected_collections'
        ? selectedCollectionIds.length
        : products.length;

  const discountText = useMemo(() => {
    const value = form.discountValue || '0';
    if (form.discountType === 'percentage') return `${value}% off`;
    if (form.discountType === 'fixed_amount') return `$${value} off`;
    return `$${value} bundle price`;
  }, [form.discountType, form.discountValue]);

  const handleSubmit = async () => {
    try {
      setSaving(true);
      await onSubmit?.({...form, selectedProductIds, selectedCollectionIds});
    } finally {
      setSaving(false);
    }
  };

  return (
    <Page
      fullWidth
      title="Create Mix n Match Bundle"
      backAction={onBack ? {content: 'Back', onAction: onBack} : undefined}
      primaryAction={{content: 'Save Bundle', onAction: handleSubmit, loading: saving}}
    >
      <Form onSubmit={handleSubmit}>
        <Grid>
          <Grid.Cell columnSpan={{xs: 6, sm: 6, md: 6, lg: 8, xl: 8}}>
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="400">
                  <SectionHeading title="Status" description="Control whether this bundle is available on your storefront." />
                  <ChoiceList
                    title="Bundle status"
                    titleHidden
                    choices={[
                      {label: 'Active', value: 'active'},
                      {label: 'Inactive', value: 'inactive'},
                    ]}
                    selected={[form.status]}
                    onChange={(value) => setField('status', value[0])}
                  />
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="400">
                  <SectionHeading title="Bundle Information" description="Enter the bundle content shown on the storefront." />
                  <TextField
                    label="Title"
                    requiredIndicator
                    value={form.title}
                    onChange={(value) => setField('title', value)}
                    placeholder="Build your perfect bundle"
                    autoComplete="off"
                  />
                  <TextField
                    label="Description"
                    value={form.description}
                    onChange={(value) => setField('description', value)}
                    multiline={4}
                    placeholder="Describe this bundle"
                    autoComplete="off"
                  />
                  <InlineGrid columns={{xs: 1, md: 2}} gap="400">
                    <ImageUploader label="Bundle Image" value={form.bundleImage} onChange={(value) => setField('bundleImage', value)} />
                    <ImageUploader label="Banner Image" value={form.bannerImage} onChange={(value) => setField('bannerImage', value)} />
                  </InlineGrid>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="400">
                  <SectionHeading title="Configure Bundle" description="Configure the selection step displayed to customers." />
                  <TextField label="Step Title" value={form.stepTitle} onChange={(value) => setField('stepTitle', value)} autoComplete="off" />
                  <TextField label="Step Description" value={form.stepDescription} onChange={(value) => setField('stepDescription', value)} multiline={3} autoComplete="off" />
                  <TextField
                    label="Product Items"
                    type="number"
                    min={1}
                    value={form.productItems}
                    onChange={(value) => setField('productItems', value)}
                    helpText="Number of products the customer must select."
                    autoComplete="off"
                  />
                  <TextField label="Button Label" value={form.buttonLabel} onChange={(value) => setField('buttonLabel', value)} autoComplete="off" />
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="400">
                  <SectionHeading title="Discount" description="Choose how the bundle discount is calculated." />
                  <InlineGrid columns={{xs: 1, md: 2}} gap="400">
                    <Select label="Discount Type" options={DISCOUNT_OPTIONS} value={form.discountType} onChange={(value) => setField('discountType', value)} />
                    <TextField
                      label="Value"
                      type="number"
                      min={0}
                      value={form.discountValue}
                      onChange={(value) => setField('discountValue', value)}
                      prefix={form.discountType === 'percentage' ? undefined : '$'}
                      suffix={form.discountType === 'percentage' ? '%' : undefined}
                      autoComplete="off"
                    />
                  </InlineGrid>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="400">
                  <SectionHeading title="Product Configuration" description="Choose which products are available in this bundle." />
                  <ChoiceList
                    title="Product source"
                    titleHidden
                    choices={PRODUCT_CONFIGURATION_OPTIONS}
                    selected={[form.productConfiguration]}
                    onChange={(value) => setField('productConfiguration', value[0])}
                  />

                  {form.productConfiguration === 'whole_store' ? (
                    <Box padding="300" background="bg-surface-secondary" borderRadius="300">
                      <Text as="p">All active products in the store will be available.</Text>
                    </Box>
                  ) : null}

                  {form.productConfiguration === 'selected_products' ? (
                    <BlockStack gap="300">
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="h3" variant="headingSm">Selected products</Text>
                        <Button icon={PlusIcon} onClick={() => setProductModalOpen(true)}>Add Products</Button>
                      </InlineStack>
                      <SelectedItems
                        items={products}
                        selectedIds={selectedProductIds}
                        onRemove={(id) => setSelectedProductIds((current) => current.filter((currentId) => currentId !== id))}
                        emptyText="No products selected yet."
                      />
                    </BlockStack>
                  ) : null}

                  {form.productConfiguration === 'selected_collections' ? (
                    <BlockStack gap="300">
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="h3" variant="headingSm">Selected collections</Text>
                        <Button icon={PlusIcon} onClick={() => setCollectionModalOpen(true)}>Add Collections</Button>
                      </InlineStack>
                      <SelectedItems
                        items={collections}
                        selectedIds={selectedCollectionIds}
                        onRemove={(id) => setSelectedCollectionIds((current) => current.filter((currentId) => currentId !== id))}
                        emptyText="No collections selected yet."
                      />
                    </BlockStack>
                  ) : null}
                </BlockStack>
              </Card>
            </BlockStack>
          </Grid.Cell>

          <Grid.Cell columnSpan={{xs: 6, sm: 6, md: 6, lg: 4, xl: 4}}>
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="400">
                  <SectionHeading title="Summary" />
                  <InlineStack align="space-between">
                    <Text as="span" tone="subdued">Status</Text>
                    <Badge tone={form.status === 'active' ? 'success' : undefined}>
                      {form.status === 'active' ? 'Active' : 'Inactive'}
                    </Badge>
                  </InlineStack>
                  <InlineStack align="space-between">
                    <Text as="span" tone="subdued">Required product items</Text>
                    <Text as="span" fontWeight="semibold">{form.productItems || '0'}</Text>
                  </InlineStack>
                  <InlineStack align="space-between">
                    <Text as="span" tone="subdued">Available items</Text>
                    <Text as="span" fontWeight="semibold">{selectedCount}</Text>
                  </InlineStack>
                  <InlineStack align="space-between">
                    <Text as="span" tone="subdued">Discount</Text>
                    <Text as="span" fontWeight="semibold">{discountText}</Text>
                  </InlineStack>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="400">
                  <SectionHeading title="Preview" description="Approximate storefront preview." />

                  {bannerPreview ? (
                    <Image source={bannerPreview} alt="Bundle banner preview" />
                  ) : (
                    <Box padding="600" background="bg-surface-secondary" borderRadius="300">
                      <BlockStack gap="200" inlineAlign="center">
                        <Icon source={ImageIcon} />
                        <Text as="p" tone="subdued">Banner preview</Text>
                      </BlockStack>
                    </Box>
                  )}

                  <BlockStack gap="200">
                    <Text as="h2" variant="headingLg">{form.title || 'Bundle title'}</Text>
                    <Text as="p" tone="subdued">{form.description || 'Your bundle description will appear here.'}</Text>
                  </BlockStack>

                  <Box padding="400" background="bg-surface-secondary" borderRadius="300">
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingMd">{form.stepTitle || 'Choose your products'}</Text>
                      <Text as="p" tone="subdued">{form.stepDescription || 'Step description'}</Text>
                      <InlineGrid columns={{xs: 2, sm: 4}} gap="200">
                        {Array.from({length: Math.min(Number(form.productItems) || 3, 4)}).map((_, index) => (
                          <Box key={index} padding="400" background="bg-surface" borderRadius="300" borderWidth="025" borderColor="border">
                            <BlockStack inlineAlign="center">
                              <Text as="span" tone="subdued">{index + 1}</Text>
                            </BlockStack>
                          </Box>
                        ))}
                      </InlineGrid>
                    </BlockStack>
                  </Box>

                  <Button variant="primary" fullWidth>{form.buttonLabel || 'Add bundle to cart'}</Button>
                </BlockStack>
              </Card>
            </BlockStack>
          </Grid.Cell>
        </Grid>
      </Form>

      <PickerModal
        open={productModalOpen}
        title="Add Products"
        items={products}
        selectedIds={selectedProductIds}
        onClose={() => setProductModalOpen(false)}
        onSave={(ids) => {
          setSelectedProductIds(ids);
          setProductModalOpen(false);
        }}
        type="products"
      />

      <PickerModal
        open={collectionModalOpen}
        title="Add Collections"
        items={collections}
        selectedIds={selectedCollectionIds}
        onClose={() => setCollectionModalOpen(false)}
        onSave={(ids) => {
          setSelectedCollectionIds(ids);
          setCollectionModalOpen(false);
        }}
        type="collections"
      />
    </Page>
  );
}