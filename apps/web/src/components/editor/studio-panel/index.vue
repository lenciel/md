<script setup lang="ts">
import {
  AlertCircle,
  ExternalLink,
  FilePlus2,
  FolderKanban,
  Loader2,
  Play,
  RefreshCw,
  Search,
  Square,
  X,
} from '@lucide/vue'
import { useStudioStore } from '@/stores/studio'
import { useUIStore } from '@/stores/ui'

const { t } = useI18n()
const studioStore = useStudioStore()
const uiStore = useUIStore()

const { isMobile, isOpenStudioPanel } = storeToRefs(uiStore)

const enableAnimation = ref(false)

watch(isOpenStudioPanel, () => {
  if (isMobile.value) {
    enableAnimation.value = true
  }
})

watch(isMobile, () => {
  enableAnimation.value = false
})

const searchQuery = ref(``)

const filteredPosts = computed(() => {
  const keyword = searchQuery.value.trim().toLowerCase()
  if (!keyword)
    return studioStore.posts

  return studioStore.posts.filter(post =>
    post.title.toLowerCase().includes(keyword) || post.name.toLowerCase().includes(keyword),
  )
})

const activeFileName = computed(() => studioStore.activePath?.split(`/`).pop() ?? ``)

const saveStateLabel = computed(() => {
  switch (studioStore.saveState) {
    case `saving`:
      return t(`studio.saveSaving`)
    case `saved`:
      return t(`studio.saveSaved`)
    case `error`:
      return t(`studio.saveFailed`)
    default:
      return ``
  }
})

function isCommandRunning(commandId: string) {
  return studioStore.commandStatus === `running` && studioStore.runningCommandId === commandId
}

async function handleRefresh() {
  await studioStore.init()
  await studioStore.refreshPosts()
}

async function handleOpenPost(path: string) {
  try {
    await studioStore.openPost(path)
  }
  catch (error) {
    toast.error(t(`studio.openFailed`, { message: error instanceof Error ? error.message : String(error) }))
  }
}

function handleRunCommand(commandId: string) {
  // runCommand also opens the command dialog so the log is visible immediately.
  void studioStore.runCommand(commandId)
}

function openPreview(url?: string) {
  if (!url)
    return

  window.open(url, `_blank`, `noopener`)
}
</script>

