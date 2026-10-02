import type { StudioAssetInfo, StudioWxmpRecord } from '@/services/studio/client'
import { describe, expect, it } from 'vitest'
import { reusableMaterialUrl } from './wechat-picture'

const ASSET: StudioAssetInfo = {
  path: `downloads/images/2026_10/x.png`,
  size: 215350,
  sha256: `6c7eabf8`,
  mime: `image/png`,
}

const RECORD: StudioWxmpRecord = {
  mode: `material`,
  url: `http://mmbiz.qpic.cn/x`,
  size: ASSET.size,
  sha256: ASSET.sha256,
  media_id: `32UljMYChYTgro`,
}

describe(`reusableMaterialUrl`, () => {
  it(`reuses a material record for the same bytes`, () => {
    expect(reusableMaterialUrl(RECORD, ASSET)).toBe(RECORD.url)
  })

  it(`re-uploads when the file changed, the mode differs, or no id was recorded`, () => {
    expect(reusableMaterialUrl({ ...RECORD, sha256: `other` }, ASSET)).toBe(``)
    expect(reusableMaterialUrl({ ...RECORD, size: ASSET.size + 1 }, ASSET)).toBe(``)
    // uploadimg records are the 图床's, not the article's: the rake task re-uploads them too.
    expect(reusableMaterialUrl({ ...RECORD, mode: `uploadimg` }, ASSET)).toBe(``)
    // The rake task treats a material record without a media id as not uploaded.
    expect(reusableMaterialUrl({ ...RECORD, media_id: undefined }, ASSET)).toBe(``)
    expect(reusableMaterialUrl(undefined, ASSET)).toBe(``)
  })
})
