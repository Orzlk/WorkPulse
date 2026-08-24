import { describe, expect, it } from 'vitest'

import { isClearDataConfirmationValid } from '../../src/renderer/src/lib/clearDataConfirmation'

describe('clear data confirmation', () => {
  it.each([
    ['zh', '清除全部数据', true],
    ['zh', '清除全部数据 ', false],
    ['zh', 'CLEAR ALL DATA', false],
    ['en', 'CLEAR ALL DATA', true],
    ['en', 'clear all data', false],
    ['en', '清除全部数据', false]
  ] as const)('accepts only the exact confirmation phrase for %s', (language, value, expected) => {
    expect(isClearDataConfirmationValid(value, language)).toBe(expected)
  })
})
