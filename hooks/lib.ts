// Pure functions and constants: no `$`, no I/O (from `claude-code` — types
// only). Tests import them directly.

import type {
  Color,
  CommandRunResult,
  PromptOrigin,
  SessionMessage,
  TurnCompleteReason,
  UiScrollArgs,
  UiScrollResult,
} from 'claude-code'

import type { Bar, RailState, TurnSummary } from '../types'

/**
 * Shape tag of the rail in `$.state`: a value written with another tag
 * (another version of the mod) reads as an empty rail. Changed the shape of
 * `RailState` — change the tag.
 */
export const RAIL_SHAPE = 'rail-2'

/** Empty rail: this is how the state reads while nothing has been written. */
export const EMPTY_RAIL: RailState = { bars: [], older: 0, current: null }

/**
 * The `requestId` under which a just-submitted prompt (and a slash command) is
 * drawn while the row has no real id (E1): one for all submissions.
 */
export const PLACEHOLDER_ID = 'placeholder'

/** File editing tools; the file is `input.file_path` or `input.notebook_path`. */
export const EDIT_TOOLS: ReadonlySet<string> = new Set(['Edit', 'Write', 'NotebookEdit'])

/** Tools that launch subagents. */
export const AGENT_TOOLS: ReadonlySet<string> = new Set(['Agent', 'Workflow'])

/** The skill tool; the skill name is `input.skill`. */
export const SKILL_TOOL = 'Skill'

/** Bar kind: what happened in the turn (`kindOf`). */
export type BarKind = 'edit' | 'agent' | 'skill' | 'work' | 'talk' | 'unknown'

/** A human turn from the transcript: the prompt as recorded and the turn summary. */
export type Turn = { text: string; summary: TurnSummary }

/** A feed row from the module cache — what binding (`bindTurns`) needs. */
export type Row = {
  /** `requestId` of the row. */
  id: string
  /** `textKey` of the row text. */
  key: string
  /** Bar text (`Bar.text`). */
  text: string
  /** Number of the row's first appearance in this process. */
  order: number
  /**
   * Row of a prompt the mod saw submitted (`prompt.submit` during a turn or
   * the text of `turn.start`): a new prompt at the bottom of the feed
   * (submitted, waiting or delivered into the running turn), so it is newer
   * than any row that is not `isLive` — a row drawn by scrolling or by a mod reload.
   */
  isLive?: boolean
  /**
   * A prompt whose turn has not ended yet (running or about to start): it has
   * no turn in the transcript yet, and a repeated "yes" would take the turn of
   * the previous "yes". It is not bound and stands at the end of the rail.
   */
  isHeld?: boolean
  /**
   * A row without a turn of its own: a temporary row of a prompt submitted
   * during a turn, or a prompt delivered into the running turn (E5) — it has
   * no entry in the transcript. It is never bound.
   */
  isTurnless?: boolean
  /**
   * A turnless row of a prompt that is still waiting in the queue while the
   * queue drains: it stands at the very end of the rail, after the held ones (`isHeld`).
   */
  isQueued?: boolean
}

/**
 * `$.session.messages()` holds no more entries than this: the newest 4096. That
 * many entries — the transcript is capped, rows older than its first turn have no turn.
 */
export const MESSAGES_MAX = 4096

/** A rail of bars from rows and turns: bars in feed order and the rowless turns older than the first bar. */
export type Binding = { bars: Bar[]; older: number }

/**
 * A human prompt: `composer` — the prompt input, `bridge` — Remote Control.
 * Task notifications, messages of subagents, plugins and other sessions are not.
 */
export function isHumanOrigin(origin: PromptOrigin): boolean {
  return origin.kind === 'composer' || origin.kind === 'bridge'
}

/**
 * Whether a `UserMessage` row gets a bar: a human prompt (`isHumanOrigin`)
 * with a real id and non-empty text. Slash commands and mod commands draw no
 * rows with a real id (E5), so there is no separate rule for them.
 */
export function isHumanRow(requestId: string, origin: PromptOrigin, text: string): boolean {
  return requestId !== PLACEHOLDER_ID && isHumanOrigin(origin) && text.trim() !== ''
}

/**
 * Comparison key of a row and a transcript entry: edges trimmed, whitespace runs
 * collapsed into one space. The row text and the entry text match in full (E5), so
 * paste blocks and `[Image #n]` tags stay in the key — they tell prompts apart.
 */
export function textKey(text: string): string {
  return text.trim().replace(/\s+/g, ' ')
}

// Service `user` entries of the transcript (E5, E7). An interruption (Esc and a
// permission denial) flags the current turn and starts no turn.
const INTERRUPTED = /^\[Request interrupted by user(?: for tool use)?\]$/

// Output of a local command: skipped.
const SKIPPED = ['<local-command-stdout>', '<local-command-stderr>']

// A task notification, a slash command (of a skill or local) and the `/compact`
// summary: they close the current turn and start a turn without a bar — its
// calls go to no bar.
const BOUNDARIES = [
  '<task-notification>',
  '<command-message>',
  '<command-name>',
  'This session is being continued from a previous conversation',
]

/** What a transcript entry means for the split into turns. */
function entryOf(message: SessionMessage): 'prompt' | 'interrupt' | 'boundary' | 'skip' | 'body' {
  if (message.role !== 'user' || (message.toolResults?.length ?? 0) > 0) {
    return 'body'
  }

  const text = message.text.trim()

  if (text === '') {
    return 'body'
  }

  if (INTERRUPTED.test(text)) {
    return 'interrupt'
  }

  if (SKIPPED.some((tag) => text.startsWith(tag))) {
    return 'skip'
  }

  if (BOUNDARIES.some((head) => text.startsWith(head))) {
    return 'boundary'
  }

  return 'prompt'
}

/**
 * The main agent's transcript (`$.session.messages()`) split into human turns,
 * oldest first. A turn starts with a `user` entry without `toolResults` and
 * with non-service text and lasts until the next such entry or a service
 * boundary. Entries before the first turn (the transcript is cut mid-turn) and
 * entries of a turn without a bar (task notification, slash command,
 * `/compact` summary) go to no turn.
 */
export function splitTurns(messages: readonly SessionMessage[]): Turn[] {
  const turns: Turn[] = []
  // The turn being collected; null — a turn without a bar or a transcript that
  // starts mid-turn.
  let openTurn: { text: string; body: SessionMessage[]; interrupted: boolean } | null = null

  const close = () => {
    if (openTurn !== null) {
      turns.push({ text: openTurn.text, summary: summarize(openTurn.body, openTurn.interrupted) })
    }
  }

  for (const message of messages) {
    switch (entryOf(message)) {
      case 'prompt':
        close()
        openTurn = { text: message.text, body: [], interrupted: false }
        break
      case 'boundary':
        close()
        openTurn = null
        break
      case 'interrupt':
        if (openTurn !== null) {
          openTurn.interrupted = true
        }
        break
      case 'body':
        openTurn?.body.push(message)
        break
      case 'skip':
        break
    }
  }

  close()

  return turns
}

