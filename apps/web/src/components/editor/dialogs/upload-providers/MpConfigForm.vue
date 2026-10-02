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
// The studio reverse-proxies /cgi-bin on its own origin, so no proxy domain is needed locally.
const isProxyRequired = computed(() => isWebsite && !isCfWorkers && !window.__MD_STUDIO__)
const schema = computed(() => toTypedSchema(z.object({
  proxyOrigin: isProxyRequired.value
    ? requiredString(t(`upload.validation.proxyRequired`))
    : optionalString(),
  appID: requiredString(t(`upload.validation.appIdRequired`)),
  appsecret: requiredString(t(`upload.validation.appSecretRequired`)),
})))
const { config, saveConfig } = useUploadProviderConfig(`mpConfig`, {
  proxyOrigin: ``,
  appID: ``,
  appsecret: ``,
  replaceDraft: true,
})
// A proxy saved earlier keeps its field (and stays clearable) even where it is no longer required.
const showProxyField = computed(() => isProxyRequired.value || Boolean(config.value.proxyOrigin))
</script>

<template>
  <UploadProviderForm :validation-schema="schema" :initial-values="config" @submit="saveConfig">
    <UploadProviderTextField
      v-if="showProxyField"
      name="proxyOrigin"
      :label="t('upload.labels.proxyDomain')"
      :placeholder="t('upload.placeholders.proxyExample')"
      :required="isProxyRequired"
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
