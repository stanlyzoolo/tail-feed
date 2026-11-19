import type { RenderPropsOf, RenderViewport } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { FoundElement, Mounted } from 'claude-code/testing'

import {
  BAR_COLORS,
  BAR_TEXT_MAX,
  BAR_WIDTH,
  barText,
  CARD_ROWS,
  cardLines,
  POINTERS,
  coverLines,
  EMPTY_RAIL,
  fitBars,
  FOLD_WIDTH,
  foldedLine,
  foldLabel,
  GAP,
  GLYPHS,
  headerParts,
  jumpNote,
  KIND_COLORS,
  KIND_NAMES,
  kindOf,
  MAX_BARS,
  RAIL_SHAPE,
  textWidth,
  TOP_ROWS,
} from '../hooks/lib'
import type { BarKind, CardLines, LineItem } from '../hooks/lib'
import { barKey, FOLD_KEY, hoverKey, railRow, scopeOf } from '../hooks/rail'
import type { Bar, RailState, TurnSummary } from '../types'
import { markOf, mountRow, newWorld, PASTED, render, seedRail, stage, summary, VIEWPORT, watchFold } from './world'

const BAND_PROPS: RenderPropsOf['AbovePrompt'] = {
  hasSurvey: false,
  isCollapsed: false,
  isWorking: false,
  maxRows: 20,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 19 },
  view: {},
}

/** The tail-feed row of the strip, as the engine asks for it. */
function band(props: Partial<RenderPropsOf['AbovePrompt']> = {}, viewport: RenderViewport = VIEWPORT) {
  return {
    plugin: 'tail-feed',
    component: 'AbovePrompt',
    requestId: 'above-prompt',
    viewport,
    props: { ...BAND_PROPS, ...props },
  } as const
}

/** The bar `id` with the prompt text `prompt <id>`; the default summary is talk. */
function bar(id: string, fields: Partial<TurnSummary> | null = {}): Bar {
  return { id, text: `prompt ${id}`, summary: fields === null ? null : summary(fields) }
}

/** The rail in `$.state`. */
function rail(bars: Bar[], fields: Partial<RailState> = {}): RailState {
  return { bars, older: 0, current: null, ...fields }
}

/** Bars r1…rN — talk. */
function talks(count: number): Bar[] {
  return Array.from({ length: count }, (_, i) => bar(`r${i + 1}`))
}

/** The bar buttons of the rail in order: all buttons except the fold button. */
async function barsOf(ui: Mounted<'terminal', 'AbovePrompt'>): Promise<FoundElement[]> {
  return (await ui.findAll({ type: 'Button' })).filter((button) => button.key !== FOLD_KEY)
}

/** The fold button of the rail (`[-]`, `[+]`); no rail — undefined. */
async function foldOf(ui: Mounted<'terminal', 'AbovePrompt'>): Promise<FoundElement | undefined> {
  return (await ui.findAll({ type: 'Button' })).find((button) => button.key === FOLD_KEY)
}

/** The style of the bar glyph: the props of the `Text` inside the button. */
function styleOf(button: FoundElement | undefined): Record<string, unknown> | undefined {
  const [glyph] = button?.children ?? []

  return (glyph as { props?: Record<string, unknown> } | undefined)?.props
}

/**
 * An element of the drawn tree (`drawn()`): `hover` lies next to the props in it, and `find` does not return it.
 */
type Drawn = { type: string; props?: Record<string, unknown>; hover?: Record<string, unknown>; children?: unknown[] }

/** All `Box` nodes of the drawn tree in document order, outer ones first. */
function boxesOf(node: unknown): Drawn[] {
  return nodesOf(node, 'Box')
}

/** All nodes of type `type` of the drawn tree in document order, outer ones first. */
function nodesOf(node: unknown, type: string): Drawn[] {
  if (typeof node !== 'object' || node === null) {
    return []
  }

  const element = node as Drawn
  const inner = (element.children ?? []).flatMap((child) => nodesOf(child, type))

  return element.type === type ? [element, ...inner] : inner
}

/** The hover areas of the bars: a `Box` with the key `hover:<id>`. */
function areasOf(tree: unknown): Drawn[] {
  return boxesOf(tree).filter((box) => String(box.props?.key ?? '').startsWith('hover:'))
}

/** The hidden cards of the rail: a `Box` with `position: "absolute"` in the card rows. */
function cardsOf(tree: unknown): Drawn[] {
  return boxesOf(tree).filter((box) => box.props?.position === 'absolute')
}

/** The text of a node of the drawn tree: the strings of all descendants in a row. */
function textOf(node: unknown): string {
  if (typeof node === 'string') {
    return node
  }

  if (typeof node !== 'object' || node === null) {
    return ''
  }

  return ((node as Drawn).children ?? []).map(textOf).join('')
}

/** The card lines: the text of each `Text` in it, nested ones included. */
function linesOf(card: Drawn | undefined): string[] {
  return (card?.children ?? []).map(textOf)
}

/** The card lines from `cardLines`, as on the screen: the first and the second. */
function textLines(lines: CardLines): string[] {
  return [lines.head, lines.name + lines.prompt]
}

/** The kind name in the second line of the card: the nested `Text` with a colour. */
function nameOf(card: Drawn | undefined): Drawn | undefined {
  return ((card?.children?.[1] as Drawn | undefined)?.children ?? []).find((part): part is Drawn => typeof part === 'object')
}

/** The bar line: a `Box` whose direct children are gap cells, counters and the hover areas of the bars. */
function barLineOf(tree: unknown): Drawn | undefined {
  return boxesOf(tree).find((box) => (box.children ?? []).some((child) => String((child as Drawn).props?.key ?? '').startsWith('hover:')))
}

/** The bar line as text, as on the screen: gaps, counters, bars. */
function lineOf(tree: unknown): string {
  return textOf(barLineOf(tree))
}

/** The tail-feed row: a column `Box` whose direct child is the bar line. */
function railOf(tree: unknown): Drawn | undefined {
  const line = barLineOf(tree)

  return line === undefined ? undefined : boxesOf(tree).find((box) => (box.children ?? []).includes(line))
}

/** The header line: the first child of the rail. */
function headerOf(tree: unknown): Drawn | undefined {
  return railOf(tree)?.children?.[0] as Drawn | undefined
}

/** The card rows: the third child of the rail, the place of all cards. */
function cardPlaceOf(tree: unknown): Drawn | undefined {
  return railOf(tree)?.children?.[2] as Drawn | undefined
}

/** The visible card — the card of the reading bar: the first child of the card rows, in the flow. */
function shownOf(tree: unknown): Drawn | undefined {
  const first = cardPlaceOf(tree)?.children?.[0] as Drawn | undefined

  return first?.props?.position === undefined ? first : undefined
}

