/**
 * HTTP client for the local blog workspace service (`apps/studio`).
 *
 * Every request carries `X-MD-Studio: 1`, which forces a CORS preflight on
 * cross-origin pages and therefore keeps arbitrary websites from writing to the
 * local blog checkout (the server also rejects non-local `Origin` headers).
 */
function buildHeaders(json: boolean): Record<string, string> {
  const headers: Record<string, string> = { 'X-MD-Studio': `1` }
  if (json)
    headers['Content-Type'] = `application/json`
  return headers
}

/** Non-2xx studio response; `payload` keeps the parsed error body (a 409 carries `stale` + disk content). */
export class StudioHttpError extends Error {
  status: number
  payload: Record<string, unknown>

  constructor(status: number, payload: Record<string, unknown>) {
    super(typeof payload.error === `string` ? payload.error : `studio-request-failed`)
    this.name = `StudioHttpError`
    this.status = status
    this.payload = payload
  }
}

export interface StudioPostListItem {
  path: string
  name: string
  slug: string
  ext: `.md` | `.markdown`
  title: string
  date: string
  mtimeMs: number
  size: number
}

export interface StudioNextFragments {
  num: string
  title: string
  slug: string
  filename: string
}

export interface StudioCommand {
  id: string
  label: string
  mode: `run` | `service`
  url?: string
}

export interface StudioState {
  root: string
  postsDir: string
  distOk: boolean
  running: { commandId: string, startedAt: number }[]
  commands: StudioCommand[]
}

export interface StudioPostsResponse {
  posts: StudioPostListItem[]
  nextFragments: StudioNextFragments
}

export interface StudioFileResponse {
  path: string
  content: string
  mtimeMs: number
}

export interface StudioWriteResponse {
  ok: true
  mtimeMs: number
}

export interface StudioCreateResponse {
  path: string
  name: string
  content: string
  mtimeMs: number
}

export type StudioCommandEventType = `stdout` | `stderr` | `error` | `changed` | `exit`

export interface StudioCommandEvent {
  index: number
  type: StudioCommandEventType
  text?: string
  message?: string
  code?: number | null
  durationMs?: number
  paths?: string[]
}

export interface StudioWriteInput {
  path: string
  content: string
  /** `null` skips the staleness check (used to overwrite a conflicting disk version). */
  baseMtimeMs?: number | null
  /** Send the write with `keepalive: true` so it survives pagehide/visibility loss. */
  keepalive?: boolean
}

export interface StudioExecOptions {
  from?: number
  signal?: AbortSignal
  onEvent: (event: StudioCommandEvent) => void
}

async function toHttpError(response: Response): Promise<StudioHttpError> {
  let payload: Record<string, unknown> = {}
  try {
    const parsed: unknown = await response.json()
    if (parsed && typeof parsed === `object`)
      payload = parsed as Record<string, unknown>
  }
  catch {
    // Non-JSON error body (proxy failure, HTML 500) — the status still identifies it.
  }
  return new StudioHttpError(response.status, payload)
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${window.__MD_STUDIO__?.apiBase ?? `/api`}${path}`, init)
  if (!response.ok)
    throw await toHttpError(response)
  return await response.json() as T
}

function parseFrame(frame: string): StudioCommandEvent | null {
  const data = frame
    .split(`\n`)
    .filter(line => line.startsWith(`data:`))
    .map(line => line.slice(5).trim())
    .join(`\n`)
  if (!data)
    return null

  try {
    return JSON.parse(data) as StudioCommandEvent
  }
  catch {
    return null
  }
}

/** `POST /api/studio/exec` SSE stream; resolves when the server closes the stream. */
async function execStream(commandId: string, options: StudioExecOptions): Promise<void> {
  const response = await fetch(`${window.__MD_STUDIO__?.apiBase ?? `/api`}/studio/exec`, {
    method: `POST`,
    headers: buildHeaders(true),
    body: JSON.stringify({ commandId, from: options.from ?? 0 }),
    signal: options.signal,
  })
  if (!response.ok)
    throw await toHttpError(response)

  const body = response.body
  if (!body)
    throw new StudioHttpError(response.status, { error: `no-stream` })

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ``

  for (;;) {
    const { done, value } = await reader.read()
    if (done)
      break
    buffer += decoder.decode(value, { stream: true })

    // Frames are separated by a blank line; a chunk may split a frame in half.
    let boundary = buffer.indexOf(`\n\n`)
    while (boundary !== -1) {
      const event = parseFrame(buffer.slice(0, boundary))
      buffer = buffer.slice(boundary + 2)
      if (event)
        options.onEvent(event)
      boundary = buffer.indexOf(`\n\n`)
    }
  }

  const tail = parseFrame(buffer)
  if (tail)
    options.onEvent(tail)
}

export const studioApi = {
  state: () => request<StudioState>(`/studio/state`, { headers: buildHeaders(false) }),

  posts: () => request<StudioPostsResponse>(`/studio/posts`, { headers: buildHeaders(false) }),

  readFile: (path: string) => request<StudioFileResponse>(
    `/studio/file?path=${encodeURIComponent(path)}`,
    { headers: buildHeaders(false) },
  ),

  writeFile: (input: StudioWriteInput) => request<StudioWriteResponse>(`/studio/file`, {
    method: `PUT`,
    headers: buildHeaders(true),
    body: JSON.stringify({
      path: input.path,
      content: input.content,
      baseMtimeMs: input.baseMtimeMs,
    }),
    keepalive: input.keepalive,
  }),

  createPost: (input: { kind: `post` | `fragments`, title: string, slug: string }) => request<StudioCreateResponse>(
    `/studio/post`,
    {
      method: `POST`,
      headers: buildHeaders(true),
      body: JSON.stringify(input),
    },
  ),

  stop: (commandId: string) => request<{ ok: true }>(`/studio/stop`, {
    method: `POST`,
    headers: buildHeaders(true),
    body: JSON.stringify({ commandId }),
  }),

  execStream,
}
