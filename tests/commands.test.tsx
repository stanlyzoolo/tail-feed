import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { COMMAND_FORMS, COMMAND_HINT, foldNote, replyOf } from '../hooks/lib'
import type { Bar, RailState } from '../types'
import {
  completeTurn,
  COMPOSER,
  DENIED,
  human,
  newWorld,
  render,
  reply,
  seedRail,
  stage,
  startSession,
  startTurn,
  watchFold,
} from './world'
import type { World } from './world'

// The mod's `$.ui.scroll` cannot be replaced in the harness (`CLAUDE.md`, "Tests"): the call throws
// `no implementation for ui.scroll`, and `jump` answers with a deny. So here the jump is always denied, and the
// command's target shows as the bar number in the deny reply. A successful jump without text and the target of each
// argument form are in `lib-layout.test.ts` (`aimCommand`, `jumpReply`).

/** The deny reply that `jump` turns a failed call in the harness into. */
const DENIED_JUMP = /^didn't jump to #(\d+): .*ui\.scroll/

/** Bars r1…r5 with prompt texts; the reading bar is r3 (the bar of the last jump). */
const BARS: Bar[] = [
  { id: 'r1', text: 'review the plan', summary: null },
  { id: 'r2', text: 'fix the tests', summary: null },
  { id: 'r3', text: 'one more review, now of the code', summary: null },
  { id: 'r4', text: 'thanks', summary: null },
  { id: 'r5', text: 'run the checks', summary: null },
]

/** The rail in `$.state`: the bars of BARS, the reading bar is r3; fields are overridden. */
function stored(fields: Partial<RailState> = {}): RailState {
  return { bars: BARS, older: 0, current: 'r3', ...fields }
}

/** A world with the rail in `$.state` and a bottom of the `command.run` chain standing in for the core. */
function setup(on: On, seeded: RailState | (() => RailState) = stored()) {
  const world = newWorld('sess-cmd')
  const rail = stage(on, world)
  const beneath: string[] = []

  seedRail(on, seeded)
  on('command.run', (_, e) => {
    beneath.push(e.command)

    return { text: `core: /${e.command}` }
  })

  return { world, rail, beneath }
}

/** The human typed `/<command> <args>` in the prompt input, in fullscreen. */
function run($: Engine, command: string, args = '') {
  return $.command.run({ command, args, origin: COMPOSER, presentation: { isFullscreen: true, columns: 120 } })
}

/** The number of the bar the command tried to jump to; null — there was no jump. */
async function target($: Engine, command: string, args = ''): Promise<number | null> {
  const { text } = await run($, command, args)
  const n = DENIED_JUMP.exec(text ?? '')?.[1]

  return n === undefined ? null : Number(n)
}

test('the start registers four commands, all immediate: the jump and the fold by key work during a turn too', async ($, on) => {
  const { world, rail } = setup(on)

  await startSession($, rail)

  expect(world.commands.map((spec) => [spec.name, spec.immediate])).toEqual([
    ['tail-feed', true],
    ['tail-feed-next', true],
    ['tail-feed-prev', true],
    ['tail-feed-toggle', true],
  ])
  expect(world.commands[0]?.argumentHint).toBe(COMMAND_HINT)
  expect(world.commands.map((spec) => spec.description)).toEqual([
    'Tail feed: jump to a prompt, collapse or expand the rail, or help without arguments',
    'Tail feed: jump to the next prompt',
    'Tail feed: jump to the previous prompt',
    'Tail feed: collapse the rail to one line or expand it',
  ])
})

test('the engine denied registering one command — the rest are registered, the transcript is read', async ($, on) => {
  const { world, rail } = setup(on)
  world.deniedCommand = 'tail-feed-next'

  await startSession($, rail)

  expect(world.commands.map((spec) => spec.name)).toEqual(['tail-feed', 'tail-feed-next', 'tail-feed-prev', 'tail-feed-toggle'])
  expect(world.calls.messages).toBe(1)
})