/**
 * Transcript turns without the turn that is still running. A transcript read
 * during a turn already holds its prompt as the last turn: the last turn with
 * the text of `turn.start` (`startedKey`) is removed, otherwise an earlier row
 * of the same text would take it. Whether the turn is still running is decided
 * by the caller that read the transcript.
 */
export function withoutRunning(turns: readonly Turn[], startedKey: string | null): readonly Turn[] {
  const last = turns.at(-1)

  return last !== undefined && textKey(last.text) === startedKey ? turns.slice(0, -1) : turns
}

// Slash command tags in the text of its turn (`turn.start`, transcript entry, E5):
// the name with `/` and the arguments.
const COMMAND_NAME = /<command-name>([^<]*)<\/command-name>/
const COMMAND_ARGS = /<command-args>([\s\S]*?)<\/command-args>/

/**
 * Key of a slash command as the human typed it (`/name arguments`), from the
 * tags of its turn text; null — the text is not a command.
 */
export function commandKey(text: string): string | null {
  const name = COMMAND_NAME.exec(text)?.[1]?.trim() ?? ''

  return name === '' ? null : textKey(`${name} ${COMMAND_ARGS.exec(text)?.[1] ?? ''}`)
}

/**
 * Which waiting prompts the turn with text `text` started; `waiting` — their
 * keys in queue order. The prompt with the key of this text; otherwise a slash
 * command whose turn starts with its tags (`commandKey`); otherwise several
 * prompts the engine could have merged into one: the text key is joined from
 * their keys with a space, in queue order. None fits — empty.
 */
export function startedKeys(text: string, waiting: readonly string[]): string[] {
  const key = textKey(text)
  const command = commandKey(text)

  if (waiting.includes(key)) {
    return [key]
  }

  if (command !== null && waiting.includes(command)) {
    return [command]
  }

  return joinedKeys(key, waiting, 0, 0) ?? []
}

/**
 * Keys from `waiting`, starting at `from`, in order, that joined with a space
 * make up the tail of `key` from position `at`; null — it cannot be joined this way.
 */
function joinedKeys(key: string, waiting: readonly string[], from: number, at: number): string[] | null {
  for (let i = from; i < waiting.length; i++) {
    const part = waiting[i] ?? ''
    const end = at + part.length

    if (part === '' || !key.startsWith(part, at)) {
      continue
    }

    if (end === key.length) {
      return [part]
    }

    const rest = key[end] === ' ' ? joinedKeys(key, waiting, i + 1, end + 1) : null

    if (rest !== null) {
      return [part, ...rest]
    }
  }

  return null
}

/** File of an edit call; null — a call without a path. */
function editedPath(input: Readonly<Record<string, unknown>>): string | null {
  for (const field of ['file_path', 'notebook_path']) {
    const path = input[field]

    if (typeof path === 'string' && path !== '') {
      return path
    }
  }

  return null
}

/**
 * Turn summary from the tool calls of its entries. Edits, subagents and skills
 * are counted only from calls without an error: a denied or failed edit did
 * not change the file, a denied Skill did not run the skill; such calls go to
 * `tools` and `errors`.
 */
export function summarize(messages: readonly SessionMessage[], interrupted = false): TurnSummary {
  const files = new Set<string>()
  const skills: string[] = []
  let tools = 0
  let unnamed = 0
  let agents = 0
  let errors = 0

  for (const message of messages) {
    for (const use of message.toolUses) {
      tools++

      if (use.isError) {
        errors++
        continue
      }

      if (EDIT_TOOLS.has(use.tool)) {
        const path = editedPath(use.input)

        if (path === null) {
          unnamed++
        } else {
          files.add(path)
        }
      } else if (AGENT_TOOLS.has(use.tool)) {
        agents++
      } else if (use.tool === SKILL_TOOL) {
        const name = use.input['skill']

        if (typeof name === 'string' && name !== '' && !skills.includes(name)) {
          skills.push(name)
        }
      }
    }
  }

  return { tools, edits: files.size + unnamed, agents, skills, errors, interrupted }
}

/**
 * Bar kind — by the first rule that fits: edits, subagents, skill, work (tool
 * calls), talk. No summary — `unknown`. An error and an interruption do not
 * change the kind.
 */
export function kindOf(summary: TurnSummary | null): BarKind {
  if (summary === null) {
    return 'unknown'
  }

  if (summary.edits > 0) {
    return 'edit'
  }

  if (summary.agents > 0) {
    return 'agent'
  }

  if (summary.skills.length > 0) {
    return 'skill'
  }

  return summary.tools > 0 ? 'work' : 'talk'
}

/** What binding knows besides rows and turns. */
export type BindOptions = {
  /** Previous bars: an unbound row keeps the summary of the bar with the same id. */
  previous?: readonly Bar[]
  /** The transcript is capped (`MESSAGES_MAX` entries): rows older than its first turn have no turn. */
  isCapped?: boolean
}

/** The row can take a transcript turn: it is not held and not turnless. */
function isBindable(row: Row): boolean {
  return row.isHeld !== true && row.isTurnless !== true
}

/** Add `value` to the list of `key`; no list — create one. */
function append<K, V>(lists: Map<K, V[]>, key: K, value: V): void {
  const list = lists.get(key)

  if (list === undefined) {
    lists.set(key, [value])
  } else {
    list.push(value)
  }
}

/**
 * "Row — turn" pairs by `textKey`: in a group of equal texts the newest turns
 * take the newest rows. `isLive` rows are newer than the rest and go in order
 * of appearance; the rest — in feed order: `sketch` is their order in the
 * draft rail; without it a group with two or more such rows is skipped.
 * Extra rows or turns of a group stay unpaired.
 */
function pairTurns(seen: readonly Row[], turns: readonly Turn[], sketch: readonly Row[] | null): Map<string, number> {
  const rowsByKey = new Map<string, Row[]>()

  for (const row of seen) {
    if (isBindable(row)) {
      append(rowsByKey, row.key, row)
    }
  }

  const turnsByKey = new Map<string, number[]>()

  turns.forEach((turn, index) => {
    append(turnsByKey, textKey(turn.text), index)
  })

  const turnOf = new Map<string, number>()
  const sketchAt = new Map(sketch?.map((row, i) => [row.id, i]))

  for (const [key, rows] of rowsByKey) {
    const old = rows.filter((row) => row.isLive !== true)

    if (sketch === null && old.length > 1) {
      continue
    }

    const rank = (row: Row) => (sketch === null ? row.order : (sketchAt.get(row.id) ?? -1))
    const group = [...old.sort((a, b) => rank(a) - rank(b)), ...rows.filter((row) => row.isLive === true)]
    const indexes = turnsByKey.get(key) ?? []
    const pairs = Math.min(group.length, indexes.length)

    for (let back = 1; back <= pairs; back++) {
      const row = group[group.length - back]
      const index = indexes[indexes.length - back]

      if (row !== undefined && index !== undefined) {
        turnOf.set(row.id, index)
      }
    }
  }

  return turnOf
}

