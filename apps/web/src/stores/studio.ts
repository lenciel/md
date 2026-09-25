import type {
  StudioCommand,
  StudioCommandEvent,
  StudioNextFragments,
  StudioPostListItem,
} from '@/services/studio/client'
import { t } from '@/i18n/translate'
import { debounce } from '@/lib/debounce'
import { toast } from '@/lib/toast'
import { studioApi, StudioHttpError } from '@/services/studio/client'
import { store } from '@/storage'
import { addPrefix } from '@/storage/prefix'
import { useEditorStore } from '@/stores/editor'
import { usePostStore } from '@/stores/post'
import { useUIStore } from '@/stores/ui'

export type StudioSaveState = `idle` | `saving` | `saved` | `error`

export type StudioCommandStatus = `idle` | `running` | `done` | `failed` | `stopped`

/**
 * Payload of a 409 `stale` response. `diskContent` is what the panel offers via
 * "load disk version"; `mtimeMs` is the stamp needed to save again afterwards.
 */
export interface StudioConflict {
  path: string
  diskContent: string
  mtimeMs: number
}

const AUTOSAVE_DEBOUNCE_MS = 800

/** Mirrors the server replay buffer cap so a reattached stream cannot grow unbounded. */
const MAX_COMMAND_EVENTS = 5000

function getErrorMessage(error: unknown): string {
  if (error instanceof StudioHttpError)
    return error.message
  return error instanceof Error ? error.message : String(error)
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === `AbortError`
}

/**
 * Local blog workspace (studio): file list, editor-buffer <-> file mapping,
 * autosave with conflict detection, and streaming command execution.
 *
 * Active only when the page was served with `window.__MD_STUDIO__`.
 */