<template>
  <Transition name="fade">
    <div
      v-if="isMobile && isOpenStudioPanel"
      class="fixed inset-0 bg-black/40 backdrop-blur-sm z-40"
      @click="isOpenStudioPanel = false"
    />
  </Transition>

  <div
    class="studio-panel h-full flex flex-col"
    :class="{
      'fixed top-0 left-0 z-55 w-full bg-background border-r border-border shadow-xl': isMobile,
      'animate-slider': isMobile && enableAnimation,
    }"
    :style="isMobile ? { transform: isOpenStudioPanel ? 'translateX(0)' : 'translateX(-100%)' } : undefined"
  >
    <div class="panel-header sticky top-0 z-10 bg-background border-b p-2">
      <div class="flex items-center justify-between mb-2">
        <h3 class="text-sm font-semibold flex items-center gap-2">
          <FolderKanban class="h-4 w-4" />
          {{ t('studio.title') }}
        </h3>
        <div class="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            class="h-7 w-7 p-0"
            :title="t('studio.refresh')"
            :aria-label="t('studio.refresh')"
            :aria-busy="studioStore.isLoading"
            @click="handleRefresh"
          >
            <RefreshCw class="h-3 w-3" :class="{ 'animate-spin': studioStore.isLoading }" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            class="h-7 w-7 p-0"
            :title="t('common.close')"
            :aria-label="t('common.close')"
            @click="isOpenStudioPanel = false"
          >
            <X class="h-3 w-3" />
          </Button>
        </div>
      </div>

      <div
        v-if="studioStore.root"
        class="text-xs text-muted-foreground truncate"
        :title="studioStore.root"
      >
        {{ studioStore.root }}
      </div>
    </div>

    <div class="panel-content flex-1 flex flex-col min-h-0">
      <div
        v-if="!studioStore.isActive"
        class="flex flex-col items-center justify-center h-full text-center p-4 text-muted-foreground"
      >
        <FolderKanban class="h-12 w-12 mb-2 opacity-50" />
        <p class="text-sm">
          {{ t('studio.notActive') }}
        </p>
      </div>

      <template v-else>
        <div class="p-2 space-y-2 border-b">
          <div class="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              class="flex-1 text-xs"
              @click="uiStore.openStudioNewPostDialog('post')"
            >
              <FilePlus2 class="h-3 w-3 mr-1" />
              {{ t('studio.newPost') }}
            </Button>
            <Button
              variant="outline"
              size="sm"
              class="flex-1 text-xs"
              @click="uiStore.openStudioNewPostDialog('fragments')"
            >
              <FilePlus2 class="h-3 w-3 mr-1" />
              {{ t('studio.newFragments') }}
            </Button>
          </div>

          <div class="relative">
            <Search class="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
            <Input
              v-model="searchQuery"
              class="h-8 pl-7 text-xs"
              :placeholder="t('studio.searchPlaceholder')"
            />
          </div>

          <Alert v-if="studioStore.conflict" variant="destructive">
            <AlertCircle class="h-4 w-4" />
            <AlertTitle>{{ t('studio.conflictTitle') }}</AlertTitle>
            <AlertDescription class="mt-2 flex flex-wrap gap-1">
              <Button size="xs" variant="outline" @click="studioStore.resolveConflict('keep-mine')">
                {{ t('studio.conflictKeepMine') }}
              </Button>
              <Button size="xs" variant="outline" @click="studioStore.resolveConflict('use-disk')">
                {{ t('studio.conflictUseDisk') }}
              </Button>
            </AlertDescription>
          </Alert>

          <div
            v-if="studioStore.activePath"
            class="flex items-center justify-between gap-2 text-xs text-muted-foreground"
          >
            <span class="truncate" :title="studioStore.activePath">{{ activeFileName }}</span>
            <span
              class="shrink-0"
              :class="{ 'text-destructive': studioStore.saveState === 'error' }"
            >
              {{ saveStateLabel }}
            </span>
          </div>
        </div>

        <div class="flex-1 min-h-0 overflow-y-auto p-2">
          <div
            v-if="studioStore.isLoading && studioStore.posts.length === 0"
            class="flex flex-col items-center justify-center h-full"
          >
            <Loader2 class="h-8 w-8 animate-spin text-primary" />
            <p class="text-sm text-muted-foreground mt-2">
              {{ t('common.loading') }}
            </p>
          </div>

          <div
            v-else-if="studioStore.loadError"
            class="flex flex-col items-center justify-center h-full text-center p-4 text-destructive"
          >
            <p class="text-sm">
              {{ studioStore.loadError }}
            </p>
          </div>

          <div
            v-else-if="filteredPosts.length === 0"
            class="flex flex-col items-center justify-center h-full text-center p-4 text-muted-foreground"
          >
            <FolderKanban class="h-12 w-12 mb-2 opacity-50" />
            <p class="text-sm">
              {{ t('studio.empty') }}
            </p>
          </div>

          <ul v-else class="space-y-0.5">
            <li v-for="post in filteredPosts" :key="post.path">
              <button
                type="button"
                class="w-full text-left rounded px-2 py-1 transition-colors"
                :class="post.path === studioStore.activePath ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'"
                :title="post.name"
                @click="handleOpenPost(post.path)"
              >
                <span class="block text-xs truncate">
                  {{ post.title }}
                </span>
                <span class="block text-[10px] text-muted-foreground truncate">
                  {{ post.date }} · {{ post.name }}
                </span>
              </button>
            </li>
          </ul>
        </div>

        <div class="border-t p-2 space-y-1">
          <div class="text-xs text-muted-foreground">
            {{ t('studio.commands') }}
          </div>
          <div
            v-for="command in studioStore.commands"
            :key="command.id"
            class="flex gap-1"
          >
            <Button
              v-if="command.mode === 'service' && isCommandRunning(command.id)"
              variant="outline"
              size="sm"
              class="flex-1 text-xs justify-start"
              :title="t('studio.stopCommand')"
              @click="studioStore.stopCommand()"
            >
              <Square class="h-3 w-3 mr-1" />
              {{ t('studio.stopCommand') }}
            </Button>
            <Button
              v-else
              variant="outline"
              size="sm"
              class="flex-1 text-xs justify-start"
              :title="t('studio.runCommand')"
              @click="handleRunCommand(command.id)"
            >
              <Play class="h-3 w-3 mr-1 shrink-0" />
              <span class="truncate">{{ command.label }}</span>
            </Button>
            <Button
              v-if="command.url"
              variant="outline"
              size="sm"
              class="shrink-0"
              :title="t('studio.openPreview')"
              :aria-label="t('studio.openPreview')"
              @click="openPreview(command.url)"
            >
              <ExternalLink class="h-3 w-3" />
            </Button>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.studio-panel {
  background-color: hsl(var(--background));
}

.panel-header {
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

.panel-content {
  min-height: 0;
}

.animate-slider {
  transition: transform 300ms cubic-bezier(0.16, 1, 0.3, 1);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 200ms ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
