// The shared world of the hook tests: stubs of the world under the plugin (`session.id`, `session.messages`, the
// clock), the bottom of the event chains, the rail writes to `$.state`, transcript records and the actions of the
// human and the engine: draw a row, submit a prompt, start and end a turn, start and change a session. The shared
// transcript records and the turn summary are here too: the `lib.ts` tests take them as well. The file is not
// `*.test`, the harness does not run it.

import type {
  CommandSpec,
  On,
  PromptOrigin,
  RenderViewport,
  SessionEndReason,
  SessionMessage,
  ToolUseSummary,
  TurnCompleteReason,
} from 'claude-code'
import { mock } from 'claude-code/testing'
import type { Engine, FoundElement, MockClock, Mounted } from 'claude-code/testing'

import { MARK, RAIL_SHAPE } from '../hooks/lib'
import type { RailState, TurnSummary } from '../types'

/** A prompt from the prompt input. */
export const COMPOSER: PromptOrigin = { kind: 'composer' }

/** A terminal viewport in fullscreen. */
export const VIEWPORT = { columns: 120, rows: 40, isFullscreen: true } as const

/** The deny reason the engine rejects a write from a timer with (E6). */
export const DENIED = 'state.set: denied: it was made while ui.render is being dispatched (host check)'

export type World = {
  sessionId: string
  /** The main agent's transcript, as `$.session.messages()` returns it. */
  messages: SessionMessage[]
  /** `$.session.messages()` denies. */
  isMessagesBroken?: boolean
  /** `$.session.id()` denies. */
  isIdBroken?: boolean
  /** Reading the rail from `$.state` denies. */
  isStateBroken?: boolean
  /** A hook further down the `prompt.submit` chain rewrites the prompt: this text enters the session. */
  rewrite?: (text: string) => string
  /** The name of the command whose registration the engine rejects. */
  deniedCommand?: string
  /** How many of the next rail writes the engine will reject (DENIED). */
  deniedWrites: number
  /** The running turn of the main agent: its `turnId`; null — no turn is running. */
  turnId: string | null
  /** A hold on the transcript read (`gateMessages`): the answer is already taken but not yet returned. */
  holdMessages?: () => Promise<void>
  /** A hold on the bottom of the `turn.complete` chain (`gateComplete`). */
  holdComplete?: () => Promise<void>
  /**
   * Counters of the plugin's calls to the world; `set` — attempts to write the rail, rejected ones included;
   * `invalidate` — requests to redraw the rows.
   */
  calls: { sessionId: number; messages: number; set: number; invalidate: number }
  /** The commands the plugin registered (`$.command.register`), in order. */
  commands: CommandSpec[]
  /** The lines the plugin wrote to the log (`$.ui.log`), in order. */
  logs: { text: string; to: string }[]
}

export function newWorld(sessionId: string, messages: SessionMessage[] = []): World {
  return {
    sessionId,
    messages,
    deniedWrites: 0,
    turnId: null,
    calls: { sessionId: 0, messages: 0, set: 0, invalidate: 0 },
    commands: [],
    logs: [],
  }
}

let nextUse = 0

/** A `user` record with text: a human prompt or a service record of the engine. */
export function human(text: string): SessionMessage {
  return { role: 'user', text, toolUses: [] }
}

/** An `assistant` record with text, without calls (`''` — thinking). */
export function reply(text = 'ok'): SessionMessage {
  return { role: 'assistant', text, toolUses: [] }
}

/** A tool call: the name and the fields the test sets. */
export type Call = Pick<ToolUseSummary, 'tool'> & Partial<ToolUseSummary>

/**
 * An `assistant` record with tool calls. The call text is `ok` by default, `Exit code 1` for a call with `isError`.
 */
export function tools(...calls: Call[]): SessionMessage {
  return {
    role: 'assistant',
    text: '',
    toolUses: calls.map((call) => ({
      tool_use_id: `toolu_${++nextUse}`,
      input: {},
      text: call.isError === true ? 'Exit code 1' : 'ok',
      ...call,
    })),
  }
}

/** An `assistant` record with one tool call; `isError` — a call with an error. */
export function tool(name: string, input: Record<string, unknown> = {}, isError = false): SessionMessage {
  return tools({ tool: name, input, ...(isError ? { isError: true } : {}) })
}