/**
 * Which turn belongs to which row (`pairTurns`). Rows of the same text seen not
 * in this process come in chunks bottom-up (E1, E7), and the order of appearance
 * is not the feed order. So the rail is first built without such groups — their
 * rows take their place by neighbours (`slotOf`) — and this draft order decides
 * which row of a group gets which turn.
 */
function matchTurns(seen: readonly Row[], turns: readonly Turn[], isCapped: boolean): Map<string, number> {
  const sketch = placeRows(seen, pairTurns(seen, turns, null), isCapped)

  return pairTurns(seen, turns, sketch)
}

/** Row binding, shared by the search for the place of an unbound row. */
type Placing = {
  /** Rows in ascending `order`. */
  seen: readonly Row[]
  /** Turn index of a bound row. */
  turnOf: ReadonlyMap<string, number>
  /** The rail built up to this step. */
  placed: readonly Row[]
  /** Rows at the end of the rail (`placeRows`). */
  tail: ReadonlySet<string>
  /** The smallest index of a bound turn. */
  first: number
  /** The largest index of a bound turn. */
  last: number
  /** The transcript is capped (`MESSAGES_MAX` entries): rows older than its first turn have no turn. */
  isCapped: boolean
}

/**
 * Place of the unbound row `seen[i]` in the built rail. Rows are drawn in
 * chunks (E1, E7): top-down inside a chunk, and the chunks themselves — in feed
 * order (mod reload, `/resume`) or bottom-up (`claude --resume` and
 * scrolling). So the place is found by neighbours in order of appearance:
 *
 * - a row seen right after an unbound one of the same sort (`isLive` or
 *   not) continues its chunk and stands after it;
 * - a prompt of a past turn (`isLive`) — after the newest bound row seen
 *   before it: it was delivered into the turn that was running then;
 * - otherwise the neighbours are the nearest bound rows seen before
 *   (`prevBound`) and after (`nextBound`) it. The turn of `prevBound` is newer
 *   than the turn of `nextBound` (chunks go bottom-up) or there is no
 *   `prevBound` — the row starts the chunk of `nextBound` and stands before it.
 *   The transcript is capped, the row of the transcript's first turn is already
 *   seen, and `prevBound` is not the newest — the row is older than the
 *   transcript, above the whole rail. Otherwise — after `prevBound`.
 *
 * Chunks without bound rows cannot be told apart: rows delivered into a turn
 * that starts a bottom-up chunk, and rows older than the transcript from
 * different chunks, may take the wrong place.
 */
function slotOf(placing: Placing, i: number): number {
  const { seen, turnOf, placed, tail } = placing
  const row = seen[i]
  const before = seen[i - 1]
  const isUnbound = (other: Row) => !turnOf.has(other.id) && !tail.has(other.id)

  if (
    row !== undefined &&
    before !== undefined &&
    isUnbound(before) &&
    (before.isLive === true) === (row.isLive === true)
  ) {
    return placed.indexOf(before) + 1
  }

  const turnIndex = (other: Row) => turnOf.get(other.id) ?? 0
  const earlier = seen.slice(0, i).filter((other) => turnOf.has(other.id))

  if (row?.isLive === true && earlier.length > 0) {
    const anchor = earlier.reduce((newest, other) => (turnIndex(other) > turnIndex(newest) ? other : newest))

    return placed.indexOf(anchor) + 1
  }

  const prevBound = earlier.at(-1)
  const nextBound = seen.slice(i + 1).find((other) => turnOf.has(other.id))

  if (nextBound !== undefined && (prevBound === undefined || turnIndex(prevBound) > turnIndex(nextBound))) {
    return placed.indexOf(nextBound)
  }

  if (prevBound === undefined) {
    return placed.length - tail.size
  }

  if (nextBound === undefined && placing.isCapped && placing.first === 0 && turnIndex(prevBound) < placing.last) {
    return 0
  }

  return placed.indexOf(prevBound) + 1
}

/**
 * The rail of rows: bound ones — by turn index; held ones (`isHeld`) and
 * `isLive` rows seen after a held one (temporary and delivered into its turn) —
 * at the end in order of appearance; queue rows (`isQueued`) — after them, at
 * the very end; the remaining unbound ones — by neighbours (`slotOf`).
 */
function placeRows(seen: readonly Row[], turnOf: ReadonlyMap<string, number>, isCapped: boolean): Row[] {
  const queued = seen.filter((row) => row.isQueued === true)
  const rest = queued.length === 0 ? seen : seen.filter((row) => row.isQueued !== true)
  const placed = rest
    .filter((row) => turnOf.has(row.id))
    .sort((a, b) => (turnOf.get(a.id) ?? 0) - (turnOf.get(b.id) ?? 0))
  const tail = new Set<string>()
  const indexes = [...turnOf.values()]
  const first = Math.min(...indexes)
  const last = Math.max(...indexes)
  const placing: Placing = { seen: rest, turnOf, placed, tail, first, last, isCapped }

  rest.forEach((row, i) => {
    if (turnOf.has(row.id)) {
      return
    }

    if (row.isHeld === true || (row.isLive === true && tail.size > 0)) {
      placed.push(row)
      tail.add(row.id)
    } else {
      placed.splice(slotOf(placing, i), 0, row)
    }
  })

  return [...placed, ...queued]
}

/**
 * Bars from feed rows and transcript turns. A row and a turn are linked by
 * `textKey` from the end (`matchTurns`); what did not match has no summary, no guessing.
 * Rows do not come in feed order (E7), so the rail is built by `placeRows`.
 * A bound bar takes the turn summary, an unbound one keeps the previous one
 * (`previous`): after `/compact` and after the transcript is capped the labels
 * of old bars do not vanish. `older` — turns older than the first bound one; none is bound —
 * all turns. The turn of a prompt that is held must not be in `turns` (it is
 * removed by `withoutRunning`).
 */
export function bindTurns(rows: Iterable<Row>, turns: readonly Turn[], options: BindOptions = {}): Binding {
  const isCapped = options.isCapped === true
  const seen = [...rows].sort((a, b) => a.order - b.order)
  const turnOf = matchTurns(seen, turns, isCapped)
  const kept = new Map(options.previous?.map((bar) => [bar.id, bar.summary]))
  const bars = placeRows(seen, turnOf, isCapped).map((row): Bar => {
    const index = turnOf.get(row.id)
    const summary = index === undefined ? kept.get(row.id) : turns[index]?.summary

    return { id: row.id, text: row.text, summary: summary ?? null }
  })

  return { bars, older: turnOf.size > 0 ? Math.min(...turnOf.values()) : turns.length }
}