/** The key of the hover area of the bar that stands between the pointers ▸ and ◂; no pointers — undefined. */
function readOf(tree: unknown): string | undefined {
  const cells = (barLineOf(tree)?.children ?? []) as Drawn[]
  const at = cells.findIndex((cell) => textOf(cell) === POINTERS.left)

  return at >= 0 && textOf(cells[at + 2]) === POINTERS.right ? String(cells[at + 1]?.props?.key) : undefined
}

const KINDS: [BarKind, Partial<TurnSummary> | null][] = [
  ['edit', { tools: 2, edits: 1 }],
  ['agent', { tools: 1, agents: 1 }],
  ['skill', { tools: 1, skills: ['review'] }],
  ['work', { tools: 3 }],
  ['talk', {}],
  ['unknown', null],
]

test('six bar kinds: the kind glyph twice in the kind colour in a plain button of two cells, the keys of the button and of the hover area differ', async ($, on) => {
  const bars = KINDS.map(([kind, fields]) => bar(kind, fields))
  seedRail(on, rail(bars))

  const ui = await $.ui.mount({ ...band(), surface: 'terminal' })
  const buttons = await barsOf(ui)

  expect(buttons.map((button) => button.props.label)).toEqual(KINDS.map(([kind]) => GLYPHS[kind].repeat(BAR_WIDTH)))
  expect(buttons.map((button) => button.text)).toEqual(KINDS.map(([kind]) => `${GLYPHS[kind]}${GLYPHS[kind]}`))
  expect(buttons.map(styleOf)).toEqual(KINDS.map(([kind]) => ({ color: KIND_COLORS[kind] })))
  expect(buttons.map((button) => button.key)).toEqual(bars.map((item) => barKey(item.id)))
  expect(buttons.every((button) => button.props.plain === true && textWidth(button.text) === 2)).toBe(true)

  const tree = await ui.drawn()
  const areas = areasOf(tree)
  expect(areas.map((box) => box.props?.key)).toEqual(bars.map((item) => hoverKey(item.id)))
  expect(areas.map((box) => box.props?.key)).not.toContain(barKey('edit'))

  // Under the pointer the bar button is not inverted: otherwise `▂▂` "jumps up" and `██` disappears.
  // The fold button is text, its inversion under the pointer stays.
  const drawnButtons = nodesOf(tree, 'Button')
  expect(drawnButtons.filter((button) => button.props?.key !== FOLD_KEY).map((button) => button.hover)).toEqual(
    bars.map(() => ({ inverse: false })),
  )
  expect(drawnButtons.find((button) => button.props?.key === FOLD_KEY)?.hover).toBeUndefined()
  await ui.unmount()
})

test('a flagged turn — red instead of the kind colour; the reading bar is not set apart by colour — neither without a jump nor after one', async ($, on) => {
  const bars = [
    bar('r1', { tools: 2, edits: 1, errors: 1 }),
    bar('r2', { interrupted: true }),
    bar('r3', { tools: 2 }),
    bar('r4', { tools: 1, agents: 1, errors: 2 }),
    bar('r5'),
  ]
  const colors = [
    { color: BAR_COLORS.flagged },
    { color: BAR_COLORS.flagged },
    { color: KIND_COLORS.work },
    { color: BAR_COLORS.flagged },
    { color: KIND_COLORS.talk },
  ]
  let seeded = rail(bars)
  seedRail(on, () => seeded)

  // Without a jump (the reading bar is the newest, r5), after a jump to the flagged r2 and to the plain r3, and when
  // the bar of the jump is no longer in the rail — the colours are the same: the pointers mark the reading bar, not
  // the bar colour.
  for (const [current, reading] of [[null, 'r5'], ['r2', 'r2'], ['r3', 'r3'], ['gone', 'r5']] as const) {
    seeded = rail(bars, { current })
    const ui = await $.ui.mount({ ...band(), surface: 'terminal' })
    expect((await barsOf(ui)).map(styleOf)).toEqual(colors)
    expect(readOf(await ui.drawn())).toBe(hoverKey(reading))
    await ui.unmount()
  }
})

test('pointers: the gap cells on both sides of the reading bar — ▸ and ◂ in the "you are here" colour, the rest — a space; the line starts and ends with a cell', async ($, on) => {
  seedRail(on, rail(talks(5)))

  const ui = await $.ui.mount({ ...band(), surface: 'terminal' })
  const tree = await ui.drawn()
  const cells = (barLineOf(tree)?.children ?? []) as Drawn[]

  // Without a jump the reading bar is the newest, r5: its right pointer is the last cell of the line.
  expect(lineOf(tree)).toBe(' ▂▂ ▂▂ ▂▂ ▂▂▸▂▂◂')
  expect(readOf(tree)).toBe(hoverKey('r5'))

  // A cell before each bar and after the last one: gap, bar, gap, …, gap.
  expect(cells.map((cell) => cell.type)).toEqual(['Text', 'Box', 'Text', 'Box', 'Text', 'Box', 'Text', 'Box', 'Text', 'Box', 'Text'])
  const gaps = cells.filter((cell) => cell.type === 'Text')
  expect(gaps.map(textOf)).toEqual([GAP, GAP, GAP, GAP, POINTERS.left, POINTERS.right])
  expect(gaps.map((cell) => cell.props?.color)).toEqual([undefined, undefined, undefined, undefined, BAR_COLORS.current, BAR_COLORS.current])

  // Pointers — only at the reading bar.
  expect(await ui.findAll({ type: 'Text', text: POINTERS.left })).toHaveLength(1)
  expect(await ui.findAll({ type: 'Text', text: POINTERS.right })).toHaveLength(1)
  await ui.unmount()
})

test('pointers at the reading bar on the edge of the window: next to the counters ‹N and N›, at the edge of the line — in the edge cell', async ($, on) => {
  let seeded = rail(talks(30))
  seedRail(on, () => seeded)

  // The newest at the right edge: the right pointer is the last cell of the line, ‹25 on the left.
  const tail = await $.ui.mount({ ...band({ bodyColumns: 20 }), surface: 'terminal' })
  expect(lineOf(await tail.drawn())).toBe(' ‹25 ▂▂ ▂▂ ▂▂ ▂▂▸▂▂◂')
  await tail.unmount()

  // A jump to the first: the left pointer is the first cell of the line, 25› on the right.
  seeded = rail(talks(30), { current: 'r1' })
  const head = await $.ui.mount({ ...band({ bodyColumns: 20 }), surface: 'terminal' })
  expect(lineOf(await head.drawn())).toBe('▸▂▂◂▂▂ ▂▂ ▂▂ ▂▂ 25› ')
  await head.unmount()

  // A jump to the middle: the window starts with the reading bar, the left pointer is right after ‹10.
  seeded = rail(talks(30), { current: 'r11' })
  const middle = await $.ui.mount({ ...band({ bodyColumns: 20 }), surface: 'terminal' })
  expect(lineOf(await middle.drawn())).toBe(' ‹10▸▂▂◂▂▂ ▂▂ 17› ')
  expect(readOf(await middle.drawn())).toBe(hoverKey('r11'))
  await middle.unmount()

  // One bar in the window — the reading bar is both first and last: the pointers are between the counters.
  const single = await $.ui.mount({ ...band({ bodyColumns: 12 }), surface: 'terminal' })
  expect(lineOf(await single.drawn())).toBe(' ‹10▸▂▂◂19› ')
  await single.unmount()

  // Turns without rows: the left counter and its cell are there even when all bars are in the window.
  seeded = rail(talks(2), { older: 4, current: 'r1' })
  const older = await $.ui.mount({ ...band(), surface: 'terminal' })
  expect(lineOf(await older.drawn())).toBe(' ‹4▸▂▂◂▂▂ ')
  await older.unmount()
})