/** A `user` record with the result of the last call (`tools`, `tool`); `isError` — a call with an error. */
export function results(isError = false): SessionMessage {
  return {
    role: 'user',
    text: '',
    toolUses: [],
    toolResults: [{ tool_use_id: `toolu_${nextUse}`, text: isError ? 'Exit code 1' : 'ok', isError }],
  }
}

/** A turn summary without calls, with overridden fields. */
export function summary(fields: Partial<TurnSummary> = {}): TurnSummary {
  return { tools: 0, edits: 0, agents: 0, skills: [], errors: 0, interrupted: false, ...fields }
}

// The transcript records below are in the form `$.session.messages()` returned them in the experiment of task 2
// (the logs `sr-spike.part1.log`, `sr-spike.part2.log`).

/** The transcript record after a turn interrupted with Esc (E5). */
export const INTERRUPTED = '[Request interrupted by user]'

/** The transcript record after a denied permission (E5). */
export const INTERRUPTED_FOR_TOOL = '[Request interrupted by user for tool use]'

/** The notification that a background task ended: starts a turn without a bar. */
export const NOTIFICATION =
  '<task-notification>\n<task-id>abd93b84f7166c728</task-id>\n<status>completed</status>\n<summary>Agent "md files" finished</summary>\n</task-notification>'

/** The record of the local command `/compact`. */
export const COMPACT_COMMAND =
  '<command-name>/compact</command-name>\n            <command-message>compact</command-message>\n            <command-args></command-args>'

/** The `/compact` output, with the colour control sequences, as recorded. */
export const COMPACT_STDOUT = '<local-command-stdout>\u001b[2mCompacted (ctrl+o to see full summary)\u001b[22m</local-command-stdout>'

/** The `/compact` summary: starts a turn without a bar. */
export const COMPACT_SUMMARY =
  'This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.\n\nSummary: …'

/** A prompt with an expanded text paste (E5). */
export const PASTED =
  '\n\n<pasted_content id="225b">\nPasted line number 1\nPasted line number 2\n</pasted_content id="225b">\n\nhow many lines are in the paste? answer with a number'

/** A prompt with an image tag. */
export const IMAGE = '[Image #2] what is in the picture? answer in one word'

/** The world under the plugin as the test sees it: the clock and the written rail. */
export type Stage = {
  /** The world's clock: a deferred write waits for `settle()`, a retry — for `advance(50)`. */
  clock: MockClock
  /** The rail of the last write that landed in `$.state`; undefined — there were no writes. */
  last: () => RailState | undefined
  /** All the rail writes that landed, in order. */
  all: () => RailState[]
}

/**
 * The stubs of the world and the bottom of the event chains. The test's `$` has no `state`: the plugin's writes are
 * seen through the `state.set` hook under it, and there the engine rejects `deniedWrites` writes.
 */
export function stage(on: On, world: World): Stage {
  const clock = mock.clock(on)
  const rails: RailState[] = []

  on('state.set', { plugin: 'tail-feed', key: 'rail' }, async (_, e, next) => {
    world.calls.set++

    if (world.deniedWrites > 0) {
      world.deniedWrites--

      return { deny: DENIED }
    }

    const result = await next(e)

    if (result.value?.isSet === true) {
      rails.push(e.value.value)
    }

    return result
  })

  on('state.get', { plugin: 'tail-feed', key: 'rail' }, (_, e, next) =>
    world.isStateBroken ? { deny: 'state is gone' } : next(e),
  )

  on('session.id', () => {
    world.calls.sessionId++

    return world.isIdBroken ? { deny: 'no session' } : { value: world.sessionId }
  })

  on('session.messages', async () => {
    world.calls.messages++

    const value = [...world.messages]
    await world.holdMessages?.()

    return world.isMessagesBroken ? { deny: 'transcript is gone' } : { value }
  })

  on('ui.invalidate', (_, e, next) => {
    world.calls.invalidate++

    return next(e)
  })

  on('command.register', (_, e) => {
    world.commands.push(e)

    return e.name === world.deniedCommand ? { deny: 'command name taken' } : { value: { command: e.name } }
  })

  on('ui.log', (_, e) => {
    world.logs.push({ text: e.text, to: e.to })

    return { value: undefined }
  })

  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('prompt.submit', (_, e) => ({ text: world.rewrite?.(e.text) ?? e.text }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', async () => {
    await world.holdComplete?.()

    return { text: '' }
  })

  return { clock, last: () => rails.at(-1), all: () => rails }
}