/**
 * A summary with the flag from `turn.complete` — the fallback path for a turn
 * whose end the transcript does not reflect: `aborted` — the turn is interrupted,
 * `error` (API error) and `refusal` (model refusal) — an error, at least one.
 * `answer` does not change the summary. Applying it again changes nothing.
 */
export function markSummary(summary: TurnSummary, reason: TurnCompleteReason): TurnSummary {
  switch (reason) {
    case 'answer':
      return summary
    case 'aborted':
      return { ...summary, interrupted: true }
    case 'error':
    case 'refusal':
      return { ...summary, errors: Math.max(summary.errors, 1) }
  }
}

/**
 * Bars with the turn-end flags (`marks`: the `turn.complete` reason by bar id)
 * put on the summary (`markSummary`). A bar without a summary and a bar
 * without a flag — as is.
 */
export function markBars(bars: readonly Bar[], marks: ReadonlyMap<string, TurnCompleteReason>): Bar[] {
  return bars.map((bar) => {
    const reason = marks.get(bar.id)

    return reason === undefined || bar.summary === null ? bar : { ...bar, summary: markSummary(bar.summary, reason) }
  })
}

/** How many first turns of two transcript reads match by `textKey`. */
function sharedHead(before: readonly Turn[], after: readonly Turn[]): number {
  let n = 0

  while (n < before.length && n < after.length && textKey(before[n]?.text ?? '') === textKey(after[n]?.text ?? '')) {
    n++
  }

  return n
}

/**
 * Rows that vanished from the feed with a rewind (`/rewind`): a rewind removes
 * the tail of the transcript and the rows of its turns without an event (E7).
 * `before` — turns of the previous read, `after` — of the new one. A rewind is
 * when the start of the transcript is the same (not the cap at 4096 entries and
 * not `/compact`) and the tail of the previous read is gone: the row of the
 * newest bound turn is no longer bound, only the first turns match. The rows
 * that lost their turn past the rewind point are gone, and so are the unbound
 * rows after them (prompts delivered into those turns) — in the order of the
 * previous rail, up to the first row that is bound now or held (a prompt
 * submitted after the rewind). A rewind to the very start and a rewind with the
 * same prompt text are not detected.
 */
export function rewound(rows: Iterable<Row>, before: readonly Turn[], after: readonly Turn[]): Set<string> {
  const gone = new Set<string>()
  const kept = sharedHead(before, after)

  if (kept === 0 || kept >= before.length) {
    return gone
  }

  const seen = [...rows].sort((a, b) => a.order - b.order)
  const was = matchTurns(seen, before, false)
  const now = matchTurns(seen, after, false)
  let newest: string | undefined

  for (const [id, index] of was) {
    if (newest === undefined || index > (was.get(newest) ?? -1)) {
      newest = id
    }
  }

  if (newest === undefined || now.has(newest)) {
    return gone
  }

  const held = new Set(seen.filter((row) => row.isHeld === true).map((row) => row.id))
  const order = placeRows(seen, was, false).map((row) => row.id)
  const from = order.findIndex((id) => (was.get(id) ?? -1) >= kept && !now.has(id))

  for (const id of from === -1 ? [] : order.slice(from)) {
    if (now.has(id) || held.has(id)) {
      break
    }

    gone.add(id)
  }

  return gone
}

// Text width — a copy of `textWidth` from image-rail (a copy, not a dependency).

// Zero width: combining marks and invisible format characters.
const ZERO_WIDTH = /^[\p{Mn}\p{Me}\p{Cf}]$/u

// Double width: CJK ideographs, Hangul, fullwidth forms, emoji. On top of
// the copy from image-rail — characters with emoji presentation by default
// (`Emoji_Presentation`: 🚀, 🫠, ✅, ⚡): the terminal draws them in two cells.
const DOUBLE_WIDTH =
  /^(?:[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6\u{1F300}-\u{1F64F}\u{1F900}-\u{1F9FF}\u{20000}-\u{3FFFD}]|\p{Emoji_Presentation})$/u

function charWidth(char: string): number {
  if (ZERO_WIDTH.test(char)) {
    return 0
  }

  return DOUBLE_WIDTH.test(char) ? 2 : 1
}

/**
 * Text width in terminal cells, approximate: a character — one cell,
 * a combining mark — zero, an ideograph and an emoji — two.
 */
export function textWidth(text: string): number {
  let width = 0

  for (const char of text) {
    width += charWidth(char)
  }

  return width
}

const ELLIPSIS = '…'

/** Start of the text no wider than `cells` cells, of whole characters. */
function headOf(text: string, cells: number): string {
  let head = ''
  let width = 0

  for (const char of text) {
    width += charWidth(char)

    if (width > cells) {
      break
    }

    head += char
  }

  return head
}

/** Text no wider than `cells` cells: does not fit — the start and an ellipsis. */
function clip(text: string, cells: number): string {
  if (textWidth(text) <= cells) {
    return text
  }

  return cells < 1 ? '' : headOf(text, cells - 1) + ELLIPSIS
}

/**
 * Bar character by turn kind (one cell) — variant B "Height": the more was
 * done in the turn, the taller the column; `unknown` — hatching. A bar is
 * drawn as the character BAR_WIDTH times in a row.
 */
export const GLYPHS: Readonly<Record<BarKind, string>> = {
  edit: '█',
  agent: '▆',
  skill: '▅',
  work: '▃',
  talk: '▂',
  unknown: '░',
}

/** Bar width in cells: the GLYPHS kind character is repeated this many times. */
export const BAR_WIDTH = 2

/**
 * Name of the turn kind — a noun: the prompt line in the card starts with it
 * (`[Edit] text`).
 */
export const KIND_NAMES: Readonly<Record<BarKind, string>> = {
  edit: 'Edit',
  agent: 'Agent',
  skill: 'Skill',
  work: 'Work',
  talk: 'Talk',
  unknown: 'Unknown',
}

/**
 * Bar colour by turn kind — the Nord palette, the same in all themes: each
 * kind has its own.
 */
export const KIND_COLORS: Readonly<Record<BarKind, Color>> = {
  edit: '#a3be8c',
  agent: '#b48ead',
  skill: '#ebcb8b',
  work: '#81a1c1',
  talk: '#616e88',
  unknown: '#4c566a',
}

/**
 * Rail colours besides the kind colour — the Nord palette: `flagged` — the bar
 * of a turn with an error or an interrupted one (red, instead of the kind
 * colour), `current` — "you are here": the reading bar (cyan), `line` — the header lines (grey);
 * and `title` — the word `Feed` of the header, in Claude's brand colour (peach), not Nord.
 */
export const BAR_COLORS: Readonly<{ flagged: Color; current: Color; line: Color; title: Color }> = {
  flagged: '#bf616a',
  current: '#88c0d0',
  line: '#616e88',
  title: '#d97757',
}