test('after a jump the pointers move to the bar of the jump, the width of the bar line stays the same', async ($, on) => {
  let seeded = rail(talks(5))
  seedRail(on, () => seeded)
  const lines: string[] = []

  for (const [current, reading] of [[null, 'r5'], ['r1', 'r1'], ['r3', 'r3'], ['gone', 'r5']] as const) {
    seeded = rail(talks(5), { current })
    const ui = await $.ui.mount({ ...band(), surface: 'terminal' })
    const tree = await ui.drawn()
    expect(readOf(tree)).toBe(hoverKey(reading))
    lines.push(lineOf(tree))
    await ui.unmount()
  }

  expect(lines).toEqual([' ▂▂ ▂▂ ▂▂ ▂▂▸▂▂◂', '▸▂▂◂▂▂ ▂▂ ▂▂ ▂▂ ', ' ▂▂ ▂▂▸▂▂◂▂▂ ▂▂ ', ' ▂▂ ▂▂ ▂▂ ▂▂▸▂▂◂'])
  expect(new Set(lines.map(textWidth))).toEqual(new Set([16]))
})

test('the header — the first line of the rail across the full width of the strip: the [-] button, the title in the text colour, #n/N blue, the line grey; N — bars without older', async ($, on) => {
  seedRail(on, rail(talks(5), { older: 4 }))

  const ui = await $.ui.mount({ ...band(), surface: 'terminal' })
  const tree = await ui.drawn()
  const header = headerOf(tree)
  const [button, title] = (header?.children ?? []) as Drawn[]
  const parts = (title?.children ?? []) as Drawn[]

  // The button (3) + ` Feed · #5/5` (12) + ` ─…─`: the line is 80 − 15 = 65 cells with the space.
  expect(textOf(header)).toBe(`[-] Feed · #5/5 ${'─'.repeat(64)}`)
  expect(textWidth(textOf(header))).toBe(BAND_PROPS.bodyColumns)
  // The line is the button and a `Text` with the parts in a row: does not fit — cut from the end, not wrapped onto a
  // fifth row of the rail.
  expect(header?.type).toBe('Box')
  expect(header?.props?.flexDirection).toBe('row')
  expect(button?.type).toBe('Button')
  expect(title?.type).toBe('Text')
  expect(title?.props?.wrap).toBe('truncate-end')
  expect(parts.map(textOf)).toEqual(headerParts(5, 4, BAND_PROPS.bodyColumns).map((part) => part.text))
  expect(parts.map((part) => part.props?.color)).toEqual([undefined, BAR_COLORS.title, undefined, BAR_COLORS.current, BAR_COLORS.line])
  expect(parts.map((part) => part.props?.weight)).toEqual([undefined, 'bold', undefined, undefined, undefined])
  // The title word is a `Text` of its own: bold, in Claude's peach.
  expect(await ui.find({ type: 'Text', text: /^Feed$/ })).toMatchObject({ props: { color: BAR_COLORS.title, weight: 'bold' } })

  // The fold button is plain, the label `[-]` in the colour of the header lines.
  const fold = await foldOf(ui)
  expect(fold?.props.plain).toBe(true)
  expect(fold?.props.label).toBe(foldLabel(false))
  expect(fold?.text).toBe('[-]')
  expect(styleOf(fold)).toEqual({ color: BAR_COLORS.line })
  await ui.unmount()
})

test('#n/N of the header follows the reading bar: without a jump the newest, after a jump the bar of the jump, no bar of the jump — the newest', async ($, on) => {
  let seeded = rail(talks(5))
  seedRail(on, () => seeded)

  for (const [current, place] of [[null, '#5/5'], ['r1', '#1/5'], ['r3', '#3/5'], ['gone', '#5/5']] as const) {
    seeded = rail(talks(5), { current })
    const ui = await $.ui.mount({ ...band(), surface: 'terminal' })
    const tree = await ui.drawn()
    const header = textOf(headerOf(tree))

    expect(header.startsWith(`[-] Feed · ${place} ─`)).toBe(true)
    expect(textWidth(header)).toBe(BAND_PROPS.bodyColumns)
    // A string `text` matches as a substring: the #n/N part is matched whole, not the outer `Text` of the header.
    expect(await ui.find({ type: 'Text', text: new RegExp(`^${place}$`) })).toMatchObject({ props: { color: BAR_COLORS.current } })
    await ui.unmount()
  }
})

test('a rail of 5 rows: an empty row (the TOP_ROWS padding), the header, the bar line and CARD_ROWS card rows — in a column', async ($, on) => {
  seedRail(on, rail(talks(3)))

  const ui = await $.ui.mount({ ...band(), surface: 'terminal' })
  const tree = await ui.drawn()
  const row = railOf(tree)
  const [header, line, place] = (row?.children ?? []) as Drawn[]

  expect(row?.props?.flexDirection).toBe('column')
  // The empty row above the header is the padding of the rail, not a node: there are still three children.
  expect(TOP_ROWS).toBe(1)
  expect(row?.props?.paddingTop).toBe(TOP_ROWS)
  expect(row?.children).toHaveLength(3)
  expect(header).toBe(headerOf(tree))
  expect(line).toBe(barLineOf(tree))
  expect(place?.props?.height).toBe(CARD_ROWS)

  // The header is the button and a `Text` that cuts the end, the bar line is a row `Box`: one row each, text without
  // line breaks, not wider than the strip.
  expect(header?.type).toBe('Box')
  expect(header?.props?.flexDirection).toBe('row')
  expect((header?.children?.[1] as Drawn | undefined)?.props?.wrap).toBe('truncate-end')
  expect(line?.props?.flexDirection).toBe('row')

  for (const single of [header, line]) {
    expect(textOf(single)).not.toContain('\n')
    expect(textWidth(textOf(single))).toBeLessThanOrEqual(BAND_PROPS.bodyColumns)
  }

  // Rows in the rail: the padding, one for each child except the place of the cards, and its height.
  const others = ((row?.children ?? []) as Drawn[]).filter((child) => child !== place)
  expect(TOP_ROWS + others.length + Number(place?.props?.height)).toBe(5)
  await ui.unmount()
})