/**
 * The rail value in `$.state` before the plugin loaded (written before a mod reload or by another version, with the
 * shape tag `shape`): a read gets it until the plugin has written anything. Version 0, as for an unwritten value, —
 * the plugin's first write will land. The function is read on every read: the test changes the rail between the
 * draws of the strip.
 */
export function seedRail(on: On, value: RailState | (() => RailState), shape = RAIL_SHAPE): void {
  on('state.get', { plugin: 'tail-feed', key: 'rail' }, async (_, e, next) => {
    const stored = await next(e)
    const seeded = typeof value === 'function' ? value() : value

    return stored.value?.version === 0 ? { value: { value: { shape, value: seeded }, version: 0 } } : stored
  })
}

/**
 * The fold of the rail by its own button in `$.state` (`tail-feed.folded`), as the test sees it: `writes` — the
 * writes that landed, in order, `denied` — how many of the next writes the engine will reject, `isBroken` — the read
 * denies.
 */
export type FoldWatch = { writes: boolean[]; denied: number; isBroken: boolean }

/**
 * The stubs of `tail-feed.folded`: the writes are seen in `writes`, `denied` writes are rejected; `seeded` — the
 * value before the first write (by default there is none — the rail is unfolded), the function is read on every
 * read.
 */
export function watchFold(on: On, seeded?: boolean | (() => boolean)): FoldWatch {
  const watch: FoldWatch = { writes: [], denied: 0, isBroken: false }

  on('state.set', { plugin: 'tail-feed', key: 'folded' }, async (_, e, next) => {
    if (watch.denied > 0) {
      watch.denied--

      return { deny: DENIED }
    }

    const result = await next(e)

    if (result.value?.isSet === true) {
      watch.writes.push(e.value)
    }

    return result
  })

  on('state.get', { plugin: 'tail-feed', key: 'folded' }, async (_, e, next) => {
    if (watch.isBroken) {
      return { deny: 'state is gone' }
    }

    const stored = await next(e)
    const value = typeof seeded === 'function' ? seeded() : seeded

    return value !== undefined && stored.value?.version === 0 ? { value: { value, version: 0 } } : stored
  })

  return watch
}

/** A hold the test arms (`arm`) and releases (`release`); `reached` — it has been reached. */
export type Gate = { arm: () => void; reached: Promise<void>; release: () => void }

/** A hold and its waiting point (`hold`) for a stub: waits once after `arm()`. */
function newGate(): Gate & { hold: () => Promise<void> } {
  let isArmed = false
  let onReached: () => void = () => {}
  let onRelease: () => void = () => {}
  const reached = new Promise<void>((resolve) => {
    onReached = resolve
  })
  const released = new Promise<void>((resolve) => {
    onRelease = resolve
  })

  return {
    arm: () => {
      isArmed = true
    },
    reached,
    release: () => onRelease(),
    hold: async () => {
      if (isArmed) {
        isArmed = false
        onReached()
        await released
      }
    },
  }
}

/** Hold the first rail write after `arm()` until the test releases it. */
export function gateWrite(on: On): Gate {
  const gate = newGate()

  on('state.set', { plugin: 'tail-feed', key: 'rail' }, async (_, e, next) => {
    await gate.hold()

    return next(e)
  })

  return gate
}

/**
 * Hold the first transcript read after `arm()`: the records are already taken from the world, the plugin gets them
 * when the test releases the hold.
 */
export function gateMessages(world: World): Gate {
  const gate = newGate()
  world.holdMessages = gate.hold

  return gate
}

/** Hold the bottom of the chain of the first `turn.complete` after `arm()`: the plugin's hook waits for `next(e)`. */
export function gateComplete(world: World): Gate {
  const gate = newGate()
  world.holdComplete = gate.hold

  return gate
}

/**
 * The engine draws the feed row `UserMessage` (`requestId` — `id`) on the surface `surface`. The deferred
 * write stays waiting for the clock.
 */
export async function render(
  $: Engine,
  id: string,
  text: string,
  origin: PromptOrigin = COMPOSER,
  surface: 'terminal' | 'desktop' = 'terminal',
): Promise<void> {
  await $.ui.render({
    surface,
    component: 'UserMessage',
    requestId: id,
    viewport: VIEWPORT,
    props: { text, origin, isExpanded: false },
  })
}