/** The turn has an error or is interrupted: the bar takes the error colour, the kind does not change. */
export function isFlagged(summary: TurnSummary | null): boolean {
  return summary !== null && (summary.errors > 0 || summary.interrupted)
}

/**
 * Colour of the bar character: the kind colour (`KIND_COLORS`), a flagged
 * turn — the error colour. By colour, not by dimming: the terminal draws dimmed
 * text in its own colour. The reading bar is not set apart by colour.
 */
export function barColor(summary: TurnSummary | null): Color {
  return isFlagged(summary) ? BAR_COLORS.flagged : KIND_COLORS[kindOf(summary)]
}

/**
 * An empty gap cell of the bar line, one cell wide: a gap stands before each
 * item (bars and counters) and after the last one (`barGaps`). Without gaps
 * bars in a row would merge into a band; the gaps on both sides of the reading
 * bar hold its pointers.
 */
export const GAP = ' '

/**
 * Pointers of the reading bar — the gap cells on both its sides, in the colour
 * `BAR_COLORS.current`: `▸██◂`, tips towards the bar; `▸` — as in the jump mark
 * in the feed (`MARK`). Both characters are one cell wide (East Asian Width N).
 */
export const POINTERS: Readonly<{ left: string; right: string }> = { left: '▸', right: '◂' }

/**
 * No more visible bars than this: the cards of all visible bars lie in the tree
 * at once and share the strip budget (100,000 characters of tree for all rows;
 * the engine does not draw a row past it) with the rows of other mods. Usually
 * the rail stays within half of it: a bar with a card of 300 characters and a
 * row id as long as a UUID is about 1200 characters of tree, 40 such bars at a
 * width of 400 columns — about 48 thousand, quotes in prompts included. The
 * rail takes more than half only in a wide strip: the padding repeats the
 * full-width summary of the reading bar in every hidden card, and JSON doubles
 * quotes and backslashes — up to 75 thousand at 400 columns, about 50 thousand
 * at 133 (the size tests in `rail.test.tsx`).
 */
export const MAX_BARS = 40

/** Length of the bar text (`Bar.text`) in characters, at most. */
export const BAR_TEXT_MAX = 300

/**
 * Card rows: the number with the summary and the prompt text. The rail always
 * keeps this many rows for the card (E4), with hover and without.
 */
export const CARD_ROWS = 2

/**
 * Empty rows above the header of the rail, unfolded and folded (`paddingTop`):
 * they separate the rail from the feed. The engine's `[-]` stands in the top
 * row of the strip at the right edge, so it ends up here and not in the header
 * row next to the fold button.
 */
export const TOP_ROWS = 1

/** Left counter: bars hidden on the left, together with turns older than the first bar. */
export function beforeLabel(n: number): string {
  return `‹${n}`
}

/** Right counter: bars hidden on the right. */
export function afterLabel(n: number): string {
  return `${n}›`
}

/**
 * Window of visible bars of a rail of `count`: bars `[from, to)`. The left
 * counter shows `from + older`, the right one — `count - to`; 0 — no counter.
 */
export type BarWindow = { from: number; to: number }

/**
 * Width of the bar line `line` (`barLine`): bars (BAR_WIDTH cells each),
 * counters and gap cells.
 */
function lineWidth(line: BarLine): number {
  const items = line.items.reduce((sum, item) => sum + ('label' in item ? textWidth(item.label) : BAR_WIDTH), 0)

  return line.gaps.reduce((sum, gap) => sum + textWidth(gap.text), items)
}

/**
 * Window of visible bars at the strip width `columns`: as many bars as
 * possible, no more than MAX_BARS, together with the hidden-bar counters and gap cells (`barLine`).
 * The reading bar — index `reading` (`readingIndex`) — is always in the window:
 * the window stands at the right edge of the rail, and if the reading bar does
 * not fall into it — starts with that bar. `older` — turns older than the first
 * bar (`RailState.older`): they are in the left counter and take up its room even
 * when all bars are in the window. Not a single bar fits with its counters and
 * gaps, or there are no bars — the window is empty (`from === to`), the rail is not drawn.
 */
export function fitBars(count: number, reading: number, columns: number, older: number): BarWindow {
  for (let n = Math.min(count, MAX_BARS); n > 0; n--) {
    const from = reading >= count - n ? count - n : reading
    const to = from + n

    if (lineWidth(barLine({ from, to }, count, older, reading)) <= columns) {
      return { from, to }
    }
  }

  return { from: 0, to: 0 }
}

/**
 * A segment of a rail row: text, colour and weight; without a colour — in the
 * terminal's text colour, without a weight — regular.
 */
export type Part = { text: string; color?: Color; weight?: 'bold' }

/**
 * Gap cells of a bar line of `items` items (`barLine`): a cell before each
 * item and one after the last, so a bar at the edge of the window has cells on
 * both sides. The reading bar is item number `at` (from zero): the cells on
 * its sides are the POINTERS in the colour `BAR_COLORS.current`, the rest — GAP
 * without a colour. `at` is not an item number — no pointers.
 */
export function barGaps(items: number, at: number): Part[] {
  const gaps: Part[] = Array.from({ length: items + 1 }, () => ({ text: GAP }))

  if (at >= 0 && at < items) {
    gaps[at] = { text: POINTERS.left, color: BAR_COLORS.current }
    gaps[at + 1] = { text: POINTERS.right, color: BAR_COLORS.current }
  }

  return gaps
}

/** An item of the bar line: the hidden-bar counter `label` (`‹N`, `N›`) or the rail bar number `index` (from zero). */
export type LineItem = { label: string } | { index: number }

/**
 * The bar line of a window: items in order and gap cells (`barGaps`), of which
 * there is one more: `gaps[i]` stands before `items[i]`, the last one — after
 * the last item.
 */
export type BarLine = { items: LineItem[]; gaps: Part[] }

/**
 * The bar line of the window `window` of a rail of `count` (`fitBars`): the
 * left counter `‹N` (`from + older`; 0 — none), the bars of the window, the
 * right counter `N›` (`count - to`) and the gap cells between them. The reading
 * bar `reading` (`readingIndex`) is between the pointers; not in the window — no
 * pointers. `railRow` draws it, and `fitBars` measures the window by it.
 */
export function barLine(window: BarWindow, count: number, older: number, reading: number): BarLine {
  const before = window.from + older
  const after = count - window.to
  const items: LineItem[] = [
    ...(before > 0 ? [{ label: beforeLabel(before) }] : []),
    ...Array.from({ length: window.to - window.from }, (_, i) => ({ index: window.from + i })),
    ...(after > 0 ? [{ label: afterLabel(after) }] : []),
  ]
  const at = items.findIndex((item) => 'index' in item && item.index === reading)

  return { items, gaps: barGaps(items.length, at) }
}

// Character of the header lines, one cell.
const RULE = '─'

