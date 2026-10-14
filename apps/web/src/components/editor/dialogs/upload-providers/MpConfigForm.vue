<script setup lang="ts">
import { z } from 'zod'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { optionalString, requiredString, toTypedSchema } from '@/lib/form-schema'
import UploadProviderForm from './UploadProviderForm.vue'
import UploadProviderTextField from './UploadProviderTextField.vue'
import { useUploadProviderConfig } from './useUploadProviderConfig'

const { t } = useI18n()
const isWebsite = window.location.protocol.startsWith(`http`)
const isCfWorkers = import.meta.env.CF_WORKERS === `1`
/** The field is optional everywhere (the studio and the CF build proxy /cgi-bin on their own
 *  origin), so nothing is validated — the hint under it explains the one deployment where it
 *  is genuinely needed: a plain web page, which has no same-origin proxy and no CORS to call
 *  WeChat with. */
const schema = toTypedSchema(z.object({
  proxyOrigin: optionalString(),
  appID: requiredString(t(`upload.validation.appIdRequired`)),
  appsecret: requiredString(t(`upload.validation.appSecretRequired`)),
}))
const { config, saveConfig } = useUploadProviderConfig(`mpConfig`, {
  proxyOrigin: ``,
  appID: ``,
  appsecret: ``,
  replaceDraft: true,
})
const ownProxyNeeded = isWebsite && !isCfWorkers && !window.__MD_STUDIO__
</script>

<template>
  <UploadProviderForm :validation-schema="schema" :initial-values="config" @submit="saveConfig">
    <UploadProviderTextField
      name="proxyOrigin"
      :label="t('upload.labels.proxyDomain')"
      :placeholder="t('upload.placeholders.proxyExample')"
      :hint="ownProxyNeeded ? t('upload.help.proxyHint') : ''"
    />
    <UploadProviderTextField name="appID" label="appID" :placeholder="t('upload.placeholders.appId')" required />
    <UploadProviderTextField name="appsecret" label="appsecret" :placeholder="t('upload.placeholders.appSecret')" required />

    <div class="flex items-center justify-between gap-3">
      <div class="flex min-w-0 flex-col">
        <Label for="mp-replace-draft" class="text-sm leading-snug">{{ t('upload.labels.replaceDraft') }}</Label>
        <p class="text-xs text-muted-foreground leading-snug">
          {{ t('upload.help.replaceDraftHint') }}
        </p>
      </div>
      <Switch
        id="mp-replace-draft"
        class="shrink-0"
        :model-value="config.replaceDraft !== false"
        @update:model-value="config.replaceDraft = $event"
      />
    </div>

    <FormItem>
      <div class="flex flex-col items-start">
        <Button variant="link" class="p-0 h-auto text-left whitespace-normal" as="a" href="https://developers.weixin.qq.com/doc/offiaccount/Getting_Started/Getting_Started_Guide.html" target="_blank" rel="noopener noreferrer">
          {{ t('upload.help.mpDevMode') }}
        </Button>
        <Button variant="link" class="p-0 h-auto text-left whitespace-normal" as="a" href="https://md-pages.doocs.org/tutorial/" target="_blank" rel="noopener noreferrer">
          {{ t('upload.help.mpExtension') }}
        </Button>
      </div>
    </FormItem>
  </UploadProviderForm>
</template>