test('the harness does not replace ui.scroll of the mod: the jump checks rest on this', async ($, on) => {
  setup(on)

  // If this test fails, the harness has learned to replace `$.ui.scroll`: rewrite the jump checks (here, in
  // rail.test.tsx and in `CLAUDE.md`, "Tests") to use the replacement and check a successful jump directly.
  const { text } = await run($, 'tail-feed', '1')

  expect(text).toContain('no implementation for ui.scroll')
})

test('each argument form jumps to its own bar', async ($, on) => {
  setup(on)

  expect(await target($, 'tail-feed', 'first')).toBe(1)
  expect(await target($, 'tail-feed', 'last')).toBe(5)
  expect(await target($, 'tail-feed', 'next')).toBe(4)
  expect(await target($, 'tail-feed', 'prev')).toBe(2)
  expect(await target($, 'tail-feed', '2')).toBe(2)
  expect(await target($, 'tail-feed', '#5')).toBe(5)
  expect(await target($, 'tail-feed', 'find REVIEW')).toBe(3)
  expect(await target($, 'tail-feed', 'find plan review')).toBe(1)
})

test('the commands without an argument equal next and prev', async ($, on) => {
  setup(on)

  expect(await target($, 'tail-feed-next')).toBe(4)
  expect(await target($, 'tail-feed-prev')).toBe(2)
  expect(await run($, 'tail-feed-next')).toEqual(await run($, 'tail-feed', 'next'))
  expect(await run($, 'tail-feed-prev')).toEqual(await run($, 'tail-feed', 'prev'))
})

test('toggle and /tail-feed-toggle fold and unfold the rail: folded is written from the last value, the reply has no text, there is no jump', async ($, on) => {
  const { beneath } = setup(on)
  const fold = watchFold(on)

  expect(await run($, 'tail-feed', 'toggle')).toEqual({})
  expect(await run($, 'tail-feed-toggle')).toEqual({})
  expect(await run($, 'tail-feed', 'TOGGLE')).toEqual({})
  // An argument after a command without an argument is not read, as with next and prev.
  expect(await run($, 'tail-feed-toggle', '3')).toEqual({})

  expect(fold.writes).toEqual([true, false, true, false])
  expect(beneath).toEqual([])
})

test('toggle does not read the rail: the rail cannot be read — the rail folds anyway', async ($, on) => {
  const { world } = setup(on)
  const fold = watchFold(on)
  world.isStateBroken = true

  expect(await run($, 'tail-feed-toggle')).toEqual({})
  expect(fold.writes).toEqual([true])
  // The jump needs the rail: its command answers with the read failure.
  expect((await run($, 'tail-feed', 'next')).text).toMatch(/^rail unavailable: /)
})

test('the folded write is denied — a failure reply for the human only and a line in the debug log, the view stays the same', async ($, on) => {
  const { world } = setup(on)
  const fold = watchFold(on)
  fold.denied = 1

  const result = await run($, 'tail-feed', 'toggle')
  // The error text is as the engine gave it: the write denial wrapped in the call name.
  const error = /^didn't toggle the rail: (.*)$/.exec(result.text ?? '')?.[1] ?? ''

  expect(error).toContain(DENIED)
  expect(result).toEqual(replyOf(`didn't toggle the rail: ${error}`))
  expect(world.logs).toEqual([{ text: foldNote(error), to: 'debug' }])
  expect(fold.writes).toEqual([])

  // The next toggle is applied to the previous value: the rail folds.
  expect(await run($, 'tail-feed-toggle')).toEqual({})
  expect(fold.writes).toEqual([true])
})

