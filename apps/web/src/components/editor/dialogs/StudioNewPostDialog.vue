<script setup lang="ts">
import { Loader2 } from '@lucide/vue'
import { useStudioStore } from '@/stores/studio'
import { useUIStore } from '@/stores/ui'

const { t } = useI18n()
const studioStore = useStudioStore()
const uiStore = useUIStore()

const { isShowStudioNewPostDialog } = storeToRefs(uiStore)

const isFragments = computed(() => uiStore.studioNewPostKind === `fragments`)

const title = ref(``)
const slug = ref(``)
const creating = ref(false)
/** Once the user edits the filename we stop deriving it from the title. */
const slugTouched = ref(false)

if (isFragments.value) {
  title.value = studioStore.nextFragments.title
  slug.value = studioStore.nextFragments.slug
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, `-`)
    .replace(/^-+|-+$/g, ``)
}

watch(title, (value) => {
  if (isFragments.value || slugTouched.value)
    return

  slug.value = slugify(value)
})

const isSlugValid = computed(() => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug.value) && slug.value.length <= 80)

const canSubmit = computed(() => !creating.value && title.value.trim().length > 0 && isSlugValid.value)

// The server stamps the Shanghai date, so mirror it here for an accurate preview.
const today = new Intl.DateTimeFormat(`en-CA`, {
  timeZone: `Asia/Shanghai`,
  year: `numeric`,
  month: `2-digit`,
  day: `2-digit`,
}).format(new Date())

const previewPath = computed(() => {
  if (isFragments.value)
    return `_posts/${studioStore.nextFragments.filename}`

  return `_posts/${today}-${slug.value}.markdown`
})

function closeDialog() {
  isShowStudioNewPostDialog.value = false
}

function onOpenChange(val: boolean) {
  if (!val) {
    closeDialog()
  }
}

async function handleCreate() {
  if (!canSubmit.value)
    return

  creating.value = true
  try {
    await studioStore.createPost(uiStore.studioNewPostKind, title.value.trim(), slug.value)
    closeDialog()
  }
  catch (error) {
    const status = (error as { status?: number } | null)?.status
    if (status === 409)
      toast.error(t(`studio.exists`))
    else
      toast.error(t(`studio.createFailed`, { message: error instanceof Error ? error.message : String(error) }))
  }
  finally {
    creating.value = false
  }
}
</script>

<template>
  <Dialog :open="isShowStudioNewPostDialog" @update:open="onOpenChange">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{{ t('studio.newPostDialogTitle') }}</DialogTitle>
      </DialogHeader>

      <div class="space-y-4">
        <div class="space-y-2">
          <Label for="studio-new-post-title">{{ t('studio.fieldTitle') }}</Label>
          <Input
            id="studio-new-post-title"
            v-model="title"
            :readonly="isFragments"
            :disabled="isFragments"
          />
        </div>

        <div class="space-y-2">
          <Label for="studio-new-post-slug">{{ t('studio.fieldSlug') }}</Label>
          <Input
            id="studio-new-post-slug"
            v-model="slug"
            :readonly="isFragments"
            :disabled="isFragments"
            @input="slugTouched = true"
          />
          <p v-if="!isSlugValid" class="text-xs text-destructive">
            {{ t('studio.slugInvalid') }}
          </p>
        </div>

        <p class="text-xs text-muted-foreground">
          {{ t('studio.fieldPathPreview', { path: previewPath }) }}
        </p>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="closeDialog()">
          {{ t('studio.cancel') }}
        </Button>
        <Button :disabled="!canSubmit" @click="handleCreate()">
          <Loader2 v-if="creating" class="h-3 w-3 mr-1 animate-spin" />
          {{ t('studio.create') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