test('the bar line and the header at widths 0…60: the bars are not wider than the strip, the pointers are at the reading bar, the header is full width; no window — neither rail nor header', async ($, on) => {
  seedRail(on, rail(talks(30), { older: 2, current: 'r11' }))

  for (let columns = 0; columns <= 60; columns++) {
    const ui = await $.ui.mount({ ...band({ bodyColumns: columns }), surface: 'terminal' })
    const tree = await ui.drawn()
    const window = fitBars(30, 10, columns, 2)

    if (window.from === window.to) {
      expect(await ui.find({ type: 'Button' })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: /─/ })).toBeUndefined()
    } else {
      expect(textWidth(lineOf(tree))).toBeLessThanOrEqual(columns)
      expect(readOf(tree)).toBe(hoverKey('r11'))
      // The header is exactly full width; #n/N follows the reading bar while it fits.
      expect(textOf(headerOf(tree))).toBe(foldLabel(false) + headerParts(30, 10, columns).map((part) => part.text).join(''))
      expect(textWidth(textOf(headerOf(tree)))).toBe(columns)
    }

    await ui.unmount()
  }
})

test('counters: the left one — hidden on the left together with older, the right one — hidden on the right', async ($, on) => {
  const bars = talks(30)
  let seeded = rail(bars, { older: 5 })
  seedRail(on, () => seeded)

  // The reading bar is the newest: the window is at the right edge, `from` bars and 5 turns without rows are hidden on
  // the left.
  const right = fitBars(30, 29, 20, 5)
  expect(right.from).toBeGreaterThan(0)
  const tail = await $.ui.mount({ ...band({ bodyColumns: 20 }), surface: 'terminal' })
  expect(await barsOf(tail)).toHaveLength(right.to - right.from)
  expect(await tail.find({ type: 'Text', text: `‹${right.from + 5}` })).toBeDefined()
  expect(await tail.find({ type: 'Text', text: /›$/ })).toBeUndefined()
  await tail.unmount()

  // A jump to the first: only 5 turns without rows on the left, the rest of the bars on the right.
  seeded = rail(bars, { older: 5, current: 'r1' })
  const left = fitBars(30, 0, 20, 5)
  const head = await $.ui.mount({ ...band({ bodyColumns: 20 }), surface: 'terminal' })
  expect((await barsOf(head))[0]?.key).toBe(barKey('r1'))
  expect(await head.find({ type: 'Text', text: /^‹5$/ })).toBeDefined()
  expect(await head.find({ type: 'Text', text: `${30 - left.to}›` })).toBeDefined()
  await head.unmount()

  // All bars are in the window: the left counter still shows the turns without rows.
  seeded = rail(talks(3), { older: 4 })
  const all = await $.ui.mount({ ...band(), surface: 'terminal' })
  expect(await barsOf(all)).toHaveLength(3)
  expect(await all.find({ type: 'Text', text: /^‹4$/ })).toBeDefined()
  await all.unmount()
})

test('cards: the card rows are there without hovering too; the card of the reading bar is first and visible, the rest are hidden and shown by hovering their bar', async ($, on) => {
  const bars = [bar('r1', { tools: 2, edits: 3 }), bar('r2', { tools: 1, errors: 1 }), bar('r3', null)]
  seedRail(on, rail(bars))

  const ui = await $.ui.mount({ ...band(), surface: 'terminal' })
  const tree = await ui.drawn()

  // A bar is a hover area (a `Box` with a key) in the group of its card.
  expect(areasOf(tree).map((box) => box.hover)).toEqual([{ scope: 'c0' }, { scope: 'c1' }, { scope: 'c2' }])

  // The card rows are a permanent part of the rail: the height of the rail does not depend on hovering.
  const place = cardPlaceOf(tree)
  expect(place?.props).toMatchObject({ width: '100%', height: CARD_ROWS })
  expect(place?.props?.position).toBeUndefined()
  expect(place?.children).toHaveLength(3)

  // Without a jump the reading bar is the newest, r3: its card is first, in the flow, visible without hovering and
  // without padding.
  const shown = shownOf(tree)
  expect(place?.children?.[0]).toBe(shown)
  expect(shown?.props).toMatchObject({ width: '100%', height: CARD_ROWS, flexDirection: 'column' })
  expect(shown?.props?.display).toBeUndefined()
  expect(shown?.hover).toBeUndefined()
  expect(linesOf(shown)).toEqual(['#3 · no summary', '[Unknown] prompt r3'])
  expect(linesOf(shown)).toEqual(textLines(cardLines(bars[2] as Bar, 2, BAND_PROPS.bodyColumns)))

  // The cards of the rest come after it, hidden, in bar order, shown by the group of their bar and padded to the width
  // of the card lines of the reading bar.
  const under = cardLines(bars[2] as Bar, 2, BAND_PROPS.bodyColumns)
  const cards = cardsOf(tree)
  expect(cards).toHaveLength(2)
  expect(place?.children?.slice(1)).toEqual(cards)

  cards.forEach((card, i) => {
    expect(card.props).toMatchObject({ position: 'absolute', top: 0, left: 0, width: '100%', height: CARD_ROWS, display: 'none' })
    expect(card.hover).toEqual({ scope: scopeOf(i), display: 'flex' })
    expect(linesOf(card)).toEqual(textLines(coverLines(cardLines(bars[i] as Bar, i, BAND_PROPS.bodyColumns), under)))
    expect(linesOf(card)).toHaveLength(CARD_ROWS)
  })

  // The prompt line of the reading bar `[Unknown] prompt r3` is 19 cells, the hidden ones have 16: a padding of three
  // spaces.
  expect(linesOf(cards[0])).toEqual(['#1 · edits: 3 files', '[Edit] prompt r1   '])
  expect(linesOf(cards[1])).toEqual(['#2 · calls: 1 · error', '[Work] prompt r2   '])
  await ui.unmount()
})

test('the card of the reading bar is first after a jump to a middle bar too; the reading bar has no hidden card, the rest are in index order', async ($, on) => {
  const bars = talks(5)
  let seeded = rail(bars)
  seedRail(on, () => seeded)

  for (const [current, reading] of [[null, 4], ['r3', 2], ['r1', 0], ['gone', 4]] as const) {
    seeded = rail(bars, { current })
    const ui = await $.ui.mount({ ...band(), surface: 'terminal' })
    const tree = await ui.drawn()
    const others = [0, 1, 2, 3, 4].filter((index) => index !== reading)

    expect(linesOf(shownOf(tree))).toEqual(textLines(cardLines(bars[reading] as Bar, reading, BAND_PROPS.bodyColumns)))
    expect(linesOf(shownOf(tree))[0]).toBe(`#${reading + 1} · talk`)
    expect(cardsOf(tree).map((card) => card.hover?.scope)).toEqual(others.map(scopeOf))
    expect(cardsOf(tree).every((card) => card.props?.display === 'none')).toBe(true)
    expect(cardsOf(tree).map((card) => linesOf(card)[0]?.trimEnd())).toEqual(others.map((index) => `#${index + 1} · talk`))

    // All bars have hover groups, the reading bar too: its group has nothing to open.
    expect(areasOf(tree).map((box) => box.hover?.scope)).toEqual([0, 1, 2, 3, 4].map(scopeOf))
    await ui.unmount()
  }
})