/** A feed row the test holds (`mountRow`). */
export type MountedRow = Mounted<'terminal' | 'desktop', 'UserMessage'>

/**
 * The engine draws the feed row `UserMessage` (`requestId` — `id`) on the surface `surface` in the viewport
 * `viewport` and keeps it on screen: the test reads its tree (`drawn`, `findAll`), and a write of the rail the hook
 * read redraws it, as in a session. The deferred write the draw scheduled waits for the clock.
 */
export function mountRow(
  $: Engine,
  id: string,
  text: string,
  origin: PromptOrigin = COMPOSER,
  surface: 'terminal' | 'desktop' = 'terminal',
  viewport: RenderViewport = VIEWPORT,
): Promise<MountedRow> {
  return $.ui.mount({
    plugin: 'tail-feed',
    surface,
    component: 'UserMessage',
    requestId: id,
    viewport,
    props: { text, origin, isExpanded: false },
  })
}

/**
 * The jump mark above the row: the `Text` whose text starts with MARK (the outer one, with the parts inside); none —
 * undefined.
 */
export async function markOf(ui: MountedRow): Promise<FoundElement | undefined> {
  return (await ui.findAll({ type: 'Text', text: new RegExp(`^${MARK}`) }))[0]
}

/** The row is drawn, and the deferred write it scheduled has gone through. */
export async function draw(
  $: Engine,
  rail: Stage,
  id: string,
  text: string,
  origin: PromptOrigin = COMPOSER,
  surface: 'terminal' | 'desktop' = 'terminal',
): Promise<void> {
  await render($, id, text, origin, surface)
  await rail.clock.settle()
}

/**
 * The human submitted a prompt (`prompt.submit`); during a turn it waits or goes into the running turn. `turnId` —
 * the turn the prompt was typed over, as the engine names it.
 */
export async function submit($: Engine, text: string, origin: PromptOrigin = COMPOSER, turnId?: string): Promise<void> {
  await $.prompt.submit({ text, wait: false, origin, ...(turnId === undefined ? {} : { turnId }) })
}

/**
 * A prompt delivered into the running turn (E5): the submit, two temporary rows and the final one `id`, all during
 * the turn.
 */
export async function deliver($: Engine, rail: Stage, id: string, text: string): Promise<void> {
  await submit($, text)
  await draw($, rail, `${id}-tmp-1`, text)
  await draw($, rail, `${id}-tmp-2`, text)
  await draw($, rail, id, text)
}

let nextTurn = 0

/** A turn of the main agent (`agentId` not set) or of a subagent started. */
export async function startTurn($: Engine, world: World, text: string, agentId?: string): Promise<void> {
  const turnId = `turn-${++nextTurn}`

  if (agentId === undefined) {
    world.turnId = turnId
  }

  await $.turn.start({ text, turnId, ...(agentId === undefined ? {} : { agentId }) })
}

/**
 * The main agent's turn ended with the reason `reason`, and the work its end scheduled has gone through.
 */
export async function completeTurn(
  $: Engine,
  world: World,
  rail: Stage,
  reason: TurnCompleteReason = 'answer',
): Promise<void> {
  const turnId = world.turnId ?? 'turn-none'
  const fields = { answer: '', durationMs: 1, isAborted: reason === 'aborted', turnId }

  world.turnId = null
  await $.turn.complete(
    reason === 'refusal'
      ? { ...fields, reason, refusal: { category: null, explanation: null } }
      : { ...fields, reason },
  )
  await rail.clock.settle()
}

/** The session started (`session.start`): the first load of the mod. */
export async function startSession($: Engine, rail: Stage): Promise<void> {
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await rail.clock.settle()
}

/**
 * The feed changed (`/clear`, `/resume`): `session.end` of the leaving session, then the session id — `next`,
 * the transcript — `messages`.
 */
export async function changeSession(
  $: Engine,
  world: World,
  rail: Stage,
  reason: Extract<SessionEndReason, 'clear' | 'resume'>,
  next: string,
  messages: SessionMessage[] = [],
): Promise<void> {
  await $.session.end({ reason, sessionId: world.sessionId, resume: { id: world.sessionId } })
  world.sessionId = next
  world.messages = messages
  await rail.clock.settle()
}