/**
 * Label of the fold button at the start of the header: `[-]` on an unfolded
 * rail — a press folds it to one row, `[+]` on a folded one — unfolds it. Both
 * are the same width (FOLD_WIDTH). The engine's folding (`[-]` at the right
 * edge of the strip, `ctrl+x ctrl+a`) is different: it hides the whole strip.
 */
export const FOLD_LABELS: Readonly<{ open: string; folded: string }> = { open: '[-]', folded: '[+]' }

/** Width of the fold button in cells. */
export const FOLD_WIDTH = textWidth(FOLD_LABELS.open)

/** Label of the rail's fold button: folded — `[+]`, unfolded — `[-]`. */
export function foldLabel(folded: boolean): string {
  return folded ? FOLD_LABELS.folded : FOLD_LABELS.open
}

/** Place of bar number `index` (from zero) in a rail of `count`: the `#n/N` of the header and of the feed mark. */
function placeLabel(index: number, count: number): string {
  return `#${index + 1}/${count}`
}

/** Width of the segments in cells. */
function partsWidth(parts: readonly Part[]): number {
  return parts.reduce((sum, part) => sum + textWidth(part.text), 0)
}

// The word of the header label.
const TITLE = 'Feed'

/**
 * Header label after the fold button — ` Feed · #n/N`, no wider than `cells`
 * cells: the space, the word `Feed` in bold in `BAR_COLORS.title`, ` · ` in the
 * text colour, the place of the reading bar `#n/N` (`n` — `reading + 1`, `N` —
 * the bars of the rail, `older` turns do not count) — `BAR_COLORS.current`.
 * Does not fit in full — `#n/N` goes, ` Feed` is cut from the end (with an
 * ellipsis, the cut word keeps its colour and weight). The reading bar is not
 * in the rail — no `#n/N` either.
 */
function titleParts(count: number, reading: number, cells: number): Part[] {
  const name: Part = { text: TITLE, color: BAR_COLORS.title, weight: 'bold' }
  const place = reading >= 0 && reading < count ? placeLabel(reading, count) : null

  if (place !== null && textWidth(` ${TITLE} · `) + textWidth(place) <= cells) {
    return [{ text: ' ' }, name, { text: ' · ' }, { text: place, color: BAR_COLORS.current }]
  }

  const text = clip(` ${TITLE}`, cells)

  if (text === '') {
    return []
  }

  return text.startsWith(' ') ? [{ text: ' ' }, { ...name, text: text.slice(1) }] : [{ ...name, text }]
}

/** Line to the edge: a space and `cells − 1` cells of line in the colour `BAR_COLORS.line`; `cells` < 1 — nothing. */
function ruleParts(cells: number): Part[] {
  return cells > 0 ? [{ text: ` ${RULE.repeat(cells - 1)}`, color: BAR_COLORS.line }] : []
}

/**
 * Header of an unfolded rail of `count` bars with the reading bar `reading`
 * (`readingIndex`) — the segments after the fold button (`foldLabel`), exactly
 * `columns − FOLD_WIDTH` cells wide in total: ` Feed · #n/N ─────` (the label
 * `titleParts`, then the line to the edge). Narrow — the line gets shorter first,
 * then the label. There are no empty segments: at `columns ≤ FOLD_WIDTH` — none at all.
 */
export function headerParts(count: number, reading: number, columns: number): Part[] {
  const cells = columns - FOLD_WIDTH
  const title = titleParts(count, reading, cells)

  return [...title, ...ruleParts(cells - partsWidth(title))]
}

/**
 * A folded rail — one row after the fold button: `head` — the header label and
 * a space, `line` — the bar line (`barLine`, as in the unfolded rail: counters,
 * pointers of the reading bar), `tail` — the line to the edge. Not a single bar
 * fits — `line` is null, `head` is the whole header of the unfolded rail
 * (`headerParts`), `tail` is empty.
 */
export type FoldedLine = { head: Part[]; line: BarLine | null; tail: Part[] }

/**
 * The row of a folded rail of `count` bars with the reading bar `reading`, exactly
 * `columns − FOLD_WIDTH` cells wide after the button: ` Feed · #n/N  ‹N ▂▂ ▂▂▸▂▂◂ ──`.
 * The bar window (`fitBars`) — by the room between the label with the space and
 * the line; two cells are left for the line (a space and at least one line
 * cell). `older` — turns older than the first bar, in the left counter.
 */
export function foldedLine(count: number, reading: number, columns: number, older: number): FoldedLine {
  const cells = columns - FOLD_WIDTH
  const title = titleParts(count, reading, cells)
  const titled = partsWidth(title) + 1
  const window = fitBars(count, reading, cells - titled - 2, older)

  if (window.from === window.to) {
    return { head: headerParts(count, reading, columns), line: null, tail: [] }
  }

  const line = barLine(window, count, older, reading)

  return { head: [...title, { text: ' ' }], line, tail: ruleParts(cells - titled - lineWidth(line)) }
}

// An expanded text paste in a prompt: `<pasted_content id="225b">\n…\n
// </pasted_content id="225b">`, the closing tag with the same id (E5). The
// second group is the block content without the last line break; a block
// without content has none.
const PASTED_BLOCK = /<pasted_content id="([0-9a-f]+)">\n(?:([\s\S]*?)\n)?<\/pasted_content id="\1">/g

/**
 * Token of a paste block in the bar text: `[Pasted text +N lines]`, `N` — the
 * lines of the block content (`+1 line`); an empty block — `[Pasted text]`.
 */
function pastedToken(content: string | undefined): string {
  const lines = content === undefined || content === '' ? 0 : content.split('\n').length

  return lines === 0 ? '[Pasted text]' : `[Pasted text +${lines} ${plural(lines, 'line', 'lines')}]`
}

// The paste token (`pastedToken`) in the bar text — for search (`findBar`).
const PASTED_TOKEN = /\[Pasted text(?: \+\d+ lines?)?\]/g

/**
 * Bar text (`Bar.text`) from the row text: a paste block — the token
 * `[Pasted text +N lines]` (`pastedToken`), whitespace runs collapsed, no
 * longer than BAR_TEXT_MAX characters (cut — with an ellipsis, the token too).
 */
export function barText(text: string): string {
  const tokens = text.replace(
    PASTED_BLOCK,
    (_block: string, _id: string, content: string | undefined) => ` ${pastedToken(content)} `,
  )
  const flat = textKey(tokens)
  const chars = [...flat]

  return chars.length <= BAR_TEXT_MAX ? flat : chars.slice(0, BAR_TEXT_MAX - 1).join('') + ELLIPSIS
}

/** Word form by number (English): 1 file, 0 files, 3 files. */
function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many
}

