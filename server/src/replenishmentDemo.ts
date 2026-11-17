type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value);
const finiteNonNegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const safeInteger = (value: unknown): value is number => finiteNonNegative(value) && Number.isSafeInteger(value);
const isDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const hasExactKeys = (value: JsonObject, expected: string[]) => {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === [...expected].sort()[index]);
};

const metadataKeys = [
  'source', 'experiment', 'as_of_date', 'model', 'model_config', 'training_period', 'forecast_period',
  'review_period_days', 'safety_stock_policy', 'supplier_count', 'synthetic_product_count',
  'supplier_offer_count', 'recommendation_count', 'limitations',
];
const modelConfigKeys = [
  'max_depth', 'learning_rate', 'n_estimators', 'min_child_weight', 'subsample', 'colsample_bytree',
  'reg_alpha', 'reg_lambda', 'random_state',
];
const rowKeys = [
  'synthetic_product_id', 'supplier_id', 'current_stock', 'forecast_demand', 'safety_stock', 'inbound_quantity',
  'lead_time_days', 'minimum_order_quantity', 'pack_size', 'purchase_price', 'currency', 'recommended_quantity',
  'estimated_cost', 'recommendation_status', 'source', 'coverage_start_date', 'coverage_end_date', 'explanation',
  'supplier_name', 'product_name', 'category_id',
];
const statuses = new Set(['PURCHASE_RECOMMENDED', 'NO_PURCHASE_NEEDED', 'INSUFFICIENT_FORECAST']);

/** Validates the fixed synthetic report shape before it leaves the backend. */
export function isSyntheticReplenishmentReport(value: unknown): value is JsonObject & { metadata: JsonObject; recommendations: JsonObject[] } {
  if (!isObject(value) || !hasExactKeys(value, ['metadata', 'recommendations']) || !isObject(value.metadata) || !Array.isArray(value.recommendations)) return false;
  const metadata = value.metadata;
  if (!hasExactKeys(metadata, metadataKeys) || metadata.source !== 'SYNTHETIC' || typeof metadata.experiment !== 'string' ||
      !isDate(metadata.as_of_date) || typeof metadata.model !== 'string' || !isObject(metadata.model_config) ||
      !hasExactKeys(metadata.model_config, modelConfigKeys) || !Object.values(metadata.model_config).every(finiteNonNegative) ||
      !isObject(metadata.training_period) || !hasExactKeys(metadata.training_period, ['start', 'end']) ||
      !isDate(metadata.training_period.start) || !isDate(metadata.training_period.end) ||
      !isObject(metadata.forecast_period) || !hasExactKeys(metadata.forecast_period, ['start', 'end']) ||
      !isDate(metadata.forecast_period.start) || !isDate(metadata.forecast_period.end) ||
      !safeInteger(metadata.review_period_days) || !isObject(metadata.safety_stock_policy) ||
      !hasExactKeys(metadata.safety_stock_policy, ['name', 'safety_days', 'note']) || typeof metadata.safety_stock_policy.name !== 'string' ||
      !safeInteger(metadata.safety_stock_policy.safety_days) || typeof metadata.safety_stock_policy.note !== 'string' ||
      !safeInteger(metadata.supplier_count) || !safeInteger(metadata.synthetic_product_count) ||
      !safeInteger(metadata.supplier_offer_count) || !safeInteger(metadata.recommendation_count) ||
      !Array.isArray(metadata.limitations) || !metadata.limitations.every((item) => typeof item === 'string')) return false;

  const productIds = new Set<string>();
  const supplierIds = new Set<string>();
  for (const item of value.recommendations) {
    if (!isObject(item) || !hasExactKeys(item, rowKeys) ||
        typeof item.synthetic_product_id !== 'string' || !/^SYN-[A-Z0-9-]+$/.test(item.synthetic_product_id) ||
        typeof item.supplier_id !== 'string' || !/^SYN-SUP-[A-Z0-9-]+$/.test(item.supplier_id) ||
        typeof item.supplier_name !== 'string' || !item.supplier_name.trim() ||
        typeof item.product_name !== 'string' || !item.product_name.trim() ||
        !safeInteger(item.current_stock) || !safeInteger(item.safety_stock) || !safeInteger(item.inbound_quantity) ||
        !safeInteger(item.lead_time_days) || !safeInteger(item.minimum_order_quantity) || !safeInteger(item.pack_size) ||
        !finiteNonNegative(item.purchase_price) || item.currency !== 'KZT' || !safeInteger(item.category_id) ||
        !(item.forecast_demand === null || finiteNonNegative(item.forecast_demand)) ||
        !(item.recommended_quantity === null || safeInteger(item.recommended_quantity)) ||
        !(item.estimated_cost === null || finiteNonNegative(item.estimated_cost)) ||
        typeof item.recommendation_status !== 'string' || !statuses.has(item.recommendation_status) ||
        item.source !== 'SYNTHETIC' || !isDate(item.coverage_start_date) || !isDate(item.coverage_end_date) ||
        typeof item.explanation !== 'string' || !item.explanation.trim()) return false;
    if (item.recommendation_status === 'INSUFFICIENT_FORECAST') {
      if (item.forecast_demand !== null || item.recommended_quantity !== null || item.estimated_cost !== null) return false;
    } else if (item.forecast_demand === null || item.recommended_quantity === null || item.estimated_cost === null) return false;
    productIds.add(item.synthetic_product_id);
    supplierIds.add(item.supplier_id);
  }
  return metadata.recommendation_count === value.recommendations.length &&
    metadata.supplier_offer_count === value.recommendations.length &&
    metadata.synthetic_product_count === productIds.size && metadata.supplier_count === supplierIds.size;
}
