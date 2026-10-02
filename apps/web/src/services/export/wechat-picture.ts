import type { StudioAssetInfo, StudioWxmpRecord } from '@/services/studio/client'
import { t } from '@/i18n/translate'
import { studioApi, StudioHttpError } from '@/services/studio/client'
import { uploadMpMaterial } from '@/services/upload/providers'

/** Set by the Jekyll preprocessor on every image that came from a `{% picture %}` tag. */
const PICTURE_SELECTOR = `img[data-picture-path]`

export interface PictureUploadSummary {
  uploaded: number
  reused: number
}

/**
 * The URL of a manifest record that may be reused instead of uploading again.
 *
 * A record only counts for the same bytes and the same endpoint, which is exactly what
 * `rake wxmp:upload` checks before skipping a file, so the editor and a deploy agree on
 * what "already uploaded" means.
 */
export function reusableMaterialUrl(record: StudioWxmpRecord | undefined, asset: StudioAssetInfo): string {
  if (!record || record.mode !== `material` || record.size !== asset.size || record.sha256 !== asset.sha256)
    return ``

  return record.media_id && record.url ? record.url : ``
}

/**
 * WeChat sniffs image bytes and rejects webp (40137) however the file is named, and the
 * blog does hold images whose extension is a lie, so the type must come from the bytes.
 */
async function toUploadableImage(file: File): Promise<File> {
  if (file.type !== `image/webp`)
    return file

  const image = await createImageBitmap(file)
  const canvas = document.createElement(`canvas`)
  canvas.width = image.width
  canvas.height = image.height
  canvas.getContext(`2d`)?.drawImage(image, 0, 0)
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, `image/png`))
  if (!blob)
    throw new Error(t(`upload.picture.convertFailed`))

  return new File([blob], `${file.name.replace(/\.\w+$/, ``)}.png`, { type: `image/png` })
}

/**
 * Point every `{% picture %}` image at its 公众号 asset.
 *
 * The blog's `.wxmp-upload.json` — the same file `rake wxmp:upload` maintains — is read
 * first, so a picture a deploy already uploaded is only looked up, never uploaded twice.
 * Failures are collected and thrown rather than swallowed: a copy that silently kept the
 * raw tag, or a local URL readers cannot reach, is worse than a copy that never happened.
 */
export async function resolvePictureImages(container: ParentNode): Promise<PictureUploadSummary> {
  const images = [...container.querySelectorAll<HTMLImageElement>(PICTURE_SELECTOR)]
  if (images.length === 0 || !window.__MD_STUDIO__)
    return { uploaded: 0, reused: 0 }

  const { manifest } = await studioApi.wxmpManifest()
  const updates: Record<string, StudioWxmpRecord> = {}
  const failures: string[] = []
  let uploaded = 0
  let reused = 0

  // Uploads run in parallel: a picture-heavy post would otherwise queue up round trips.
  await Promise.all(images.map(async (image) => {
    const rel = image.getAttribute(`data-picture-path`) ?? ``
    try {
      const asset = await studioApi.assetInfo(rel)
      const known = reusableMaterialUrl(updates[asset.path] ?? manifest[asset.path], asset)
      if (known) {
        image.src = known
        reused += 1
      }
      else {
        const blob = await studioApi.assetBlob(asset.path)
        const file = await toUploadableImage(new File([blob], asset.path.split(`/`).pop() ?? `image`, { type: asset.mime }))
        const { url, mediaId } = await uploadMpMaterial(file)
        // Recorded against the file's own bytes: the tag resolves to those bytes every time,
        // so reuse keys off the file, not off what was sent after any conversion.
        updates[asset.path] = { mode: `material`, url, size: asset.size, sha256: asset.sha256, media_id: mediaId }
        image.src = url
        uploaded += 1
      }
      image.removeAttribute(`data-picture-path`)
    }
    catch (error) {
      const reason = error instanceof StudioHttpError && error.status === 404
        ? t(`upload.picture.notFound`)
        : error instanceof Error ? error.message : String(error)
      failures.push(`${rel}: ${reason}`)
    }
  }))

  if (Object.keys(updates).length > 0)
    await studioApi.saveWxmpManifest(updates)

  if (failures.length > 0) {
    // The toast is easy to miss and carries one line; the console keeps the whole list.
    console.warn(`[md] pictures that never became WeChat material`, failures)
    throw new Error(t(`upload.picture.failed`, { items: failures.join(`; `) }))
  }

  return { uploaded, reused }
}

/** The publish dialog hands over HTML rather than a DOM, so it resolves through a template. */
export async function resolvePictureHtml(html: string): Promise<string> {
  if (!html.includes(`data-picture-path`))
    return html

  const template = document.createElement(`template`)
  template.innerHTML = html
  await resolvePictureImages(template.content)
  return template.innerHTML
}
