import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const START_DATE = '2025-01-01'
export const END_DATE = '2026-12-31'
export const DEFAULT_SEED = 20250308

// Category IDs and names follow the category order in db/marketplace_db.sql.
export const SYNTHETIC_PRODUCTS = Object.freeze([
  { id: 'SYN-P001', name: 'Школьный рюкзак', category_id: 13, category_name: 'Bags', demand_profile: 'back-to-school', base_daily_demand: 1.8, base_price: 18900, annual_price_growth: 0.035, holiday_sensitive: ['BACK_TO_SCHOOL', 'NEW_YEAR'] },
  { id: 'SYN-P002', name: 'Набор тетрадей', category_id: 17, category_name: 'Stationery', demand_profile: 'back-to-school', base_daily_demand: 4.2, base_price: 2400, annual_price_growth: 0.025, holiday_sensitive: ['BACK_TO_SCHOOL'] },
  { id: 'SYN-P003', name: 'Учебный ноутбук', category_id: 2, category_name: 'Laptops', demand_profile: 'back-to-school', base_daily_demand: 0.55, base_price: 329900, annual_price_growth: 0.02, holiday_sensitive: ['BACK_TO_SCHOOL', 'NEW_YEAR'] },
  { id: 'SYN-P004', name: 'Планшет для учёбы', category_id: 3, category_name: 'Tablets', demand_profile: 'back-to-school', base_daily_demand: 0.8, base_price: 119900, annual_price_growth: 0.025, holiday_sensitive: ['BACK_TO_SCHOOL', 'NEW_YEAR'] },
  { id: 'SYN-P005', name: 'Мобильный кондиционер', category_id: 22, category_name: 'Home Appliances', demand_profile: 'summer-demand', base_daily_demand: 0.38, base_price: 189900, annual_price_growth: 0.03, holiday_sensitive: [] },
  { id: 'SYN-P006', name: 'Палатка туристическая', category_id: 35, category_name: 'Outdoor', demand_profile: 'summer-demand', base_daily_demand: 0.65, base_price: 64900, annual_price_growth: 0.03, holiday_sensitive: [] },
  { id: 'SYN-P007', name: 'Подарочный набор ухода', category_id: 18, category_name: 'Beauty', demand_profile: 'holiday-sensitive', base_daily_demand: 1.5, base_price: 12900, annual_price_growth: 0.04, holiday_sensitive: ['VALENTINE', 'WOMENS_DAY', 'NAURYZ', 'NEW_YEAR'] },
  { id: 'SYN-P008', name: 'Парфюм', category_id: 21, category_name: 'Perfume', demand_profile: 'holiday-sensitive', base_daily_demand: 0.9, base_price: 45900, annual_price_growth: 0.04, holiday_sensitive: ['VALENTINE', 'WOMENS_DAY', 'NAURYZ', 'NEW_YEAR'] },
  { id: 'SYN-P009', name: 'Беспроводные наушники', category_id: 4, category_name: 'Headphones', demand_profile: 'stable', base_daily_demand: 2.4, base_price: 24900, annual_price_growth: 0.03, holiday_sensitive: [] },
  { id: 'SYN-P010', name: 'Термос для походов', category_id: 35, category_name: 'Outdoor', demand_profile: 'seasonal', base_daily_demand: 1.1, base_price: 9900, annual_price_growth: 0.025, holiday_sensitive: [] },
  { id: 'SYN-P011', name: 'Кофемашина', category_id: 23, category_name: 'Kitchen', demand_profile: 'holiday-sensitive', base_daily_demand: 0.45, base_price: 79900, annual_price_growth: 0.03, holiday_sensitive: ['NEW_YEAR', 'NAURYZ'] },
  { id: 'SYN-P012', name: 'Книга для школьников', category_id: 16, category_name: 'Books', demand_profile: 'back-to-school', base_daily_demand: 1.2, base_price: 5900, annual_price_growth: 0.025, holiday_sensitive: ['BACK_TO_SCHOOL'] },
])