/** Parts of the turn summary for the card: what was done, then the error and the interruption. */
function summaryParts(summary: TurnSummary | null): string[] {
  if (summary === null) {
    return ['no summary']
  }

  const parts: string[] = []

  if (summary.edits > 0) {
    parts.push(`edits: ${summary.edits} ${plural(summary.edits, 'file', 'files')}`)
  }

  if (summary.agents > 0) {
    parts.push(`subagents: ${summary.agents}`)
  }

  if (summary.skills.length > 0) {
    parts.push(`${plural(summary.skills.length, 'skill', 'skills')}: ${summary.skills.join(', ')}`)
  }

  if (parts.length === 0) {
    parts.push(summary.tools > 0 ? `calls: ${summary.tools}` : 'talk')
  }

  if (summary.errors > 0) {
    parts.push(summary.errors === 1 ? 'error' : `errors: ${summary.errors}`)
  }

  if (summary.interrupted) {
    parts.push('interrupted')
  }

  return parts
}

/**
 * Lines of a bar's card — CARD_ROWS: `head` — the first line, the second —
 * `name` and then `prompt`. `name` is drawn in the colour of the kind `kind`
 * (`KIND_COLORS`), so the second line is two pieces.
 */
export type CardLines = { head: string; name: string; prompt: string; kind: BarKind }

/**
 * Card lines of the bar number `index` (from zero), each no wider than
 * `columns` cells and without padding: `head` — `#n` and the turn summary
 * joined with ` · `, cut from the end; the second line — the kind name in
 * brackets `name` (`[Edit]`) and the prompt text `prompt` with a leading space
 * (` text`; `Bar.text` is already one line), cut together as one line. Did not
 * fit — with an ellipsis; too narrow even for the name — it is cut too, and
 * `prompt` is empty. `kind` — the turn kind (`kindOf`).
 */
export function cardLines(bar: Bar, index: number, columns: number): CardLines {
  const kind = kindOf(bar.summary)
  const name = `[${KIND_NAMES[kind]}]`
  const line = clip(bar.text === '' ? name : `${name} ${bar.text}`, columns)
  const named = headOf(line, textWidth(name))

  return {
    head: clip([`#${index + 1}`, ...summaryParts(bar.summary)].join(' · '), columns),
    name: named,
    prompt: line.slice(named.length),
    kind,
  }
}

/** Text padded with spaces on the right to a width of `cells` cells; wider — as is. */
function padTo(text: string, cells: number): string {
  return text + ' '.repeat(Math.max(0, cells - textWidth(text)))
}

/**
 * Lines of the hidden card `card` that hover opens over the visible card of
 * the reading bar `under` (both — `cardLines`): a line shorter than the line of
 * `under` beneath it is padded with spaces to its width, a longer one — as is.
 * A `Box` has no cells of its own, so only spaces wipe the old letters, and
 * padding to the width of `under`, not to `columns`, keeps the strip tree within budget (E8).
 */
export function coverLines(card: CardLines, under: CardLines): CardLines {
  const named = textWidth(card.name)

  return {
    ...card,
    head: padTo(card.head, textWidth(under.head)),
    prompt: padTo(card.prompt, textWidth(under.name) + textWidth(under.prompt) - named),
  }
}

/** A step along the rail: the neighbouring bar, the first, the last. */
export type Step = 'next' | 'prev' | 'first' | 'last'

const STEPS: readonly Step[] = ['next', 'prev', 'first', 'last']

function isStep(word: string): word is Step {
  return (STEPS as readonly string[]).includes(word)
}

/** Argument of the `/tail-feed` command, parsed by `parseCommand`. */
export type Command =
  | { kind: Step }
  | { kind: 'toggle' }
  | { kind: 'index'; n: number }
  | { kind: 'find'; words: string[] }
  | { kind: 'show' }
  | { kind: 'bad'; hint: string }

// Forms of the `/tail-feed` argument that `parseCommand` parses: steps,
// fold, bar number, number with a hash, search. The help and the hint come
// from this list.
const FORMS: readonly string[] = [...STEPS, 'toggle', '<n>', '#<n>', 'find <words>']

/** Forms of the `/tail-feed` argument — for the help and the hints in command replies. */
export const COMMAND_FORMS = FORMS.join(', ')

/** Hint of the `/tail-feed` argument in the command list (`argumentHint`). */
export const COMMAND_HINT = FORMS.join('|')

/**
 * Argument of `/tail-feed`: empty — help; `next`, `prev`, `first`, `last`;
 * `toggle` — fold or unfold the rail; bar number `12` or `#12` (from one);
 * `find` and words. Command words are case-insensitive. Anything else —
 * `bad` with a hint for the command reply.
 */
export function parseCommand(args: string): Command {
  const [head, ...rest] = args.trim().split(/\s+/).filter((word) => word !== '')

  if (head === undefined) {
    return { kind: 'show' }
  }

  const name = head.toLowerCase()

  if (name === 'find') {
    return rest.length > 0 ? { kind: 'find', words: rest } : { kind: 'bad', hint: 'find needs words: /tail-feed find <words>' }
  }

  if (rest.length === 0 && isStep(name)) {
    return { kind: name }
  }

  if (rest.length === 0 && name === 'toggle') {
    return { kind: 'toggle' }
  }

  const number = /^#?(\d+)$/.exec(head)?.[1]

  if (rest.length === 0 && number !== undefined) {
    const n = Number(number)

    return n >= 1 && Number.isSafeInteger(n) ? { kind: 'index', n } : { kind: 'bad', hint: `no prompt #${number}` }
  }

  return { kind: 'bad', hint: `didn't understand "${args.trim()}": /tail-feed ${COMMAND_FORMS}` }
}

/**
 * Index of the newest bar whose text contains all the words (non-empty, as
 * `parseCommand` gives them), case-insensitive; null — there is none. The paste
 * token `[Pasted text +N lines]` is one word `pasted` for search: `find pasted`
 * finds prompts with a paste, while `find text` and `find lines` find only
 * prompts with those words.
 */
export function findBar(bars: readonly Bar[], words: readonly string[]): number | null {
  const needles = words.map((word) => word.toLowerCase())

  for (let i = bars.length - 1; i >= 0; i--) {
    const text = (bars[i]?.text ?? '').replace(PASTED_TOKEN, 'pasted').toLowerCase()

    if (needles.every((needle) => text.includes(needle))) {
      return i
    }
  }

  return null
}

/**
 * Index of the reading bar: the bar of the last jump (`current`), and while
 * there were no jumps or its bar is not in the rail — the newest. Empty rail — -1.
 */
export function readingIndex(bars: readonly Bar[], current: string | null): number {
  const found = current === null ? -1 : bars.findIndex((bar) => bar.id === current)

  return found === -1 ? bars.length - 1 : found
}

/**
 * Index of the bar for a step from the reading bar (`readingIndex`) in a
 * non-empty rail. `next` and `prev` at the edge of the rail — null. `first` and
 * `last` always lead to the edge, even from it: the window may have been moved
 * away by the wheel, and the mod does not see that.
 */