test('a hidden card shorter than the card of the reading bar is padded with spaces to its width, a longer one is not', async ($, on) => {
  const reading: Bar = { id: 'r3', text: 'long prompt of the reading bar', summary: summary({ tools: 9, edits: 3, errors: 1 }) }
  const bars = [bar('r1'), { id: 'r2', text: 'very long prompt of a hidden bar, longer than the reading one', summary: summary({ tools: 1 }) }, reading]
  seedRail(on, rail(bars))

  const ui = await $.ui.mount({ ...band(), surface: 'terminal' })
  const tree = await ui.drawn()
  const [shownHead = '', shownPrompt = ''] = linesOf(shownOf(tree))
  const [short, long] = cardsOf(tree).map(linesOf)

  // The visible one — without padding.
  expect([shownHead, shownPrompt]).toEqual(['#3 · edits: 3 files · error', '[Edit] long prompt of the reading bar'])

  // The short one: both lines are exactly the width of the lines of the visible one, a tail of spaces.
  expect(short?.map(textWidth)).toEqual([textWidth(shownHead), textWidth(shownPrompt)])
  expect(short?.map((line) => line.trimEnd())).toEqual(['#1 · talk', '[Talk] prompt r1'])

  // The long prompt line — as is; the short first one — padded.
  expect(long?.[1]).toBe('[Work] very long prompt of a hidden bar, longer than the reading one')
  expect(textWidth(long?.[0] ?? '')).toBe(textWidth(shownHead))
  await ui.unmount()
})

test('the kind name in the card — in the kind colour, for a flagged turn too; the prompt text — in the text colour', async ($, on) => {
  const bars = [
    ...KINDS.map(([kind, fields]) => bar(kind, fields)),
    bar('flagged-edit', { tools: 2, edits: 1, errors: 1 }),
    bar('flagged-talk', { interrupted: true }),
  ]
  const kinds: BarKind[] = [...KINDS.map(([kind]) => kind), 'edit', 'talk']
  let seeded = rail(bars)
  seedRail(on, () => seeded)

  // Without a jump the card of the newest is visible (flagged talk), after a jump — of the flagged edit.
  for (const current of [null, 'flagged-edit']) {
    seeded = rail(bars, { current })
    const ui = await $.ui.mount({ ...band(), surface: 'terminal' })
    const tree = await ui.drawn()
    const reading = current === null ? bars.length - 1 : 6
    const cards = [shownOf(tree), ...cardsOf(tree)]
    const order = [reading, ...bars.map((_, index) => index).filter((index) => index !== reading)]

    cards.forEach((card, i) => {
      const kind = kinds[order[i] ?? 0] as BarKind
      const name = nameOf(card)
      const prompt = card?.children?.[1] as Drawn | undefined

      expect(name?.props).toEqual({ color: KIND_COLORS[kind] })
      expect(textOf(name)).toBe(`[${KIND_NAMES[kind]}]`)
      expect(prompt?.props).toEqual({ wrap: 'truncate-end' })
      // The first line is dimmed, without a colour.
      expect((card?.children?.[0] as Drawn | undefined)?.props).toEqual({ dimColor: true, wrap: 'truncate-end' })
    })

    expect(nameOf(shownOf(tree))?.props?.color).not.toBe(BAR_COLORS.flagged)
    await ui.unmount()
  }
})

test('the card in a narrow strip: both lines are cut to the width of the strip', async ($, on) => {
  const long: Bar = { id: 'r1', text: 'review plans and then fix the tests', summary: summary({ tools: 9, edits: 3, errors: 1 }) }
  seedRail(on, rail([long]))

  const ui = await $.ui.mount({ ...band({ bodyColumns: 20 }), surface: 'terminal' })
  const tree = await ui.drawn()

  expect(linesOf(shownOf(tree))).toEqual(['#1 · edits: 3 files…', '[Edit] review plans…'])
  expect(textOf(nameOf(shownOf(tree)))).toBe('[Edit]')
  expect(cardsOf(tree)).toHaveLength(0)
  await ui.unmount()
})

test('cards at widths 0…200: the lines are not wider than the strip, the visible one is of the reading bar, the hidden ones are not narrower than its lines', async ($, on) => {
  const bars = [
    bar('r1', { tools: 40, edits: 12, agents: 3, skills: ['a', 'b'], errors: 5, interrupted: true }),
    { id: 'r2', text: '漢字 and text '.repeat(20), summary: summary({ tools: 3 }) },
    bar('r3', null),
    { id: 'r4', text: 'prompt on rail '.repeat(20), summary: summary({ tools: 1, skills: ['review'] }) },
  ]
  seedRail(on, rail(bars, { current: 'r2' }))

  for (let columns = 0; columns <= 200; columns++) {
    const ui = await $.ui.mount({ ...band({ bodyColumns: columns }), surface: 'terminal' })
    const tree = await ui.drawn()

    if (fitBars(4, 1, columns, 0).from === fitBars(4, 1, columns, 0).to) {
      expect(shownOf(tree)).toBeUndefined()
      await ui.unmount()
      continue
    }

    const shown = linesOf(shownOf(tree))
    expect(shown).toEqual(textLines(cardLines(bars[1] as Bar, 1, columns)))

    for (const card of cardsOf(tree)) {
      const lines = linesOf(card)

      lines.forEach((line, row) => {
        expect(textWidth(line)).toBeLessThanOrEqual(columns)
        expect(textWidth(line)).toBeGreaterThanOrEqual(textWidth(shown[row] ?? ''))
      })
    }

    for (const line of shown) {
      expect(textWidth(line)).toBeLessThanOrEqual(columns)
    }

    await ui.unmount()
  }
})

test('other rows of the strip are kept: under the rail — what is below, the row of another mod is untouched', {
  plugins: [
    {
      name: 'other-band',
      register(on) {
        on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
          const { Text } = $.ui.resolve(e)

          return <Text>row of another mod</Text>
        })
      },
    },
  ],
}, async ($, on) => {
  seedRail(on, rail(talks(2)))

  // The strip lays one row per mod; the row of another mod is asked of that mod, the tail-feed hook does not hear it
  // (the default `plugin` selector).
  const ui = await $.ui.mount({ ...band(), surface: 'terminal' })
  expect(await barsOf(ui)).toHaveLength(2)
  expect(await ui.find({ type: 'Text', text: 'row of another mod' })).toBeDefined()
  expect(await ui.keepsBeneath()).toBe(true)
  await ui.unmount()
})