const EVENT_DEFINITIONS = Object.freeze([
  { code: 'NEW_YEAR', name: 'Новый год', month: 1, day: 1, influence_before_days: 21, influence_after_days: 5, demand_coefficient: 1.5 },
  { code: 'VALENTINE', name: 'День святого Валентина', month: 2, day: 14, influence_before_days: 10, influence_after_days: 1, demand_coefficient: 1.3 },
  { code: 'WOMENS_DAY', name: 'Международный женский день', month: 3, day: 8, influence_before_days: 14, influence_after_days: 2, demand_coefficient: 1.65 },
  { code: 'NAURYZ', name: 'Наурыз', month: 3, day: 22, influence_before_days: 10, influence_after_days: 3, demand_coefficient: 1.4 },
  { code: 'SUMMER_SEASON', name: 'Летний сезон', month: 6, day: 1, influence_before_days: 0, influence_after_days: 91, demand_coefficient: 1.3 },
  { code: 'BACK_TO_SCHOOL', name: 'Начало учебного года', month: 9, day: 1, influence_before_days: 35, influence_after_days: 10, demand_coefficient: 1.55 },
])

export function createEventCalendar() {
  return [2025, 2026].flatMap((year) => EVENT_DEFINITIONS.map((event) => ({
    ...event,
    date: `${year}-${String(event.month).padStart(2, '0')}-${String(event.day).padStart(2, '0')}`,
  })))
}

function dateAtUtc(date) {
  const value = new Date(`${date}T00:00:00.000Z`)
  if (!Number.isFinite(value.getTime())) throw new Error(`Invalid ISO date: ${date}`)
  return value
}

function daysBetween(a, b) {
  return Math.round((dateAtUtc(b).getTime() - dateAtUtc(a).getTime()) / 86_400_000)
}

function createRandom(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6D2B79F5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }
}

function poisson(lambda, random) {
  if (lambda <= 0) return 0
  const limit = Math.exp(-lambda)
  let product = 1
  let count = 0
  do { count++; product *= random() } while (product > limit)
  return count - 1
}

function activeEvents(date, calendar) {
  return calendar.filter((event) => {
    const offset = daysBetween(event.date, date)
    return offset >= -event.influence_before_days && offset <= event.influence_after_days
  })
}

function seasonFactor(product, date, events) {
  const month = Number(date.slice(5, 7))
  if (product.demand_profile === 'seasonal') return month >= 10 || month <= 3 ? 1.5 : month >= 6 && month <= 8 ? 0.72 : 1
  if (product.demand_profile === 'summer-demand') return events.some((event) => event.code === 'SUMMER_SEASON') ? 1.7 : 0.85
  if (product.demand_profile === 'back-to-school') return month === 8 || month === 9 ? 1.15 : 1
  return 1
}

export function getDemandFactors(product, date, calendar = createEventCalendar(), weekday = dateAtUtc(date).getUTCDay()) {
  const active = activeEvents(date, calendar)
  let eventMultiplier = 1
  const applied = []
  for (const event of active) {
    const relevantSeason = product.demand_profile === 'summer-demand' && event.code === 'SUMMER_SEASON'
    if (relevantSeason || product.holiday_sensitive.includes(event.code)) {
      eventMultiplier *= event.demand_coefficient
      applied.push(event.code)
    }
  }
  const weekdayMultiplier = weekday === 0 || weekday === 6 ? 1.12 : weekday === 1 ? 0.96 : 1
  return {
    activeEvents: active,
    appliedEventCodes: applied,
    eventMultiplier,
    seasonalMultiplier: seasonFactor(product, date, active),
    weekdayMultiplier,
  }
}

function roundMoney(value) { return Math.round(value * 100) / 100 }

function makeSale(product, date, calendar, random) {
  const factors = getDemandFactors(product, date, calendar)
  const dayIndex = Math.floor((dateAtUtc(date).getTime() - dateAtUtc(START_DATE).getTime()) / 86_400_000)
  const yearsElapsed = Number(date.slice(0, 4)) - 2025
  const quarterStep = Math.floor(Number(date.slice(5, 7)) / 3)
  const price = roundMoney(product.base_price * (1 + product.annual_price_growth) ** yearsElapsed * (1 + quarterStep * 0.003))
  const isRelevantEvent = factors.appliedEventCodes.length > 0
  const discountPercent = isRelevantEvent && random() < 0.32
    ? (random() < 0.55 ? 10 : 15)
    : random() < 0.018 ? 5 : 0
  const sellingPrice = roundMoney(price * (1 - discountPercent / 100))
  const priceMultiplier = Math.pow(product.base_price / price, 0.35)
  const discountMultiplier = 1 + discountPercent / 100
  const trendMultiplier = 1 + dayIndex * 0.00004
  const expectedUnits = product.base_daily_demand * factors.seasonalMultiplier * factors.eventMultiplier * factors.weekdayMultiplier * priceMultiplier * discountMultiplier * trendMultiplier
  const quantitySold = poisson(expectedUnits, random)
  return {
    date,
    synthetic_product_id: product.id,
    category_id: product.category_id,
    quantity_sold: quantitySold,
    price,
    discount_percent: discountPercent,
    selling_price: sellingPrice,
    active_event_codes: factors.activeEvents.map((event) => event.code),
    active_event_names: factors.activeEvents.map((event) => event.name),
    applied_event_codes: factors.appliedEventCodes,
    event_multiplier: roundMoney(factors.eventMultiplier),
    seasonal_multiplier: roundMoney(factors.seasonalMultiplier),
    weekday_multiplier: factors.weekdayMultiplier,
    source: 'SYNTHETIC',
  }
}

