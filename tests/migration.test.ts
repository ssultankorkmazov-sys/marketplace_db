import { beforeEach, describe, expect, it } from 'vitest'
import { SEED_VERSION, T, resetCache } from '../src/data/store'

beforeEach(() => { localStorage.clear(); resetCache() })

describe('legacy fixture migration for workflows not yet connected to the API', () => {
  it('replaces obsolete seeded rows with the SQL fixture while retaining visitor-owned records', () => {
    localStorage.setItem('marketkz_seed_version', '1')
    localStorage.setItem('marketkz_users', JSON.stringify([
      { user_id: 1, name: 'Old placeholder', email: 'old@example.kz', phone: 'old', address: null },
      { user_id: 51, name: 'Registered visitor', email: 'visitor@example.kz', phone: 'visitor', address: null },
    ]))
    localStorage.setItem('marketkz_orders', JSON.stringify([{ order_id: 51, user_id: 51, order_date: '2026-01-01', status: 'Processing', total_amount: 100 }]))
    resetCache()
    expect(T.users()[0].name).toBe('Aruzhan Saparova')
    expect(T.users().at(-1)?.email).toBe('visitor@example.kz')
    expect(T.orders().at(-1)?.user_id).toBe(51)
    expect(localStorage.getItem('marketkz_seed_version')).toBe(SEED_VERSION)
  })

  it('seeds clean installs from the SQL fixture', () => {
    expect(T.users()).toHaveLength(50)
    expect(T.orders()).toHaveLength(50)
    expect(T.reviews()).toHaveLength(50)
  })
})
