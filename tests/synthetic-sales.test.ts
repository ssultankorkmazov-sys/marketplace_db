import { describe, expect, it } from 'vitest'
import {
  createEventCalendar,
  generateSyntheticSales,
  getDemandFactors,
  summarizeSyntheticSales,
  SYNTHETIC_PRODUCTS,
} from '../scripts/generate-synthetic-sales.mjs'

describe('synthetic sales generator', () => {
  it('is deterministic for the same seed', () => {
    const first = generateSyntheticSales(20250308)
    const second = generateSyntheticSales(20250308)
    expect(second).toEqual(first)
  })

  it('covers every day from 2025-01-01 through 2026-12-31 for each synthetic product', () => {
    const dataset = generateSyntheticSales(42)
    expect(dataset.metadata.start_date).toBe('2025-01-01')
    expect(dataset.metadata.end_date).toBe('2026-12-31')
    expect(dataset.sales).toHaveLength(SYNTHETIC_PRODUCTS.length * 730)
    for (const product of SYNTHETIC_PRODUCTS) {
      const rows = dataset.sales.filter((row) => row.synthetic_product_id === product.id)
      expect(rows).toHaveLength(730)
      expect(rows[0].date).toBe('2025-01-01')
      expect(rows.at(-1)?.date).toBe('2026-12-31')
    }
  })

  it('keeps quantities non-negative and marks every row as synthetic', () => {
    const { sales } = generateSyntheticSales(17)
    expect(sales.every((row) => Number.isInteger(row.quantity_sold) && row.quantity_sold >= 0)).toBe(true)
    expect(sales.every((row) => row.source === 'SYNTHETIC')).toBe(true)
  })

  it('creates exact Kazakhstan event dates for both years with influence windows and coefficients', () => {
    const calendar = createEventCalendar()
    expect(calendar).toHaveLength(12)
    expect(calendar.filter((event) => event.date.startsWith('2025-')).map((event) => event.date)).toEqual([
      '2025-01-01', '2025-02-14', '2025-03-08', '2025-03-22', '2025-06-01', '2025-09-01',
    ])
    expect(calendar.filter((event) => event.date.startsWith('2026-')).map((event) => event.date)).toEqual([
      '2026-01-01', '2026-02-14', '2026-03-08', '2026-03-22', '2026-06-01', '2026-09-01',
    ])
    expect(calendar.every((event) => event.name && event.influence_before_days >= 0 && event.influence_after_days >= 0 && event.demand_coefficient > 1)).toBe(true)
  })

  it('uses category IDs from the existing MarketKZ seed catalog', () => {
    const expected = new Map([
      ['Bags', 13], ['Stationery', 17], ['Laptops', 2], ['Tablets', 3],
      ['Home Appliances', 22], ['Outdoor', 35], ['Beauty', 18],
      ['Perfume', 21], ['Headphones', 4], ['Kitchen', 23], ['Books', 16],
    ])
    expect(SYNTHETIC_PRODUCTS.every((product) => expected.get(product.category_name) === product.category_id)).toBe(true)
  })

  it('produces higher demand for seasonal and holiday-sensitive profiles in their target windows', () => {
    const dataset = generateSyntheticSales(20250308)
    const thermos = dataset.sales.filter((row) => row.synthetic_product_id === 'SYN-P010')
    const average = (rows: typeof thermos) => rows.reduce((sum, row) => sum + row.quantity_sold, 0) / rows.length
    const winter = thermos.filter((row) => ['2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-10', '2026-11', '2026-12'].some((month) => row.date.startsWith(month)))
    const summer = thermos.filter((row) => ['2025-06', '2025-07', '2025-08', '2026-06', '2026-07', '2026-08'].some((month) => row.date.startsWith(month)))
    expect(average(winter)).toBeGreaterThan(average(summer))

    const perfume = dataset.sales.filter((row) => row.synthetic_product_id === 'SYN-P008')
    const holidayRows = perfume.filter((row) => row.applied_event_codes.includes('WOMENS_DAY'))
    const ordinaryRows = perfume.filter((row) => !row.active_event_codes.some((code) => ['NEW_YEAR', 'VALENTINE', 'WOMENS_DAY', 'NAURYZ'].includes(code)))
    expect(average(holidayRows)).toBeGreaterThan(average(ordinaryRows))

    const summerGoods = dataset.sales.filter((row) => row.synthetic_product_id === 'SYN-P005')
    const summerWindow = summerGoods.filter((row) => row.active_event_codes.includes('SUMMER_SEASON'))
    const outsideSummer = summerGoods.filter((row) => !row.active_event_codes.includes('SUMMER_SEASON'))
    expect(average(summerWindow)).toBeGreaterThan(average(outsideSummer))

    const schoolGoods = dataset.sales.filter((row) => row.synthetic_product_id === 'SYN-P002')
    const schoolWindow = schoolGoods.filter((row) => row.applied_event_codes.includes('BACK_TO_SCHOOL'))
    const outsideSchoolWindow = schoolGoods.filter((row) => !row.applied_event_codes.includes('BACK_TO_SCHOOL'))
    expect(average(schoolWindow)).toBeGreaterThan(average(outsideSchoolWindow))
  })

  it('does not assign holiday multipliers to a stable product without matching sensitivity', () => {
    const calendar = createEventCalendar()
    const stable = SYNTHETIC_PRODUCTS.find((product) => product.demand_profile === 'stable')!
    for (const date of ['2025-01-01', '2025-02-14', '2025-03-08', '2025-03-22', '2025-09-01']) {
      const factors = getDemandFactors(stable, date, calendar)
      expect(factors.eventMultiplier).toBe(1)
      expect(factors.appliedEventCodes).toEqual([])
    }
    const rows = generateSyntheticSales(20250308).sales.filter((row) => row.synthetic_product_id === stable.id)
    expect(rows.every((row) => row.event_multiplier === 1)).toBe(true)
  })

  it('includes non-negative prices, discounts, event labels and a monthly summary', () => {
    const dataset = generateSyntheticSales(99)
    expect(dataset.sales.every((row) => row.price > 0 && row.selling_price > 0 && row.discount_percent >= 0 && row.discount_percent <= 100)).toBe(true)
    expect(dataset.sales.some((row) => row.discount_percent > 0)).toBe(true)
    expect(dataset.sales.some((row) => row.active_event_codes.length > 0)).toBe(true)
    expect(summarizeSyntheticSales(dataset)).toHaveLength(24)
  })
})