function isoDates() {
  const dates = []
  for (let time = dateAtUtc(START_DATE).getTime(); time <= dateAtUtc(END_DATE).getTime(); time += 86_400_000) {
    dates.push(new Date(time).toISOString().slice(0, 10))
  }
  return dates
}

export function generateSyntheticSales(seed = DEFAULT_SEED) {
  if (!Number.isSafeInteger(seed) || seed < 1 || seed > 4_294_967_295) throw new Error('Seed must be an integer from 1 to 4294967295.')
  const random = createRandom(seed)
  const calendar = createEventCalendar()
  const sales = []
  for (const product of SYNTHETIC_PRODUCTS) {
    for (const date of isoDates()) sales.push(makeSale(product, date, calendar, random))
  }
  return {
    metadata: {
      source: 'SYNTHETIC',
      seed,
      generated_at: 'DETERMINISTIC_FROM_SEED',
      start_date: START_DATE,
      end_date: END_DATE,
      timezone: 'UTC date labels; holiday dates are Kazakhstan calendar dates',
      records: sales.length,
      note: 'Artificial demonstration data. It is not real transaction history and must not be loaded into orders or order_items.',
    },
    categories: [...new Map(SYNTHETIC_PRODUCTS.map((product) => [product.category_id, { category_id: product.category_id, category_name: product.category_name }])).values()],
    products: SYNTHETIC_PRODUCTS.map(({ id, name, category_id, category_name, demand_profile, base_daily_demand, base_price, annual_price_growth, holiday_sensitive }) => ({
      synthetic_product_id: id, name, category_id, category_name, demand_profile, base_daily_demand, base_price, annual_price_growth, holiday_sensitive,
    })),
    seasonal_events: createEventCalendar(),
    sales,
  }
}

export function summarizeSyntheticSales(dataset) {
  const months = new Map()
  for (const row of dataset.sales) {
    const month = row.date.slice(0, 7)
    const summary = months.get(month) ?? { month, records: 0, units_sold: 0, products_with_sales: new Set() }
    summary.records++
    summary.units_sold += row.quantity_sold
    if (row.quantity_sold > 0) summary.products_with_sales.add(row.synthetic_product_id)
    months.set(month, summary)
  }
  return [...months.values()].map(({ month, records, units_sold, products_with_sales }) => ({
    month, records, units_sold, products_with_sales: products_with_sales.size,
  }))
}

function parseArgs(args) {
  const options = { seed: DEFAULT_SEED, output: path.join(ROOT, 'fixtures', 'synthetic-sales-2025-2026.json') }
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === '--help' || arg === '-h') return { help: true }
    if (arg === '--seed') options.seed = Number(args[++index])
    else if (arg === '--out') options.output = path.resolve(process.cwd(), args[++index] ?? '')
    else throw new Error(`Unknown option: ${arg}`)
  }
  return options
}

function printUsage() {
  console.log('Usage: node scripts/generate-synthetic-sales.mjs [--seed 20250308] [--out fixtures/synthetic-sales-2025-2026.json]')
  console.log('The generator refuses to overwrite an existing output file. Choose a new --out path for another run.')
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) return printUsage()
  const dataset = generateSyntheticSales(options.seed)
  const output = path.resolve(options.output)
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, `${JSON.stringify(dataset, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  const monthly = summarizeSyntheticSales(dataset)
  const totalUnits = dataset.sales.reduce((sum, row) => sum + row.quantity_sold, 0)
  console.log(JSON.stringify({ output: path.relative(ROOT, output), seed: dataset.metadata.seed, records: dataset.sales.length, total_units_sold: totalUnits, monthly }, null, 2))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main() } catch (error) { console.error(error instanceof Error ? error.message : 'Synthetic sales generation failed.'); process.exitCode = 1 }
}