test('the rail is not drawn: empty state, another surface, outside fullscreen, a subagent feed, a survey; a collapsed strip does get the rail', async ($, on) => {
  let seeded = EMPTY_RAIL
  seedRail(on, () => seeded)
  const surfaces = ['terminal', 'desktop', 'mobile'] as const
  const beneath: Partial<Record<(typeof surfaces)[number], unknown>> = {}

  // An empty rail: the tree is what is further down the chain.
  for (const surface of surfaces) {
    const empty = await $.ui.mount({ ...band(), surface })
    beneath[surface] = await empty.drawn()
    expect(await empty.find({ type: 'Button' })).toBeUndefined()
    expect(await empty.keepsBeneath()).toBe(true)
    await empty.unmount()
  }

  // The rail has only turns without rows: no bars — the rail is not drawn.
  seeded = rail([], { older: 7 })
  const older = await $.ui.mount({ ...band(), surface: 'terminal' })
  expect(await older.drawn()).toEqual(beneath.terminal)
  await older.unmount()

  seeded = rail(talks(3))

  for (const surface of ['desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...band(), surface })
    expect(await ui.drawn()).toEqual(beneath[surface])
    await ui.unmount()
  }

  const quiet = [
    band({}, { ...VIEWPORT, isFullscreen: false }),
    band({ view: { agentId: 'agent-1' } }),
    band({ hasSurvey: true }),
  ]

  for (const target of quiet) {
    const ui = await $.ui.mount({ ...target, surface: 'terminal' })
    expect(await ui.drawn()).toEqual(beneath.terminal)
    await ui.unmount()
  }

  // A narrow strip: not a single bar fits with the counters.
  const narrow = await $.ui.mount({ ...band({ bodyColumns: 0 }), surface: 'terminal' })
  expect(await narrow.drawn()).toEqual(beneath.terminal)
  await narrow.unmount()

  // The same bars are drawn in fullscreen of the main feed.
  const shown = await $.ui.mount({ ...band(), surface: 'terminal' })
  expect(await barsOf(shown)).toHaveLength(3)
  await shown.unmount()

  // A collapsed strip: the rail is the same — the engine hides it. The engine does not draw an empty strip at all,
  // and there would be no notice to expand it.
  const collapsed = await $.ui.mount({ ...band({ isCollapsed: true }), surface: 'terminal' })
  expect(await barsOf(collapsed)).toHaveLength(3)
  await collapsed.unmount()
})

test('the rail cannot be read from $.state — the strip draws what is below instead of failing', async ($, on) => {
  const world = newWorld('sess-broken-state')
  stage(on, world)
  seedRail(on, rail(talks(3)))
  world.isStateBroken = true

  const ui = await $.ui.mount({ ...band(), surface: 'terminal' })

  expect(await ui.find({ type: 'Button' })).toBeUndefined()
  expect(await ui.keepsBeneath()).toBe(true)
  await ui.unmount()
})

test('a rail written by v1 (the rail-2 shape tag) is read without a reset: the new look follows its current, the redrawn row with a paste gets the token, the summary and the jump stay', async ($, on) => {
  // v1 wrote the same RailState shape with the same shape tag; the paste block in the text of its bar is a space, not
  // the token. The text is the last line of PASTED: what the human typed after the paste.
  const v1Text = PASTED.slice(PASTED.lastIndexOf('\n') + 1)
  const edited = bar('r1', { tools: 2, edits: 1 })
  const failed: Bar = { id: 'r2', text: v1Text, summary: summary({ tools: 1, errors: 1 }) }
  const asked = bar('r3', null)
  expect(RAIL_SHAPE).toBe('rail-2')
  seedRail(on, rail([edited, failed, asked], { current: 'r2' }), 'rail-2')
  const world = newWorld('sess-v1')
  const written = stage(on, world)

  // The strip: the header, the pointers and the card follow current of the v1 rail.
  const before = await $.ui.mount({ ...band(), surface: 'terminal' })
  const tree = await before.drawn()
  expect(textOf(headerOf(tree))).toBe(`[-] Feed · #2/3 ${'─'.repeat(64)}`)
  expect(lineOf(tree)).toBe(' ██▸▃▃◂░░ ')
  expect(readOf(tree)).toBe(hoverKey('r2'))
  expect(linesOf(shownOf(tree))).toEqual(['#2 · calls: 1 · error', `[Work] ${v1Text}`])
  await before.unmount()

  // The engine redrew the rows after the reload: r2 has the real text with the paste — the bar text now has the
  // token, the summary and the jump are the same.
  for (const [id, text] of [['r1', edited.text], ['r2', PASTED], ['r3', asked.text]] as const) {
    await render($, id, text)
  }

  await written.clock.settle()
  expect(written.last()).toEqual(rail([edited, { ...failed, text: barText(PASTED) }, asked], { current: 'r2' }))

  // A wider strip: the token and the text typed after the paste fit whole whatever the length of that text.
  const after = await $.ui.mount({ ...band({ bodyColumns: 120 }), surface: 'terminal' })
  expect(linesOf(shownOf(await after.drawn()))).toEqual(['#2 · calls: 1 · error', `[Work] [Pasted text +2 lines] ${v1Text}`])
  await after.unmount()

  // The mark in the feed — above the row of the jump.
  const row = await mountRow($, 'r2', PASTED)
  expect((await markOf(row))?.text).toBe('▸ #2/3 · Work')
  await row.unmount()
})

test('a click on a bar of the strip calls a jump to the row of its bar; a deny — a line in the debug log, current stays the same', async ($, on) => {
  const world = newWorld('sess-rail')
  stage(on, world)
  seedRail(on, rail(talks(3)))

  const ui = await $.ui.mount({ ...band(), surface: 'terminal' })

  // The harness has no replacement for the mod's `$.ui.scroll`: the call answers with a deny ("no implementation for
  // ui.scroll"), like `{ deny }` in a session. `jump` writes the deny to the debug log — it shows that the click
  // reached the jump to r1.
  expect(await ui.press({ key: barKey('r1') })).toEqual({ element: barKey('r1') })
  expect(world.logs).toHaveLength(1)
  expect(world.logs[0]?.to).toBe('debug')
  expect(world.logs[0]?.text).toMatch(/ui\.scroll/)
  expect(world.logs[0]?.text.startsWith(jumpNote('r1', ''))).toBe(true)

  await ui.press({ key: barKey('r3') })
  expect(world.logs[1]?.text.startsWith(jumpNote('r3', ''))).toBe(true)

  // `current` is not written: the rail is the same, the pointers are at the same reading bar, the newest r3.
  expect(world.calls.set).toBe(0)
  expect(readOf(await ui.drawn())).toBe(hoverKey('r3'))
  expect((await barsOf(ui)).map(styleOf)).toEqual(talks(3).map(() => ({ color: KIND_COLORS.talk })))
  await ui.unmount()
})

test('a click on a bar jumps to its row: the jump callback gets the bar id; a click on the fold button — the fold callback', async ($, on) => {
  const bars = talks(3)
  const jumped: string[] = []
  let toggled = 0

  // The rail drawn by `railRow` in the pane of the test: `onJump` is a callback of the test, not `$.ui.scroll`, which
  // the harness does not give the mod. The link id → call argument is checked by `jumpArgs` (lib-layout.test.ts).
  on('ui.render', { component: 'Pane', plugin: '*' }, ($t, e, next) => {
    if (e.surface !== 'terminal') {
      return next(e)
    }

    const row = railRow(
      $t.ui.resolve(e),
      rail(bars),
      e.props.bodyColumns,
      false,
      (id) => {
        jumped.push(id)
      },
      () => {
        toggled++
      },
    )

    return row ?? next(e)
  })

  const ui = await $.ui.mount({
    plugin: 'test',
    component: 'Pane',
    requestId: 'rail-probe',
    surface: 'terminal',
    props: { title: 'rail', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 10 }, view: {} },
  })

  await ui.press({ key: barKey('r2') })
  await ui.press({ key: barKey('r1') })
  await ui.press({ key: barKey('r3') })

  expect(jumped).toEqual(['r2', 'r1', 'r3'])
  expect(toggled).toBe(0)

  await ui.press({ key: FOLD_KEY })
  expect(toggled).toBe(1)
  expect(jumped).toHaveLength(3)
  await ui.unmount()
})