export function stepTarget(bars: readonly Bar[], current: string | null, step: Step): number | null {
  const last = bars.length - 1
  const at = readingIndex(bars, current)

  switch (step) {
    case 'first':
      return 0
    case 'last':
      return last
    case 'next':
      return at < last ? at + 1 : null
    case 'prev':
      return at > 0 ? at - 1 : null
  }
}

/**
 * Argument of `$.ui.scroll` for a jump to the prompt row of the bar `id`: the
 * row lands at the top of the window (E2).
 */
export function jumpArgs(id: string): UiScrollArgs {
  return { to: { requestId: id }, block: 'start' }
}

/**
 * The rail after a successful jump to the bar `id`: this bar is the reading
 * bar. The bar is no longer in the rail (the feed changed while the jump was
 * under way) — the rail is unchanged.
 */
export function jumpedTo(rail: RailState, id: string): RailState {
  return rail.bars.some((bar) => bar.id === id) ? { ...rail, current: id } : rail
}

/** Sign of the jump mark in the feed, one cell: `▸ #n/N · Kind`. */
export const MARK = '▸'

/**
 * The mark above the prompt row of the last jump in the feed: `id` — the row
 * it stands above; `label` — MARK, the bar's place `#n/N` (`placeLabel`, as in
 * the header) and ` · `; `kind` — the turn kind: after `label` the mark writes
 * its name (`KIND_NAMES`) in its colour.
 */
export type MarkParts = { id: string; label: string; kind: BarKind }

/**
 * The mark of the prompt of the last jump — the `current` bar of the rail. There
 * were no jumps or a submitted prompt reset `current` — null; the bar of the
 * jump is no longer in the rail — null too: no mark.
 */
export function markParts(rail: RailState): MarkParts | null {
  const index = rail.current === null ? -1 : rail.bars.findIndex((bar) => bar.id === rail.current)
  const bar = index === -1 ? undefined : rail.bars[index]

  if (bar === undefined) {
    return null
  }

  return { id: bar.id, label: `${MARK} ${placeLabel(index, rail.bars.length)} · `, kind: kindOf(bar.summary) }
}

/**
 * Commands without an argument — for a keybinding (`command:tail-feed-next`):
 * the `/tail-feed` argument each one substitutes.
 */
const SHORTCUTS: Readonly<Partial<Record<string, Step | 'toggle'>>> = {
  'tail-feed-next': 'next',
  'tail-feed-prev': 'prev',
  'tail-feed-toggle': 'toggle',
}

/**
 * Argument for `parseCommand` by command name: `/tail-feed-next`,
 * `/tail-feed-prev` and `/tail-feed-toggle` — `next`, `prev` and `toggle`
 * (an argument typed after them is not read), `/tail-feed` — the typed
 * argument.
 */
export function commandArgs(command: string, args: string): string {
  return SHORTCUTS[command] ?? args
}

/**
 * What to do for a command: jump to the bar `id` (number `n` in the rail, from
 * one, like the `#n` of the card), fold or unfold the rail, or reply with a
 * line saying why there is no jump.
 */
export type CommandAim = { kind: 'jump'; id: string; n: number } | { kind: 'toggle' } | { kind: 'reply'; text: string }

/** A number with the word in the right form: 1 bar, 5 bars. */
function counted(n: number, one: string, many: string): string {
  return `${n} ${plural(n, one, many)}`
}

/** Transcript turns older than the first bar that have no row yet (`older`); 0 — empty. */
function olderNote(older: number): string {
  return older > 0 ? `; ${counted(older, 'older turn', 'older turns')} above without a bar` : ''
}

/**
 * The command's decision from the parsed argument and the rail from `$.state`.
 * Help — how many bars, which one is being read, the argument forms. A jump — to
 * a bar by number, by search (`findBar`) or by a step from the reading bar
 * (`stepTarget`). `toggle` — fold or unfold the rail, whatever the rail.
 * Nowhere to jump (empty rail, no such number, words not found, edge of the
 * rail) or the argument was not parsed — a reply line.
 */
export function aimCommand(command: Command, rail: RailState): CommandAim {
  const { bars, older } = rail
  const reply = (text: string): CommandAim => ({ kind: 'reply', text })

  if (command.kind === 'bad') {
    return reply(command.hint)
  }

  if (command.kind === 'toggle') {
    return { kind: 'toggle' }
  }

  if (command.kind === 'show') {
    const count = counted(bars.length, 'bar', 'bars')
    const reading = bars.length === 0 ? 'no bars' : `${count}, reading #${readingIndex(bars, rail.current) + 1}`

    return reply(`${reading}${olderNote(older)}. /tail-feed ${COMMAND_FORMS}`)
  }

  if (bars.length === 0) {
    return reply(`no bars — nowhere to jump${olderNote(older)}`)
  }

  let index: number | null
  let miss: string

  if (command.kind === 'index') {
    index = command.n <= bars.length ? command.n - 1 : null
    miss = `no prompt #${command.n}: the rail has ${counted(bars.length, 'bar', 'bars')}`
  } else if (command.kind === 'find') {
    index = findBar(bars, command.words)
    miss = `not found: "${command.words.join(' ')}"`
  } else {
    index = stepTarget(bars, rail.current, command.kind)
    miss =
      command.kind === 'next'
        ? `#${bars.length} is the last in the rail`
        : `#1 is the first in the rail${olderNote(older)}`
  }

  const target = index === null ? undefined : bars[index]

  return index === null || target === undefined ? reply(miss) : { kind: 'jump', id: target.id, n: index + 1 }
}

/**
 * A command reply line — for the human only (`isTextDisplayOnly`): the engine
 * draws it and does not put it into the model request. During a turn the engine
 * may keep it in the request (this is how the types describe the flag).
 */
export function replyOf(text: string): CommandRunResult {
  return { text, isTextDisplayOnly: true }
}

/**
 * Command reply after a jump to bar #`n`: a successful one — without text (E2:
 * the engine accepts a reply without `text` and draws no reply line); a denial —
 * the denial text as is (`replyOf`).
 */
export function jumpReply(n: number, result: UiScrollResult): CommandRunResult {
  return result.deny === undefined ? {} : replyOf(`didn't jump to #${n}: ${result.deny}`)
}

/**
 * Command reply after a fold: a successful one (`error` null) — without text,
 * like a successful jump; a write failure — the error text as a line for the
 * human only (the engine adds the `tail-feed: ` prefix to the reply).
 */
export function foldReply(error: string | null): CommandRunResult {
  return error === null ? {} : replyOf(`didn't toggle the rail: ${error}`)
}

/** Debug log line about a fold failure (button and command). */
export function foldNote(error: string): string {
  return `tail-feed: didn't toggle the rail: ${error}`
}

/** Debug log line about a denied jump to the row `id` (click and command). */
export function jumpNote(id: string, deny: string): string {
  return `tail-feed: didn't jump to row ${id}: ${deny}`
}

/** Text of an error caught by `catch`. */
export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
