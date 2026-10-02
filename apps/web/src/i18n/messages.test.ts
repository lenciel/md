import { describe, expect, it } from 'vitest'
import enUS from '@/i18n/messages/en-US'
import jaJP from '@/i18n/messages/ja-JP'
import zhCN from '@/i18n/messages/zh-CN'
import zhTW from '@/i18n/messages/zh-TW'

function flatten(input: Record<string, unknown>, prefix = ``): string[] {
  return Object.entries(input).flatMap(([key, value]) =>
    value && typeof value === `object`
      ? flatten(value as Record<string, unknown>, `${prefix}${key}.`)
      : [`${prefix}${key}`])
}

describe(`locale parity`, () => {
  it(`other locales mirror zh-CN`, () => {
    const base = new Set(flatten(zhCN as Record<string, unknown>))
    for (const [name, locale] of [[`en-US`, enUS], [`zh-TW`, zhTW], [`ja-JP`, jaJP]] as const) {
      const keys = new Set(flatten(locale as Record<string, unknown>))
      const missing = [...base].filter(key => !keys.has(key))
      const extra = [...keys].filter(key => !base.has(key))
      console.log(name, { missingCount: missing.length, extraCount: extra.length, missing: missing.slice(0, 6), extra: extra.slice(0, 6) })
      expect({ name, missing, extra }).toEqual({ name, missing: [], extra: [] })
    }
  })
})