test('a denied jump — the deny text in a reply for the human only and in the debug log, current does not change', async ($, on) => {
  const { world } = setup(on)

  const result = await run($, 'tail-feed', '1')

  expect(result.text).toMatch(DENIED_JUMP)
  expect(result.isTextDisplayOnly).toBe(true)
  expect(world.logs.map((line) => line.to)).toEqual(['debug'])
  expect(world.logs[0]?.text).toMatch(/^tail-feed: didn't jump to row r1: .*ui\.scroll/)
  // The rail is not written: the reading bar is the same, the next step goes from it.
  expect(world.calls.set).toBe(0)
  expect(await target($, 'tail-feed', 'next')).toBe(4)
})

test('the edge of the feed, a bad number, words not found, garbage — a clear reply without a jump', async ($, on) => {
  let seeded = stored({ current: 'r5' })
  const { world } = setup(on, () => seeded)

  expect(await run($, 'tail-feed', 'next')).toEqual(replyOf('#5 is the last in the rail'))
  expect(await run($, 'tail-feed-next')).toEqual(replyOf('#5 is the last in the rail'))

  seeded = stored({ current: 'r1', older: 4 })
  expect(await run($, 'tail-feed', 'prev')).toEqual(replyOf('#1 is the first in the rail; 4 older turns above without a bar'))
  expect(await run($, 'tail-feed-prev')).toEqual(replyOf('#1 is the first in the rail; 4 older turns above without a bar'))

  expect(await run($, 'tail-feed', '9')).toEqual(replyOf('no prompt #9: the rail has 5 bars'))
  expect(await run($, 'tail-feed', '#0')).toEqual(replyOf('no prompt #0'))
  expect(await run($, 'tail-feed', 'find deploy')).toEqual(replyOf('not found: "deploy"'))
  expect(await run($, 'tail-feed', 'down')).toEqual(replyOf(`didn't understand "down": /tail-feed ${COMMAND_FORMS}`))
  expect(await run($, 'tail-feed', 'find')).toEqual(replyOf('find needs words: /tail-feed find <words>'))
  expect(world.calls.set).toBe(0)
})

test('an empty feed — nowhere to jump; without an argument — help', async ($, on) => {
  let seeded = stored({ bars: [], current: null })
  setup(on, () => seeded)

  for (const args of ['next', 'prev', 'first', 'last', '1', 'find review']) {
    expect(await run($, 'tail-feed', args)).toEqual(replyOf('no bars — nowhere to jump'))
  }

  expect(await run($, 'tail-feed-next')).toEqual(replyOf('no bars — nowhere to jump'))
  expect(await run($, 'tail-feed')).toEqual(replyOf(`no bars. /tail-feed ${COMMAND_FORMS}`))

  seeded = stored()
  expect(await run($, 'tail-feed')).toEqual(replyOf(`5 bars, reading #3. /tail-feed ${COMMAND_FORMS}`))
})

test('the rail cannot be read from $.state — the command answers why instead of going to the core', async ($, on) => {
  const { world, beneath } = setup(on)
  world.isStateBroken = true

  const result = await run($, 'tail-feed', 'next')

  expect(result.text).toMatch(/^rail unavailable: /)
  expect(result.isTextDisplayOnly).toBe(true)
  expect(beneath).toEqual([])
})

test('the mod does not touch other commands and does not let its own go further down', async ($, on) => {
  const { beneath } = setup(on)

  expect(await run($, 'compact')).toEqual({ text: 'core: /compact' })
  expect(await run($, 'tail-feed-other', 'next')).toEqual({ text: 'core: /tail-feed-other' })
  await run($, 'tail-feed', 'next')
  await run($, 'tail-feed-prev')
  expect(beneath).toEqual(['compact', 'tail-feed-other'])
})

test('a command of the mod gives no bar: its row is only a placeholder, it does not get into the transcript', async ($, on) => {
  const world: World = newWorld('sess-own', [human('first prompt'), reply()])
  const rail = stage(on, world)
  on('command.run', () => ({ text: 'core' }))

  await startSession($, rail)
  await render($, 'r1', 'first prompt')
  await rail.clock.settle()
  expect(rail.last()?.bars.map((bar) => bar.id)).toEqual(['r1'])

  // The engine draws the typed command under `placeholder` (E5), then runs it.
  await render($, 'placeholder', '/tail-feed first')
  await run($, 'tail-feed', 'first')
  await startTurn($, world, 'second prompt')
  await render($, 'r2', 'second prompt')
  world.messages.push(human('second prompt'), reply())
  await completeTurn($, world, rail)

  expect(rail.last()?.bars.map((bar) => bar.id)).toEqual(['r1', 'r2'])
  expect(rail.last()?.bars.map((bar) => bar.text)).not.toContain('/tail-feed first')
})
