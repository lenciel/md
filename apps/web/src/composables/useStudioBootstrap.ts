import { installStudioCopyToMpBridge } from '@/lib/studio/copy-to-mp-bridge'
import { useStudioStore } from '@/stores/studio'

/**
 * Studio mode bootstrap: wires the extension push bridge and loads the local
 * workspace state. No-op in every non-studio build.
 */
export function useStudioBootstrap(): void {
  if (!window.__MD_STUDIO__)
    return

  installStudioCopyToMpBridge()
  void useStudioStore().init()
}
