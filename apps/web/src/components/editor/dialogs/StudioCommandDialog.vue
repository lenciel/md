<script setup lang="ts">
import { ExternalLink, Loader2, Square } from '@lucide/vue'
import { useStudioStore } from '@/stores/studio'
import { useUIStore } from '@/stores/ui'

const { t } = useI18n()
const studioStore = useStudioStore()
const uiStore = useUIStore()

const { isShowStudioCommandDialog } = storeToRefs(uiStore)

const logRef = ref<HTMLElement | null>(null)

/** The store clears `runningCommandId` on exit, so keep the label for the log view. */
const lastCommandId = ref(studioStore.runningCommandId)

watch(() => studioStore.runningCommandId, (id) => {
  if (id)
    lastCommandId.value = id
})

const activeCommand = computed(() =>
  studioStore.commands.find(command => command.id === lastCommandId.value) ?? null,
)

const isRunning = computed(() => studioStore.commandStatus === `running`)

// Only service commands keep a process around worth interrupting; start/upload
// runs are expected to finish on their own.
const showStop = computed(() => isRunning.value && activeCommand.value?.mode === `service`)

const lastExit = computed(() => {
  for (let i = studioStore.commandEvents.length - 1; i >= 0; i--) {
    const event = studioStore.commandEvents[i]
    if (event?.type === `exit`)
      return event
  }
  return null
})

function exitLabel(code?: number | null) {
  if (code === 0)
    return t(`studio.commandDone`)

  return t(`studio.commandFailed`, { code: code ?? `?` })
}

const statusLabel = computed(() => {
  if (isRunning.value)
    return ``
  if (lastExit.value)
    return exitLabel(lastExit.value.code)
  if (studioStore.commandStatus === `stopped`)
    return t(`studio.stopCommand`)

  return ``
})

function scrollToBottom() {
  void nextTick(() => {
    const el = logRef.value
    if (el)
      el.scrollTop = el.scrollHeight
  })
}

watch(() => studioStore.commandEvents.length, scrollToBottom)

onMounted(scrollToBottom)

function closeDialog() {
  // Closing only detaches the view; the server keeps streaming into the store.
  isShowStudioCommandDialog.value = false
}

function onOpenChange(val: boolean) {
  if (!val)
    closeDialog()
}

function openPreview(url?: string) {
  if (!url)
    return

  window.open(url, `_blank`, `noopener`)
}
</script>

<template>
  <Dialog :open="isShowStudioCommandDialog" @update:open="onOpenChange">
    <DialogContent class="sm:max-w-3xl max-h-[85vh] flex flex-col p-0">
      <DialogHeader class="px-6 pt-6 pb-3 border-b">
        <DialogTitle class="flex items-center gap-2">
          <Loader2 v-if="isRunning" class="h-4 w-4 animate-spin" />
          {{ activeCommand?.label ?? t('studio.commands') }}
        </DialogTitle>
      </DialogHeader>

      <pre
        ref="logRef"
        class="flex-1 min-h-64 max-h-[60vh] overflow-auto bg-muted/30 p-4 font-mono text-xs whitespace-pre-wrap break-all"
      >
        <template v-for="event in studioStore.commandEvents" :key="event.index">
          <div v-if="event.type === 'stdout'" class="text-foreground">{{ event.text }}</div>
          <div v-else-if="event.type === 'stderr'" class="text-destructive">{{ event.text }}</div>
          <div v-else-if="event.type === 'error'" class="text-destructive">{{ event.message }}</div>
          <div v-else-if="event.type === 'changed'" class="text-primary">
            {{ t('studio.changedReloaded', { count: event.paths?.length ?? 0 }) }}
          </div>
          <div
            v-else-if="event.type === 'exit'"
            class="font-semibold"
            :class="event.code === 0 ? 'text-primary' : 'text-destructive'"
          >
            {{ exitLabel(event.code) }}
          </div>
        </template>
      </pre>

      <DialogFooter class="px-6 py-4 border-t bg-background">
        <div class="flex flex-1 items-center gap-2 text-xs text-muted-foreground">
          <Loader2 v-if="isRunning" class="h-3 w-3 animate-spin" />
          <span>{{ statusLabel }}</span>
        </div>
        <Button
          v-if="activeCommand?.url"
          variant="outline"
          @click="openPreview(activeCommand?.url)"
        >
          <ExternalLink class="h-3 w-3 mr-1" />
          {{ t('studio.openPreview') }}
        </Button>
        <Button v-if="showStop" variant="outline" @click="studioStore.stopCommand()">
          <Square class="h-3 w-3 mr-1" />
          {{ t('studio.stopCommand') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