export const useStudioStore = defineStore(`studio`, () => {
  const postStore = usePostStore()

  const isActive = ref(false)
  const root = ref(``)
  const distOk = ref(false)
  const commands = ref<StudioCommand[]>([])
  const posts = ref<StudioPostListItem[]>([])
  const nextFragments = ref<StudioNextFragments>({ num: ``, title: ``, slug: ``, filename: `` })
  const isLoading = ref(false)
  const loadError = ref(``)

  /** The open file survives reloads; the buffer itself is reloaded on demand. */
  const activePath = store.reactive(addPrefix(`studio_active_path`), ``)
  const activeBaseMtimeMs = ref<number | null>(null)
  const saveState = ref<StudioSaveState>(`idle`)
  const conflict = ref<StudioConflict | null>(null)

  const runningCommandId = ref<string | null>(null)
  const commandEvents = ref<StudioCommandEvent[]>([])
  const commandStatus = ref<StudioCommandStatus>(`idle`)

  const activePostTitle = computed(() => {
    const item = posts.value.find(post => post.path === activePath.value)
    return item?.title ?? ``
  })

  const activeStatusLabel = computed(() => {
    switch (saveState.value) {
      case `saving`:
        return t('studio.saveSaving')
      case `saved`:
        return t('studio.saveSaved')
      case `error`:
        return t('studio.saveFailed')
      default:
        return ``
    }
  })

  /**
   * Last content known to be identical on disk. Skipping the write when nothing
   * changed keeps opening a file (and reloading it after a deploy) from bumping
   * the mtime of files the user never edited.
   */
  let syncedContent: { path: string, content: string } | null = null

  let savePromise: Promise<void> | null = null
  let saveQueued = false

  const autosave = debounce(() => {
    void saveActive()
  }, AUTOSAVE_DEBOUNCE_MS)

  // Re-triggered by editor commits: `EditorPanel` syncs content into the post
  // store, so this watcher sees every keystroke batch. Kept in the store (not in
  // the panel) so edits keep reaching disk while the panel is closed.
  watch(
    () => postStore.currentPost?.content,
    () => {
      autosave()
    },
  )

  let commandAbort: AbortController | null = null
  let stopRequested = false
  let changedPaths: string[] = []

  async function refreshPosts(): Promise<void> {
    try {
      const response = await studioApi.posts()
      posts.value = response.posts
      nextFragments.value = response.nextFragments
    }
    catch (error) {
      loadError.value = getErrorMessage(error)
    }
  }

  /** Forget the active file after it vanished from the workspace or failed to read. */
  function resetActiveFile(): void {
    activePath.value = ``
    activeBaseMtimeMs.value = null
    syncedContent = null
    saveState.value = `idle`
  }

  async function init(): Promise<void> {
    if (!window.__MD_STUDIO__) {
      isActive.value = false
      return
    }

    isActive.value = true
    isLoading.value = true
    loadError.value = ``

    try {
      const [state, postsResponse] = await Promise.all([studioApi.state(), studioApi.posts()])
      root.value = state.root
      distOk.value = state.distOk
      commands.value = state.commands
      posts.value = postsResponse.posts
      nextFragments.value = postsResponse.nextFragments

      // The persisted path is only a pointer. Without re-reading it, the buffer
      // restored from IndexedDB would be flushed back over disk content that
      // changed while the page was closed, because `activeBaseMtimeMs` is gone.
      const persistedPath = activePath.value
      if (persistedPath && posts.value.some(post => post.path === persistedPath)) {
        try {
          await openPost(persistedPath)
        }
        catch {
          resetActiveFile()
        }
      }
      else if (persistedPath) {
        resetActiveFile()
      }
    }
    catch (error) {
      loadError.value = getErrorMessage(error)
    }
    finally {
      isLoading.value = false
    }
  }

  /**
   * Point the editor at a workspace file, reusing the existing buffer when this
   * file was opened before (matched by the persisted `sourcePath`).
   */
  async function openPost(path: string): Promise<void> {
    if (!isActive.value)
      return

    if (activePath.value && activePath.value !== path)
      await flushActive()

    const file = await studioApi.readFile(path)
    const known = postStore.posts.find(post => post.sourcePath === path)

    if (known) {
      postStore.currentPostId = known.id
    }
    else {
      postStore.addPost(posts.value.find(post => post.path === path)?.title ?? path)
    }

    const id = postStore.currentPostId
    postStore.updatePostContent(id, file.content)
    const post = postStore.getPostById(id)
    if (post)
      post.sourcePath = path

    autosave.cancel()
    activePath.value = path
    activeBaseMtimeMs.value = file.mtimeMs
    syncedContent = { path, content: file.content }
    conflict.value = null
    saveState.value = `saved`
  }

  async function performSave(): Promise<void> {
    const path = activePath.value
    if (!path)
      return

    const post = postStore.posts.find(item => item.sourcePath === path)
    if (!post)
      return

    const content = post.content
    if (syncedContent && syncedContent.path === path && syncedContent.content === content) {
      saveState.value = `saved`
      return
    }

    saveState.value = `saving`
    try {
      const response = await studioApi.writeFile({
        path,
        content,
        baseMtimeMs: activeBaseMtimeMs.value,
      })
      activeBaseMtimeMs.value = response.mtimeMs
      syncedContent = { path, content }
      saveState.value = `saved`
    }
    catch (error) {
      if (error instanceof StudioHttpError && error.status === 409 && error.payload.error === `stale`) {
        // The file changed outside studio: never overwrite, let the user choose.
        conflict.value = {
          path,
          diskContent: String(error.payload.content ?? ``),
          mtimeMs: Number(error.payload.mtimeMs ?? 0),
        }
        saveState.value = `error`
        return
      }
      saveState.value = `error`
    }
  }

  /**
   * Autosave entry point. Serialized: a request that arrives while one is in
   * flight marks the pending run, and the in-flight promise only settles after
   * that run, so `flushActive()` really does wait for the latest content.
   */
  function saveActive(): Promise<void> {
    if (!isActive.value || !activePath.value || conflict.value)
      return Promise.resolve()

    if (savePromise) {
      saveQueued = true
      return savePromise
    }

    savePromise = (async () => {
      try {
        await performSave()
        while (saveQueued) {
          saveQueued = false
          await performSave()
        }
      }
      finally {
        savePromise = null
      }
    })()

    return savePromise
  }

  /** Commit pending editor text, then write the active file and wait for it. */
  async function flushActive(): Promise<void> {
    if (!isActive.value || !activePath.value)
      return

    useEditorStore().flushContentToPostStore()
    autosave.cancel()
    await saveActive()
  }

  /**
   * Best-effort final write for `pagehide` / hidden tab, where a normal fetch
   * would be cut off. `sendBeacon` cannot carry the `X-MD-Studio` header.
   */
  function flushActiveOnHide(): void {
    if (!isActive.value || !activePath.value || conflict.value)
      return

    useEditorStore().flushContentToPostStore()
    autosave.cancel()

    const path = activePath.value
    const post = postStore.posts.find(item => item.sourcePath === path)
    if (!post)
      return
    if (syncedContent && syncedContent.path === path && syncedContent.content === post.content)
      return

    void studioApi.writeFile({
      path,
      content: post.content,
      baseMtimeMs: activeBaseMtimeMs.value,
      keepalive: true,
    }).catch(() => {
      // The tab is going away; a failed final write cannot be retried.
    })
  }

  const onVisibilityChange = () => {
    if (document.visibilityState === `hidden`)
      flushActiveOnHide()
  }

  // Registered at store creation (not in onMounted): the store is an
  // app-lifetime singleton, so the listeners must not depend on a component
  // that may unmount while studio mode stays active.
  window.addEventListener(`pagehide`, flushActiveOnHide)
  document.addEventListener(`visibilitychange`, onVisibilityChange)

  async function resolveConflict(action: `keep-mine` | `use-disk`): Promise<void> {
    const pending = conflict.value
    if (!pending)
      return

    const post = postStore.posts.find(item => item.sourcePath === pending.path)

    if (action === `use-disk`) {
      autosave.cancel()
      if (post) {
        postStore.updatePostContent(post.id, pending.diskContent)
        syncedContent = { path: pending.path, content: pending.diskContent }
      }
      activeBaseMtimeMs.value = pending.mtimeMs
      conflict.value = null
      saveState.value = `saved`
      return
    }

    if (!post)
      return

    // The editor may still hold text that has not reached the post store yet.
    useEditorStore().flushContentToPostStore()
    saveState.value = `saving`
    try {
      const response = await studioApi.writeFile({
        path: pending.path,
        content: post.content,
        // Explicit null: the user chose to overwrite whatever is on disk.
        baseMtimeMs: null,
      })
      activeBaseMtimeMs.value = response.mtimeMs
      syncedContent = { path: pending.path, content: post.content }
      conflict.value = null
      saveState.value = `saved`
    }
    catch (error) {
      saveState.value = `error`
      if (error instanceof StudioHttpError && error.status === 409 && error.payload.error === `stale`) {
        // Changed again while the user was deciding; refresh the offered disk copy.
        conflict.value = {
          path: pending.path,
          diskContent: String(error.payload.content ?? ``),
          mtimeMs: Number(error.payload.mtimeMs ?? 0),
        }
      }
    }
  }

  async function createPost(kind: `post` | `fragments`, title: string, slug: string): Promise<void> {
    const created = await studioApi.createPost({ kind, title, slug })
    await refreshPosts()
    await openPost(created.path)
  }

  /**
   * After a command rewrote files on disk (`blank_target` in `rake prepare_deploy`),
   * refresh the list and pull the active file back from disk.
   */
  async function handleChangedPaths(paths: string[]): Promise<void> {
    await refreshPosts()

    const path = activePath.value
    if (!path || !paths.includes(path))
      return

    const post = postStore.posts.find(item => item.sourcePath === path)
    if (!post)
      return

    try {
      const file = await studioApi.readFile(path)
      autosave.cancel()
      postStore.updatePostContent(post.id, file.content)
      syncedContent = { path, content: file.content }
      activeBaseMtimeMs.value = file.mtimeMs
      conflict.value = null
      saveState.value = `saved`
      toast.success(t('studio.changedReloaded', { count: paths.length }))
    }
    catch {
      saveState.value = `error`
    }
  }

  function handleCommandEvent(event: StudioCommandEvent): void {
    commandEvents.value.push(event)
    if (commandEvents.value.length > MAX_COMMAND_EVENTS)
      commandEvents.value.splice(0, commandEvents.value.length - MAX_COMMAND_EVENTS)

    if (event.type === `changed`) {
      changedPaths = event.paths ?? []
      return
    }

    if (event.type === `error`) {
      commandStatus.value = `failed`
      return
    }

    if (event.type === `exit`) {
      const code = event.code ?? null
      commandStatus.value = stopRequested || code === null
        ? `stopped`
        : code === 0 ? `done` : `failed`
      runningCommandId.value = null

      const paths = changedPaths
      changedPaths = []
      if (paths.length > 0)
        void handleChangedPaths(paths)
    }
  }

  /** Start a command (or re-attach to a running one: the server replays its buffer). */
  async function runCommand(commandId: string): Promise<void> {
    if (!isActive.value)
      return

    commandAbort?.abort()
    const controller = new AbortController()
    commandAbort = controller
    stopRequested = false
    changedPaths = []
    commandEvents.value = []
    runningCommandId.value = commandId
    commandStatus.value = `running`
    useUIStore().toggleShowStudioCommandDialog(true)

    try {
      await studioApi.execStream(commandId, {
        from: 0,
        signal: controller.signal,
        onEvent: handleCommandEvent,
      })
      if (commandStatus.value === `running` && runningCommandId.value === commandId) {
        // Stream closed without an exit frame (server restarted, connection dropped).
        commandStatus.value = `failed`
        runningCommandId.value = null
      }
    }
    catch (error) {
      if (!isAbortError(error) && runningCommandId.value === commandId) {
        commandStatus.value = `failed`
        runningCommandId.value = null
      }
    }
  }

  async function stopCommand(): Promise<void> {
    const commandId = runningCommandId.value
    if (!commandId)
      return

    stopRequested = true
    try {
      await studioApi.stop(commandId)
    }
    catch {
      // Stopping is idempotent server side; the exit frame still arrives.
    }

    // The process dies asynchronously; drop the spinner now and keep the stream
    // open so trailing log frames are not lost.
    commandStatus.value = `stopped`
    runningCommandId.value = null
  }

  return {
    isActive,
    root,
    distOk,
    commands,
    posts,
    nextFragments,
    isLoading,
    loadError,
    activePath,
    activeBaseMtimeMs,
    saveState,
    conflict,
    runningCommandId,
    commandEvents,
    commandStatus,
    activePostTitle,
    activeStatusLabel,
    init,
    refreshPosts,
    openPost,
    saveActive,
    flushActive,
    resolveConflict,
    createPost,
    runCommand,
    stopCommand,
  }
})