/** The line with the fold button first: the header of the unfolded rail or the whole folded rail. */
function foldRowOf(tree: unknown): Drawn | undefined {
  return boxesOf(tree).find((box) => (box.children?.[0] as Drawn | undefined)?.props?.key === FOLD_KEY)
}

/** The folded rail of `count` talk bars as text, as on the screen (`foldedLine`), with the `[+]` button. */
function foldedText(count: number, reading: number, columns: number, older: number): string {
  const { head, line, tail } = foldedLine(count, reading, columns, older)
  const item = (it: LineItem | undefined) => (it === undefined ? '' : 'label' in it ? it.label : GLYPHS.talk.repeat(BAR_WIDTH))
  const bars = line === null ? '' : line.gaps.map((gap, i) => gap.text + item(line.items[i])).join('')

  return foldLabel(true) + [...head.map((part) => part.text), bars, ...tail.map((part) => part.text)].join('')
}

test('the folded rail — one row under an empty one: [+], the title, the bars with pointers at the reading bar, the line to the edge; no cards', async ($, on) => {
  seedRail(on, rail(talks(6)))
  watchFold(on, true)

  const ui = await $.ui.mount({ ...band(), surface: 'terminal' })
  const tree = await ui.drawn()
  const row = railOf(tree)
  const [button, head, line, tail] = (row?.children ?? []) as Drawn[]

  // The button (3) + ` Feed · #6/6 ` (13) + six bars with gaps (19): the line is 80 − 35 = 45 cells with the space.
  expect(textOf(row)).toBe(`[+] Feed · #6/6  ▂▂ ▂▂ ▂▂ ▂▂ ▂▂▸▂▂◂ ${'─'.repeat(44)}`)
  expect(textWidth(textOf(row))).toBe(BAND_PROPS.bodyColumns)
  expect(row?.props?.flexDirection).toBe('row')
  expect(row?.props?.paddingTop).toBe(TOP_ROWS)
  expect(row?.children).toHaveLength(4)
  expect(button?.type).toBe('Button')
  expect(head?.props?.wrap).toBe('truncate-end')
  expect(line).toBe(barLineOf(tree))
  expect(textOf(tail)).toBe(` ${'─'.repeat(44)}`)
  expect(readOf(tree)).toBe(hoverKey('r6'))

  // The button is `[+]` in the line colour; the bars are the same buttons as in the unfolded rail; no cards.
  const fold = await foldOf(ui)
  expect(fold?.props.label).toBe(foldLabel(true))
  expect(styleOf(fold)).toEqual({ color: BAR_COLORS.line })
  expect((await barsOf(ui)).map((item) => item.key)).toEqual(talks(6).map((item) => barKey(item.id)))
  expect(cardsOf(tree)).toEqual([])
  expect(await ui.find({ type: 'Text', text: /^\[Talk\]/ })).toBeUndefined()
  await ui.unmount()
})

test('a click on a bar of the folded rail calls a jump, as in the unfolded one', async ($, on) => {
  const world = newWorld('sess-folded')
  stage(on, world)
  seedRail(on, rail(talks(3)))
  watchFold(on, true)

  const ui = await $.ui.mount({ ...band(), surface: 'terminal' })
  expect(await ui.press({ key: barKey('r2') })).toEqual({ element: barKey('r2') })
  expect(world.logs[0]?.text.startsWith(jumpNote('r2', ''))).toBe(true)
  await ui.unmount()
})

test('the [-] button folds the rail to one row, [+] unfolds it: folded is written, the rail is redrawn', async ($, on) => {
  seedRail(on, rail(talks(3)))
  const fold = watchFold(on)

  const ui = await $.ui.mount({ ...band(), surface: 'terminal' })
  expect((await foldOf(ui))?.props.label).toBe('[-]')
  expect(cardsOf(await ui.drawn())).toHaveLength(2)

  expect(await ui.press({ key: FOLD_KEY })).toEqual({ element: FOLD_KEY })
  expect(fold.writes).toEqual([true])
  expect((await foldOf(ui))?.props.label).toBe('[+]')
  expect(textOf(railOf(await ui.drawn()))).toBe(foldedText(3, 2, BAND_PROPS.bodyColumns, 0))
  expect(cardsOf(await ui.drawn())).toEqual([])

  await ui.press({ key: FOLD_KEY })
  expect(fold.writes).toEqual([true, false])
  expect((await foldOf(ui))?.props.label).toBe('[-]')
  expect(cardsOf(await ui.drawn())).toHaveLength(2)
  await ui.unmount()
})

test('whether the rail is folded cannot be read — the rail is unfolded; the write is denied — the view stays the same, a line in the debug log', async ($, on) => {
  const world = newWorld('sess-fold-broken')
  stage(on, world)
  seedRail(on, rail(talks(3)))
  const fold = watchFold(on, true)
  fold.isBroken = true

  const broken = await $.ui.mount({ ...band(), surface: 'terminal' })
  expect((await foldOf(broken))?.props.label).toBe('[-]')
  expect(await barsOf(broken)).toHaveLength(3)
  await broken.unmount()

  fold.isBroken = false
  fold.denied = 1
  const ui = await $.ui.mount({ ...band(), surface: 'terminal' })
  await ui.press({ key: FOLD_KEY })
  expect(fold.writes).toEqual([])
  expect((await foldOf(ui))?.props.label).toBe('[+]')
  expect(world.logs).toHaveLength(1)
  expect(world.logs[0]?.to).toBe('debug')
  expect(world.logs[0]?.text).toMatch(/^tail-feed: didn't toggle the rail: .*denied/)
  await ui.unmount()
})

test('the folded rail at widths 0…200: the line is full width, the [+] button — while it fits; narrower than the button — no rail', async ($, on) => {
  seedRail(on, rail(talks(30), { older: 2, current: 'r11' }))
  watchFold(on, true)

  for (let columns = 0; columns <= 200; columns++) {
    const ui = await $.ui.mount({ ...band({ bodyColumns: columns }), surface: 'terminal' })
    const tree = await ui.drawn()

    if (columns < FOLD_WIDTH) {
      expect(await foldOf(ui)).toBeUndefined()
      expect(await ui.keepsBeneath()).toBe(true)
    } else {
      const row = foldRowOf(tree)

      expect(textOf(row)).toBe(foldedText(30, 10, columns, 2))
      expect(textWidth(textOf(row))).toBe(columns)
      expect((await foldOf(ui))?.props.label).toBe('[+]')
      expect(cardsOf(tree)).toEqual([])

      if (barLineOf(tree) !== undefined) {
        expect(readOf(tree)).toBe(hoverKey('r11'))
      }
    }

    await ui.unmount()
  }
})

test('a folded empty rail is not drawn: the tree is what is further down the chain', async ($, on) => {
  seedRail(on, EMPTY_RAIL)
  watchFold(on, true)

  const ui = await $.ui.mount({ ...band(), surface: 'terminal' })
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
  expect(await ui.keepsBeneath()).toBe(true)
  await ui.unmount()
})

/** A row id as long as a UUID, as the rows of the engine feed have: the tree size depends on the id length. */
function uuidOf(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
}

/** A prompt about code of BAR_TEXT_MAX characters: JSON doubles quotes and backslashes. */
const CODE_PROMPT = barText('fix "parseCommand" in C:\\work\\hooks\\lib.ts and run the checks; '.repeat(10))

test('size: 150 bars with long prompts about code and ids as long as a UUID — MAX_BARS visible, the strip tree is at most 50 000 characters, the bar line is not wider than the strip, the prompt text in the card is not longer than BAR_TEXT_MAX', async ($, on) => {
  const bars = Array.from({ length: 150 }, (_, i): Bar => ({ id: uuidOf(i + 1), text: CODE_PROMPT, summary: summary({ tools: i % 4 }) }))
  seedRail(on, rail(bars))

  expect([...CODE_PROMPT]).toHaveLength(BAR_TEXT_MAX)
  expect(uuidOf(150)).toHaveLength(36)
  expect(JSON.stringify(CODE_PROMPT).length - CODE_PROMPT.length).toBeGreaterThan(20)

  const ui = await $.ui.mount({ ...band({ bodyColumns: 400 }), surface: 'terminal' })
  const buttons = await barsOf(ui)

  expect(buttons).toHaveLength(MAX_BARS)
  expect(buttons[0]?.key).toBe(barKey(uuidOf(150 - MAX_BARS + 1)))
  expect(buttons.every((button) => button.props.plain === true && textWidth(button.text) === BAR_WIDTH)).toBe(true)
  expect(await ui.find({ type: 'Text', text: `‹${150 - MAX_BARS}` })).toBeDefined()

  // The tree of the rail shares the budget of the strip (100 000 characters) with the rows of other mods: normally the
  // rail takes at most half. The measurement is in the plan (task 6 and the review).
  const tree = await ui.drawn()
  expect(JSON.stringify(tree).length).toBeLessThanOrEqual(50_000)

  // The bar line: the counter, MAX_BARS buttons, a gap cell before each item and after the last one — not wider than
  // the strip; the pointers are at the newest.
  const row = textWidth(lineOf(tree))
  expect(row).toBe(textWidth(`‹${150 - MAX_BARS}`) + MAX_BARS * (BAR_WIDTH + textWidth(GAP)) + 2 * textWidth(GAP))
  expect(row).toBeLessThanOrEqual(400)
  expect(readOf(tree)).toBe(hoverKey(uuidOf(150)))

  // The card of the newest is visible, the cards of the other visible bars are hidden.
  const cards = [shownOf(tree), ...cardsOf(tree)]
  expect(cards).toHaveLength(MAX_BARS)
  expect(linesOf(cards[0])[0]).toBe('#150 · calls: 1')

  cards.forEach((card, i) => {
    const lines = linesOf(card)
    const index = i === 0 ? 149 : 150 - MAX_BARS + i - 1
    const name = `[${KIND_NAMES[kindOf(bars[index]?.summary ?? null)]}]`
    expect(lines).toHaveLength(CARD_ROWS)
    expect([...(lines[0] ?? '')].length).toBeLessThanOrEqual(BAR_TEXT_MAX)
    // The prompt line is the kind name and the bar text, which is not longer than BAR_TEXT_MAX; the lines are the same
    // width, nothing to pad.
    expect(lines[1]).toBe(`${name} ${CODE_PROMPT}`)
  })

  await ui.unmount()
})

test('size in the worst case: the summary of the reading bar across the whole strip of 400 columns, the prompts of the rest — only quotes and backslashes — the strip tree is at most 80 000 characters', async ($, on) => {
  // The padding repeats the first line of the card of the reading bar with spaces in each hidden card, and JSON doubles
  // quotes and backslashes.
  const skills = Array.from({ length: 30 }, (_, k) => `plugin-name:skill-number-${k}`)
  const wide = summary({ tools: 40, edits: 12, agents: 3, skills, errors: 5, interrupted: true })
  const escaped = barText('"\\'.repeat(BAR_TEXT_MAX))
  const bars = Array.from({ length: 150 }, (_, i): Bar =>
    i === 149
      ? { id: uuidOf(i + 1), text: CODE_PROMPT, summary: wide }
      : { id: uuidOf(i + 1), text: escaped, summary: summary({ tools: i % 4 }) },
  )
  seedRail(on, rail(bars))

  expect(JSON.stringify(escaped).length).toBeGreaterThan(2 * (BAR_TEXT_MAX - 1))

  const ui = await $.ui.mount({ ...band({ bodyColumns: 400 }), surface: 'terminal' })
  const tree = await ui.drawn()
  const hidden = cardsOf(tree)

  expect(textWidth(linesOf(shownOf(tree))[0] ?? '')).toBe(400)
  expect(hidden).toHaveLength(MAX_BARS - 1)
  expect(hidden.every((card) => textWidth(linesOf(card)[0] ?? '') === 400)).toBe(true)
  // More than half of the budget of the strip, but a fifth is left to the rows of other mods.
  expect(JSON.stringify(tree).length).toBeLessThanOrEqual(80_000)
  await ui.unmount()
})
