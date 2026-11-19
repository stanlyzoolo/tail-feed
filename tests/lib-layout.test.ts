import { describe, expect, test } from 'claude-code/testing'

import {
  aimCommand,
  BAR_COLORS,
  BAR_TEXT_MAX,
  BAR_WIDTH,
  barColor,
  barGaps,
  barLine,
  barText,
  CARD_ROWS,
  cardLines,
  COMMAND_FORMS,
  COMMAND_HINT,
  commandArgs,
  POINTERS,
  coverLines,
  findBar,
  fitBars,
  FOLD_LABELS,
  FOLD_WIDTH,
  foldedLine,
  foldLabel,
  foldNote,
  foldReply,
  GAP,
  GLYPHS,
  headerParts,
  isFlagged,
  jumpArgs,
  jumpedTo,
  jumpNote,
  jumpReply,
  KIND_COLORS,
  KIND_NAMES,
  kindOf,
  MARK,
  markParts,
  MAX_BARS,
  parseCommand,
  readingIndex,
  replyOf,
  stepTarget,
  textWidth,
} from '../hooks/lib'
import type { BarKind, BarWindow, CardLines, CommandAim, LineItem, Part } from '../hooks/lib'
import type { Bar, RailState, TurnSummary } from '../types'
import { IMAGE, PASTED, summary } from './world'

/** The question after the paste block of `PASTED`: its last line. */
const PASTED_QUESTION = PASTED.slice(PASTED.lastIndexOf('\n') + 1)

/** A bar with an id and a text; the default summary is talk. */
function bar(id: string, text: string, fields: Partial<TurnSummary> | null = {}): Bar {
  return { id, text, summary: fields === null ? null : summary(fields) }
}

/** Segment texts: the gap cells of `barGaps` without colour. */
function textsOf(parts: readonly Part[]): string[] {
  return parts.map((part) => part.text)
}

/** The text of a bar line item: a counter as is, a bar is the talk glyph BAR_WIDTH times. */
function itemText(item: LineItem | undefined): string {
  return item === undefined ? '' : 'label' in item ? item.label : GLYPHS.talk.repeat(BAR_WIDTH)
}

/** Gap cell texts of the window's bar line (`barLine`), the reading bar is `reading`. */
function gapsOf(window: BarWindow, count: number, older: number, reading: number): string[] {
  return textsOf(barLine(window, count, older, reading).gaps)
}

/**
 * The bar line of a window of a rail of `count` bars as text, the way `railRow` draws it: the gap
 * cells of `barLine` interleaved with its items (`‹N`, bars, `N›`), the reading bar is `reading`.
 * The width is `textWidth` of this line, not what `fitBars` computed.
 */
function drawnLine(window: BarWindow, count: number, older: number, reading = window.from): string {
  const { items, gaps } = barLine(window, count, older, reading)

  return gaps.map((gap, i) => gap.text + itemText(items[i])).join('')
}

/** The width of the bar line of a window of a rail of `count` bars, computed anew: bars, counters, gaps. */
function drawnWidth(window: BarWindow, count: number, older: number): number {
  return textWidth(drawnLine(window, count, older))
}

const KINDS: BarKind[] = ['edit', 'agent', 'skill', 'work', 'talk', 'unknown']

describe('textWidth', () => {
  test('Latin and Greek — one cell per character', () => {
    expect(textWidth('ok')).toBe(2)
    expect(textWidth('αλλαγή')).toBe(6)
  })

  test('a CJK character and an emoji — two cells', () => {
    expect(textWidth('漢字')).toBe(4)
    expect(textWidth('🙂')).toBe(2)
  })

  test('emoji outside the old ranges — two as well: transport, new emoji, symbols with emoji presentation', () => {
    expect(textWidth('🚀')).toBe(2)
    expect(textWidth('🫠')).toBe(2)
    expect(textWidth('✅')).toBe(2)
    expect(textWidth('⚡')).toBe(2)
    // A symbol without default emoji presentation — one cell.
    expect(textWidth('✓')).toBe(1)
    expect(textWidth('→')).toBe(1)
  })

  test('a combining mark — zero', () => {
    expect(textWidth('é')).toBe(1)
  })

  test('an empty text — zero', () => {
    expect(textWidth('')).toBe(0)
  })
})

describe('GLYPHS', () => {
  test('each kind has its own glyph of one cell', () => {
    for (const kind of KINDS) {
      expect(textWidth(GLYPHS[kind])).toBe(1)
    }

    expect(new Set(KINDS.map((kind) => GLYPHS[kind])).size).toBe(KINDS.length)
  })

  test('the "Height" variant: the more was done, the taller the column; a bar is the glyph twice, two cells', () => {
    expect(GLYPHS).toEqual({ talk: '▂', work: '▃', skill: '▅', agent: '▆', edit: '█', unknown: '░' })
    expect(BAR_WIDTH).toBe(2)

    for (const kind of KINDS) {
      expect(textWidth(GLYPHS[kind].repeat(BAR_WIDTH))).toBe(2)
    }
  })
})

describe('KIND_NAMES', () => {
  test('each kind has its own name — one capitalized word', () => {
    for (const kind of KINDS) {
      expect(KIND_NAMES[kind]).toMatch(/^[A-Z][a-z]+$/)
    }

    expect(new Set(KINDS.map((kind) => KIND_NAMES[kind])).size).toBe(KINDS.length)
  })
})

describe('KIND_COLORS', () => {
  test('each kind has its own colour of the Nord palette, neither the red of an error nor the blue of the reading bar', () => {
    expect(KIND_COLORS).toEqual({
      talk: '#616e88',
      work: '#81a1c1',
      skill: '#ebcb8b',
      agent: '#b48ead',
      edit: '#a3be8c',
      unknown: '#4c566a',
    })
    expect(new Set(KINDS.map((kind) => KIND_COLORS[kind])).size).toBe(KINDS.length)

    for (const kind of KINDS) {
      expect(KIND_COLORS[kind]).not.toBe(BAR_COLORS.flagged)
      expect(KIND_COLORS[kind]).not.toBe(BAR_COLORS.current)
    }
  })
})

describe('barColor', () => {
  test('an error and an interruption are flagged; no summary — not flagged', () => {
    expect(isFlagged(summary({ errors: 1 }))).toBe(true)
    expect(isFlagged(summary({ interrupted: true }))).toBe(true)
    expect(isFlagged(summary({ tools: 3, edits: 1 }))).toBe(false)
    expect(isFlagged(null)).toBe(false)
  })

  test('a bar — in the colour of its kind', () => {
    expect(barColor(summary({ tools: 2, edits: 1 }))).toBe(KIND_COLORS.edit)
    expect(barColor(summary({ tools: 1, agents: 1 }))).toBe(KIND_COLORS.agent)
    expect(barColor(summary({ tools: 1, skills: ['review'] }))).toBe(KIND_COLORS.skill)
    expect(barColor(summary({ tools: 2 }))).toBe(KIND_COLORS.work)
    expect(barColor(summary())).toBe(KIND_COLORS.talk)
    expect(barColor(null)).toBe(KIND_COLORS.unknown)
  })

  test('a flagged turn — in the error colour instead of the kind colour', () => {
    expect(barColor(summary({ tools: 2, edits: 1, errors: 1 }))).toBe(BAR_COLORS.flagged)
    expect(barColor(summary({ tools: 3, errors: 2 }))).toBe(BAR_COLORS.flagged)
    expect(barColor(summary({ interrupted: true }))).toBe(BAR_COLORS.flagged)
  })

  test('the rail colours — the Nord palette: error, "you are here", lines; the title — Claude peach', () => {
    expect(BAR_COLORS).toEqual({ flagged: '#bf616a', current: '#88c0d0', line: '#616e88', title: '#d97757' })
  })
})

describe('jumpArgs and jumpedTo', () => {
  const rail = { bars: [bar('a', 'one'), bar('b', 'two')], older: 0, current: null }

  test('a jump to the prompt row of a bar: the requestId of the row, the row lands at the top of the window', () => {
    expect(jumpArgs('b')).toEqual({ to: { requestId: 'b' }, block: 'start' })
  })

  test('a successful jump makes the bar the reading bar', () => {
    expect(jumpedTo(rail, 'a')).toEqual({ ...rail, current: 'a' })
    expect(jumpedTo({ ...rail, current: 'a' }, 'b').current).toBe('b')
  })

  test('the bar is no longer in the rail — the rail is unchanged', () => {
    expect(jumpedTo({ ...rail, current: 'a' }, 'gone')).toEqual({ ...rail, current: 'a' })
  })
})

describe('markParts', () => {
  const bars = [
    bar('a', 'edit', { tools: 2, edits: 1 }),
    bar('b', 'agent', { tools: 1, agents: 1, errors: 1 }),
    bar('c', 'question'),
    bar('d', 'no summary', null),
  ]
  const rail: RailState = { bars, older: 3, current: null }

  test('no jump — no mark: current is empty, reading the newest bar is not a jump', () => {
    expect(markParts(rail)).toBeNull()
    expect(markParts({ bars: [], older: 0, current: null })).toBeNull()
  })

  test('after a jump — a mark above the row of the jump bar: ▸ #n/N · and the kind of the turn', () => {
    expect(markParts({ ...rail, current: 'c' })).toEqual({ id: 'c', label: '▸ #3/4 · ', kind: 'talk' })
  })

  test('the number is one-based, N is the bars of the rail without the older turns, like #n/N of the header', () => {
    expect(markParts({ ...rail, current: 'a' })?.label).toBe('▸ #1/4 · ')
    expect(markParts({ ...rail, current: 'd' })?.label).toBe('▸ #4/4 · ')

    const many = Array.from({ length: 120 }, (_, i) => bar(`r${i + 1}`, 'prompt'))
    expect(markParts({ bars: many, older: 0, current: 'r100' })?.label).toBe('▸ #100/120 · ')
  })

  test('the mark sign MARK is one cell; the place #n/N is the same as in the header with the same reading bar', () => {
    expect(MARK).toBe('▸')
    expect(textWidth(MARK)).toBe(1)

    for (const [i, item] of bars.entries()) {
      const place = headerParts(bars.length, i, 40)[3]?.text

      expect(place).toBe(`#${i + 1}/${bars.length}`)
      expect(markParts({ ...rail, current: item.id })?.label).toBe(`${MARK} ${place} · `)
    }
  })

  test('the kind — by the summary of the bar, as in the card; a flagged turn — its own kind, not an error', () => {
    const kinds = bars.map((item) => markParts({ ...rail, current: item.id }))
    expect(kinds.map((parts) => parts?.kind)).toEqual(['edit', 'agent', 'talk', 'unknown'])
    expect(kinds.map((parts) => parts?.kind)).toEqual(bars.map((item) => kindOf(item.summary)))
  })

  test('the jump bar is no longer in the rail — no mark', () => {
    expect(markParts({ ...rail, current: 'gone' })).toBeNull()
  })
})

describe('fitBars', () => {
  test('all bars fit — no counters', () => {
    expect(fitBars(5, 4, 20, 0)).toEqual({ from: 0, to: 5 })
  })

  test('exactly the width: 5 bars of two cells, gaps between them and at the edges — 16 columns', () => {
    expect(fitBars(5, 4, 16, 0)).toEqual({ from: 0, to: 5 })
  })

  test('a column narrower — the window is at the right edge, the counter on the left takes space', () => {
    // 4 bars with the counter ‹1 — 16 columns, 3 bars with ‹2 — 13.
    expect(fitBars(5, 4, 15, 0)).toEqual({ from: 2, to: 5 })
  })

  test('reading the newest — the hidden ones are on the left', () => {
    // ‹45 and 5 bars — 20 columns; ‹44 and 6 bars — 23.
    expect(fitBars(50, 49, 20, 0)).toEqual({ from: 45, to: 50 })
  })

  test('reading the first — the hidden ones are on the right', () => {
    expect(fitBars(50, 0, 20, 0)).toEqual({ from: 0, to: 5 })
  })

  test('reading a bar in the middle — hidden ones on both sides, the window starts at it', () => {
    // ‹20, 4 bars, 26› — 21 columns; 5 bars with 25› — 24.
    expect(fitBars(50, 20, 21, 0)).toEqual({ from: 20, to: 24 })
  })

  test('the reading bar is in the right window — the window does not move', () => {
    expect(fitBars(50, 47, 20, 0)).toEqual({ from: 45, to: 50 })
  })

  test('150 bars, widths 0…200: the reading bar is always in the window and between the pointers, the line is no wider than the strip, one more bar would not fit', () => {
    const count = 150
    // The edges of the rail, the edges of the MAX_BARS window at the right edge and the middle: all 150 would
    // take seconds per test.
    const edge = count - MAX_BARS
    const readings = [0, 1, 2, 15, 30, 60, 75, 100, edge - 1, edge, edge + 1, 119, 120, 140, 147, 148, 149]

    for (const older of [0, 3]) {
      for (let columns = 0; columns <= 200; columns++) {
        for (const reading of readings) {
          const window = fitBars(count, reading, columns, older)
          const n = window.to - window.from

          if (n === 0) {
            // An empty window: not even the reading bar alone with its counters fits.
            expect(drawnWidth({ from: reading, to: reading + 1 }, count, older)).toBeGreaterThan(columns)
            continue
          }

          expect(window.from).toBeLessThanOrEqual(reading)
          expect(window.to).toBeGreaterThan(reading)
          expect(drawnWidth(window, count, older)).toBeLessThanOrEqual(columns)
          expect(textWidth(drawnLine(window, count, older, reading))).toBe(drawnWidth(window, count, older))
          expect(gapsOf(window, count, older, reading).filter((gap) => gap !== GAP)).toEqual([POINTERS.left, POINTERS.right])

          // A window one bar wider, by the same rule (at the right edge or from the reading bar), would not fit.
          if (n < Math.min(count, MAX_BARS)) {
            const from = reading >= count - (n + 1) ? count - (n + 1) : reading
            expect(drawnWidth({ from, to: from + n + 1 }, count, older)).toBeGreaterThan(columns)
          }
        }
      }
    }
  })

  test('a narrow strip: not a single bar with counters and gaps fits — the window is empty', () => {
    // One bar with ‹2 and three gap cells — 7 columns.
    expect(fitBars(3, 2, 6, 0)).toEqual({ from: 0, to: 0 })
    expect(fitBars(3, 2, 7, 0)).toEqual({ from: 2, to: 3 })
    expect(fitBars(1, 0, 1, 0)).toEqual({ from: 0, to: 0 })
    expect(fitBars(1, 0, 0, 0)).toEqual({ from: 0, to: 0 })
  })

  test('one bar — two columns and a gap cell on each side: four columns', () => {
    expect(fitBars(1, 0, 4, 0)).toEqual({ from: 0, to: 1 })
    expect(fitBars(1, 0, 3, 0)).toEqual({ from: 0, to: 0 })
  })

  test('zero bars — an empty window', () => {
    expect(fitBars(0, -1, 80, 0)).toEqual({ from: 0, to: 0 })
    expect(fitBars(0, -1, 80, 5)).toEqual({ from: 0, to: 0 })
  })

  test('older in the left counter takes space even when all bars are in the window', () => {
    // All three bars and ‹7 — 13 columns.
    expect(fitBars(3, 2, 13, 7)).toEqual({ from: 0, to: 3 })
    // In 12 columns all three fit without older (10 columns), with older — two and ‹8.
    expect(fitBars(3, 2, 12, 0)).toEqual({ from: 0, to: 3 })
    expect(fitBars(3, 2, 12, 7)).toEqual({ from: 1, to: 3 })
  })

  test('no more than MAX_BARS visible bars at any width', () => {
    const window = fitBars(200, 199, 1000, 0)

    expect(window.to - window.from).toBe(MAX_BARS)
    expect(window).toEqual({ from: 200 - MAX_BARS, to: 200 })
  })
})

describe('barGaps and barLine', () => {
  const [L, R] = [POINTERS.left, POINTERS.right]

  test('the gap and the pointers — one cell each: a space, ▸ left of the reading bar, ◂ right of it', () => {
    expect([GAP, L, R]).toEqual([' ', '▸', '◂'])

    for (const cell of [GAP, L, R]) {
      expect(textWidth(cell)).toBe(1)
    }
  })

  test('the pointers — in the "you are here" colour, the gap — without colour', () => {
    const current = BAR_COLORS.current

    expect(barGaps(3, 1)).toEqual([
      { text: GAP },
      { text: L, color: current },
      { text: R, color: current },
      { text: GAP },
    ])
  })

  test('a cell before each item and after the last one; pointers only at the reading bar', () => {
    // All five bars are in the window, no counters: six cells, the reading bar is the third item.
    expect(textsOf(barGaps(5, 2))).toEqual([GAP, GAP, L, R, GAP, GAP])
    expect(drawnLine({ from: 0, to: 5 }, 5, 0, 2)).toBe(' ▂▂ ▂▂▸▂▂◂▂▂ ▂▂ ')
  })

  test('the reading bar is the newest at the right edge: the right pointer is the last cell of the line', () => {
    expect(textsOf(barGaps(3, 2))).toEqual([GAP, GAP, L, R])
    expect(drawnLine({ from: 0, to: 3 }, 3, 0, 2)).toBe(' ▂▂ ▂▂▸▂▂◂')
  })

  test('the reading bar is the first bar of the rail: the left pointer is the first cell of the line', () => {
    expect(textsOf(barGaps(3, 0))).toEqual([L, R, GAP, GAP])
    expect(drawnLine({ from: 0, to: 3 }, 3, 0, 0)).toBe('▸▂▂◂▂▂ ▂▂ ')
  })

  test('the items of the line: ‹N, the window bars by their rail numbers, N›; one more gap cell than items', () => {
    const line = barLine({ from: 20, to: 24 }, 50, 0, 22)

    const bars = [20, 21, 22, 23].map((index) => ({ index }))

    expect(line.items).toEqual([{ label: '‹20' }, ...bars, { label: '26›' }])
    expect(line.gaps).toEqual(barGaps(6, 3))
  })

  test('the reading bar is the first in the window — the left pointer is between the counter ‹N and the bar', () => {
    // ‹20, bars 20…23, 26›: the reading bar 20 is the second item of six.
    expect(textsOf(barGaps(6, 1))).toEqual([GAP, L, R, GAP, GAP, GAP, GAP])
    expect(gapsOf({ from: 20, to: 24 }, 50, 0, 20)).toEqual(textsOf(barGaps(6, 1)))
    expect(drawnLine({ from: 20, to: 24 }, 50, 0, 20)).toBe(' ‹20▸▂▂◂▂▂ ▂▂ ▂▂ 26› ')
  })

  test('the reading bar is the last in the window — the right pointer is between the bar and the counter N›', () => {
    expect(textsOf(barGaps(6, 4))).toEqual([GAP, GAP, GAP, GAP, L, R, GAP])
    expect(gapsOf({ from: 20, to: 24 }, 50, 0, 23)).toEqual(textsOf(barGaps(6, 4)))
    expect(drawnLine({ from: 20, to: 24 }, 50, 0, 23)).toBe(' ‹20 ▂▂ ▂▂ ▂▂▸▂▂◂26› ')
  })

  test('older — the left counter and its cell, even when all bars are in the window', () => {
    expect(barLine({ from: 0, to: 2 }, 2, 4, 1).items).toEqual([{ label: '‹4' }, { index: 0 }, { index: 1 }])
    expect(gapsOf({ from: 0, to: 2 }, 2, 4, 1)).toEqual([GAP, GAP, L, R])
    expect(drawnLine({ from: 0, to: 2 }, 2, 4, 1)).toBe(' ‹4 ▂▂▸▂▂◂')
  })

  test('after a jump the pointers move to the new reading bar, the number of cells and the line width stay the same', () => {
    const window = { from: 10, to: 20 }
    const widths = new Set<number>()

    for (let reading = window.from; reading < window.to; reading++) {
      const gaps = gapsOf(window, 30, 2, reading)
      const at = 1 + reading - window.from

      expect(gaps).toHaveLength(1 + 10 + 1 + 1)
      expect(gaps.filter((gap) => gap !== GAP)).toEqual([L, R])
      expect(gaps[at]).toBe(L)
      expect(gaps[at + 1]).toBe(R)
      widths.add(textWidth(drawnLine(window, 30, 2, reading)))
    }

    expect([...widths]).toEqual([textWidth(drawnLine(window, 30, 2, -1))])
  })

  test('the reading bar is not an item of the line: no pointers, the same number of cells', () => {
    expect(textsOf(barGaps(4, 4))).toEqual([GAP, GAP, GAP, GAP, GAP])
    expect(textsOf(barGaps(3, -1))).toEqual([GAP, GAP, GAP, GAP])
    // The reading bar is outside the window: no bar of the line stands between pointers.
    expect(gapsOf({ from: 20, to: 24 }, 50, 0, 30)).toEqual([GAP, GAP, GAP, GAP, GAP, GAP, GAP])
  })
})

describe('fold button', () => {
  test('[-] on the unfolded rail, [+] on the folded one: labels of the same width FOLD_WIDTH', () => {
    expect(FOLD_LABELS).toEqual({ open: '[-]', folded: '[+]' })
    expect(foldLabel(false)).toBe('[-]')
    expect(foldLabel(true)).toBe('[+]')
    expect(FOLD_WIDTH).toBe(3)
    expect(textWidth(FOLD_LABELS.folded)).toBe(FOLD_WIDTH)
  })
})

describe('headerParts', () => {
  const line = BAR_COLORS.line
  const title = { text: 'Feed', color: BAR_COLORS.title, weight: 'bold' }
  /** The header line as text after the fold button, as on the screen. */
  const header = (count: number, reading: number, columns: number) =>
    headerParts(count, reading, columns)
      .map((part) => part.text)
      .join('')

  test('the full line after the button: the bold peach title Feed, · in the text colour, #n/N in blue, a line to the edge', () => {
    // The button (3) + ` Feed · ` (8) + `#6/6` (4) + ` ─…─`: the line is 40 − 15 = 25 cells with the space.
    expect(headerParts(6, 5, 40)).toEqual([
      { text: ' ' },
      title,
      { text: ' · ' },
      { text: '#6/6', color: BAR_COLORS.current },
      { text: ` ${'─'.repeat(24)}`, color: line },
    ])
    expect(`${foldLabel(false)}${header(6, 5, 40)}`).toBe(`[-] Feed · #6/6 ${'─'.repeat(24)}`)
  })

  test('#n/N by the reading bar: no jump — the newest, after a jump — the jump bar, no jump bar — the newest', () => {
    const bars = [bar('a', 'one'), bar('b', 'two'), bar('c', 'three')]
    const place = (current: string | null) => headerParts(bars.length, readingIndex(bars, current), 40)[3]?.text

    expect(place(null)).toBe('#3/3')
    expect(place('a')).toBe('#1/3')
    expect(place('b')).toBe('#2/3')
    expect(place('gone')).toBe('#3/3')
  })

  test('N and n are bar counts: two-digit and three-digit', () => {
    expect(header(150, 41, 40)).toBe(` Feed · #42/150 ${'─'.repeat(21)}`)
  })

  test('narrow: first the line gets shorter, then #n/N goes away, then Feed is clipped', () => {
    // The title with #n/N is 12 cells after the button: at 15 columns there is no line.
    expect(header(6, 5, 17)).toBe(' Feed · #6/6 ─')
    expect(header(6, 5, 16)).toBe(' Feed · #6/6 ')
    expect(header(6, 5, 15)).toBe(' Feed · #6/6')
    expect(header(6, 5, 14)).toBe(` Feed ${'─'.repeat(5)}`)
    expect(header(6, 5, 8)).toBe(' Feed')
    expect(header(6, 5, 7)).toBe(' Fe…')
    expect(header(6, 5, 4)).toBe('…')
    expect(headerParts(6, 5, 3)).toEqual([])
    expect(headerParts(6, 5, 0)).toEqual([])
  })

  test('without #n/N the segments are the space, the bold peach title (clipped too) and the line', () => {
    expect(headerParts(6, 5, 14)).toEqual([{ text: ' ' }, title, { text: ` ${'─'.repeat(5)}`, color: line }])
    expect(headerParts(6, 5, 7)).toEqual([{ text: ' ' }, { ...title, text: 'Fe…' }])
    expect(headerParts(6, 5, 5)).toEqual([{ text: ' ' }, { ...title, text: '…' }])
    expect(headerParts(6, 5, 4)).toEqual([{ ...title, text: '…' }])
  })

  test('the reading bar is not in the rail — no #n/N either', () => {
    expect(header(0, -1, 30)).toBe(` Feed ${'─'.repeat(21)}`)
    expect(header(3, 3, 30)).toBe(` Feed ${'─'.repeat(21)}`)
  })

  test('widths 0…200: the sum of segment widths is columns without the button, no empty segments, #n/N only with the whole title', () => {
    const cases: [number, number][] = [
      [0, -1],
      [1, 0],
      [6, 5],
      [6, 0],
      [150, 0],
      [150, 149],
      [1234, 999],
    ]

    for (const [count, reading] of cases) {
      for (let columns = 0; columns <= 200; columns++) {
        const parts = headerParts(count, reading, columns)
        const text = parts.map((part) => part.text).join('')

        expect(parts.reduce((sum, part) => sum + textWidth(part.text), 0)).toBe(Math.max(0, columns - FOLD_WIDTH))
        expect(parts.every((part) => part.text !== '')).toBe(true)
        // The title word, whole or clipped, is the only segment that starts with neither a space nor `#`.
        for (const part of parts.filter((part) => !part.text.startsWith(' ') && !part.text.startsWith('#'))) {
          expect(part).toMatchObject({ color: BAR_COLORS.title, weight: 'bold' })
        }

        if (text.includes('#')) {
          expect(text.startsWith(` Feed · #${reading + 1}/${count}`)).toBe(true)
          expect(parts.find((part) => part.text.startsWith('#'))?.color).toBe(BAR_COLORS.current)
        }
      }
    }
  })
})

describe('foldedLine', () => {
  const line = BAR_COLORS.line
  /** The folded rail as text after the button, as on the screen: the bars are talk glyphs. */
  const folded = (count: number, reading: number, columns: number, older = 0) => {
    const { head, line: bars, tail } = foldedLine(count, reading, columns, older)
    const drawn = bars === null ? '' : bars.gaps.map((gap, i) => gap.text + itemText(bars.items[i])).join('')

    return textsOf(head).join('') + drawn + textsOf(tail).join('')
  }

  test('the title, a space, the bar line with pointers at the reading bar, a line to the edge', () => {
    // The button (3) + ` Feed · #6/6 ` (13) + six bars with gaps (19): the line is 60 − 35 = 25 cells with the
    // space.
    expect(folded(6, 5, 60)).toBe(` Feed · #6/6  ▂▂ ▂▂ ▂▂ ▂▂ ▂▂▸▂▂◂ ${'─'.repeat(24)}`)
    expect(folded(6, 2, 60)).toBe(` Feed · #3/6  ▂▂ ▂▂▸▂▂◂▂▂ ▂▂ ▂▂  ${'─'.repeat(24)}`)

    const { head, tail } = foldedLine(6, 5, 60, 0)
    expect(head).toEqual([
      { text: ' ' },
      { text: 'Feed', color: BAR_COLORS.title, weight: 'bold' },
      { text: ' · ' },
      { text: '#6/6', color: BAR_COLORS.current },
      { text: ' ' },
    ])
    expect(tail).toEqual([{ text: ` ${'─'.repeat(24)}`, color: line }])
  })

  test('the bar window — by the space between the title and the line: counters of hidden bars and older, as in the unfolded rail', () => {
    // 30 bars in 40 columns: the space for the bar line is 40 − 3 − 15 − 2 = 20 cells.
    const { line: bars } = foldedLine(30, 29, 40, 2)
    const window = fitBars(30, 29, 20, 2)

    expect(bars).toEqual(barLine(window, 30, 2, 29))
    expect(folded(30, 29, 40, 2)).toBe(` Feed · #30/30  ‹27 ▂▂ ▂▂ ▂▂ ▂▂▸▂▂◂ ${'─'.repeat(1)}`)
    // A jump to the first bar: the window starts at it, only older on the left.
    expect(folded(30, 0, 40, 2)).toBe(` Feed · #1/30  ‹2▸▂▂◂▂▂ ▂▂ ▂▂ 26›  ${'─'.repeat(2)}`)
  })

  test('not a single bar fits — the header of the unfolded rail, without the bar line', () => {
    for (const columns of [0, 3, 8, 15, 19, 24]) {
      const result = foldedLine(6, 5, columns, 0)

      expect(result).toEqual({ head: headerParts(6, 5, columns), line: null, tail: [] })
    }

    // 25 columns: the button (3), the title with a space (13), the reading bar with the counter ‹5 and gaps (7)
    // and the line (2).
    expect(folded(6, 5, 24)).toBe(` Feed · #6/6 ${'─'.repeat(8)}`)
    expect(folded(6, 5, 25)).toBe(' Feed · #6/6  ‹5▸▂▂◂ ─')
  })

  test('widths 0…200: the line is exactly columns wide without the button, the reading bar is between the pointers, there is room for the line', () => {
    const cases: [number, number, number][] = [
      [1, 0, 0],
      [6, 5, 0],
      [6, 0, 3],
      [30, 10, 2],
      [150, 149, 0],
      [150, 0, 40],
    ]

    for (const [count, reading, older] of cases) {
      for (let columns = 0; columns <= 200; columns++) {
        const { head, line: bars, tail } = foldedLine(count, reading, columns, older)
        const text = folded(count, reading, columns, older)

        expect(textWidth(text)).toBe(Math.max(0, columns - FOLD_WIDTH))
        expect([...head, ...tail].every((part) => part.text !== '')).toBe(true)

        if (bars !== null) {
          expect(bars.items.some((item) => 'index' in item && item.index === reading)).toBe(true)
          expect(bars.items.filter((item) => 'index' in item).length).toBeLessThanOrEqual(MAX_BARS)
          expect(textsOf(bars.gaps)).toContain(POINTERS.left)
          expect(tail.length).toBe(1)
          expect(text.startsWith(` Feed · #${reading + 1}/${count} `)).toBe(true)
        }
      }
    }
  })
})

describe('barText', () => {
  /** A paste block with the id `id` and the lines `lines` — as in the text of a feed row (E5). */
  function pasted(id: string, ...lines: string[]): string {
    return `<pasted_content id="${id}">\n${lines.map((line) => `${line}\n`).join('')}</pasted_content id="${id}">`
  }

  test('a paste block of several lines — a token with the number of lines', () => {
    expect(barText(PASTED)).toBe(`[Pasted text +2 lines] ${PASTED_QUESTION}`)
    expect(barText(`${pasted('a1', 'one', '', 'three', 'four')} what is here?`)).toBe('[Pasted text +4 lines] what is here?')
  })

  test('a paste block of one line — line in the singular', () => {
    expect(barText(`${pasted('a1', 'one line')} question`)).toBe('[Pasted text +1 line] question')
  })

  test('an empty paste block — a token without a number', () => {
    expect(barText(`${pasted('a1')} question`)).toBe('[Pasted text] question')
    expect(barText(`${pasted('a1', '')} question`)).toBe('[Pasted text] question')
  })

  test('two pastes — a token for each, at its place in the text', () => {
    expect(barText(`compare${pasted('a1', 'x', 'y')}and${pasted('b2', 'z')}which is better?`)).toBe(
      'compare [Pasted text +2 lines] and [Pasted text +1 line] which is better?',
    )
  })

  test('the text before and after the paste stays', () => {
    expect(barText(`look at the log:\n${pasted('a1', 'ERROR 1', 'ERROR 2', 'ERROR 3')}\nand tell the cause`)).toBe(
      'look at the log: [Pasted text +3 lines] and tell the cause',
    )
  })

  test('only a paste — only the token', () => {
    expect(barText(`\n\n${pasted('a1', 'x', 'y', 'z')}\n\n`)).toBe('[Pasted text +3 lines]')
  })

  test('a paste next to an image tag — both are in the text', () => {
    expect(barText(`[Image #1] ${pasted('a1', 'caption')} what is this?`)).toBe('[Image #1] [Pasted text +1 line] what is this?')
  })

  test('the image tag stays', () => {
    expect(barText(IMAGE)).toBe(IMAGE)
  })

  test('the token counts towards BAR_TEXT_MAX: whole at the edge, clipped past the edge, with an ellipsis', () => {
    const token = '[Pasted text +2 lines]'
    const fits = 'ω'.repeat(BAR_TEXT_MAX - token.length - 1)

    expect(barText(`${fits}${pasted('a1', 'x', 'y')}`)).toBe(`${fits} ${token}`)
    expect([...barText(`${fits}${pasted('a1', 'x', 'y')}`)]).toHaveLength(BAR_TEXT_MAX)

    const cut = barText(`${fits}ω${pasted('a1', 'x', 'y')}`)

    expect([...cut]).toHaveLength(BAR_TEXT_MAX)
    expect(cut).toBe(`${fits}ω ${token.slice(0, -2)}…`)
  })

  test('a block without a closing tag of the same id — not a paste, it stays', () => {
    expect(barText('<pasted_content id="225b">\ntext\n</pasted_content id="ffff"> question')).toBe(
      '<pasted_content id="225b"> text </pasted_content id="ffff"> question',
    )
  })

  test('lines and whitespace runs are collapsed', () => {
    expect(barText('  first line\n\nsecond   line  ')).toBe('first line second line')
  })

  test('a long text — no longer than BAR_TEXT_MAX, with an ellipsis', () => {
    const text = barText('ω'.repeat(BAR_TEXT_MAX * 2))

    expect([...text].length).toBe(BAR_TEXT_MAX)
    expect(text.endsWith('…')).toBe(true)
  })

  test('exactly BAR_TEXT_MAX characters — unchanged', () => {
    const text = '漢'.repeat(BAR_TEXT_MAX)

    expect(barText(text)).toBe(text)
  })
})

/** The second line of the card, as on the screen: the kind name and the prompt text. */
function promptLine(lines: CardLines): string {
  return lines.name + lines.prompt
}

/** The card lines as text, as on the screen: the first and the second. */
function linesOf(lines: CardLines): [string, string] {
  return [lines.head, promptLine(lines)]
}

describe('cardLines', () => {
  test('talk: the number, the kind, the kind name and the prompt text — three pieces', () => {
    expect(cardLines(bar('a', 'answer in one word: ok'), 0, 80)).toEqual({
      head: '#1 · talk',
      name: '[Talk]',
      prompt: ' answer in one word: ok',
      kind: 'talk',
    })
  })

  test('the prompt line starts with the kind name in brackets, the text is a separate piece with a leading space', () => {
    const kinds: [BarKind, Partial<TurnSummary> | null][] = [
      ['edit', { tools: 2, edits: 1 }],
      ['agent', { tools: 1, agents: 1 }],
      ['skill', { tools: 1, skills: ['review'] }],
      ['work', { tools: 3 }],
      ['talk', {}],
      ['unknown', null],
    ]

    for (const [kind, fields] of kinds) {
      const item = bar('a', 'text', fields)
      const lines = cardLines(item, 0, 80)

      expect(kindOf(item.summary)).toBe(kind)
      expect(lines.kind).toBe(kind)
      expect(lines.name).toBe(`[${KIND_NAMES[kind]}]`)
      expect(lines.prompt).toBe(' text')
    }
  })

  test('a flagged turn — the name of its own kind: the summary shows the error', () => {
    expect(cardLines(bar('a', 'x', { tools: 2, edits: 1, errors: 1 }), 0, 80)).toEqual({
      head: '#1 · edits: 1 file · error',
      name: '[Edit]',
      prompt: ' x',
      kind: 'edit',
    })
  })

  test('the summary from the plan: edits, subagents, a skill, an error', () => {
    const lines = cardLines(bar('a', 'review', { tools: 9, edits: 3, agents: 2, skills: ['review'], errors: 1 }), 11, 80)

    expect(lines.head).toBe('#12 · edits: 3 files · subagents: 2 · skill: review · error')
  })

  test('edits — the English word form by the number of files: one for 1, another for the rest', () => {
    const line = (edits: number) => cardLines(bar('a', '', { tools: edits, edits }), 0, 80).head

    expect(line(1)).toBe('#1 · edits: 1 file')
    expect(line(2)).toBe('#1 · edits: 2 files')
    expect(line(5)).toBe('#1 · edits: 5 files')
    // The Russian plural exceptions no longer apply: 11, 21, 101 are "files" too.
    expect(line(11)).toBe('#1 · edits: 11 files')
    expect(line(21)).toBe('#1 · edits: 21 files')
    expect(line(101)).toBe('#1 · edits: 101 files')
  })

  test('subagents', () => {
    expect(cardLines(bar('a', '', { tools: 2, agents: 2 }), 0, 80).head).toBe('#1 · subagents: 2')
    expect(cardLines(bar('a', '', { tools: 1, agents: 1 }), 0, 80).head).toBe('#1 · subagents: 1')
  })

  test('one skill and several', () => {
    expect(cardLines(bar('a', '', { tools: 1, skills: ['review'] }), 0, 80).head).toBe('#1 · skill: review')
    expect(cardLines(bar('a', '', { tools: 2, skills: ['review', 'plan'] }), 0, 80).head).toBe('#1 · skills: review, plan')
  })

  test('work without edits, subagents and skills — the number of calls', () => {
    expect(cardLines(bar('a', '', { tools: 7 }), 0, 80).head).toBe('#1 · calls: 7')
    expect(cardLines(bar('a', '', { tools: 1 }), 0, 80).head).toBe('#1 · calls: 1')
  })

  test('one error, several errors, an interruption', () => {
    expect(cardLines(bar('a', '', { tools: 1, errors: 1 }), 0, 80).head).toBe('#1 · calls: 1 · error')
    expect(cardLines(bar('a', '', { tools: 3, errors: 2 }), 0, 80).head).toBe('#1 · calls: 3 · errors: 2')
    expect(cardLines(bar('a', '', { interrupted: true }), 0, 80).head).toBe('#1 · talk · interrupted')
    expect(cardLines(bar('a', '', { tools: 1, errors: 1, interrupted: true }), 0, 80).head).toBe(
      '#1 · calls: 1 · error · interrupted',
    )
  })

  test('no summary — the kind is unknown', () => {
    expect(linesOf(cardLines(bar('a', 'ok', null), 3, 80))).toEqual(['#4 · no summary', '[Unknown] ok'])
  })

  test('a long prompt is cut to the width with an ellipsis; the kind name is whole', () => {
    const lines = cardLines(bar('a', 'α'.repeat(100)), 0, 20)

    expect(lines.name).toBe('[Talk]')
    expect(lines.prompt).toBe(` ${'α'.repeat(12)}…`)
    expect(textWidth(promptLine(lines))).toBe(20)
  })

  test('the prompt text is the bar text as is: barText is what makes it one line', () => {
    expect(cardLines(bar('a', barText('first line\n\nsecond   line')), 0, 80).prompt).toBe(' first line second line')
  })

  test('wide characters: cut by cells, not by characters', () => {
    expect(promptLine(cardLines(bar('a', '漢字漢字漢字'), 0, 14))).toBe('[Talk] 漢字漢…')
    // The CJK character at the boundary does not fit whole — the line is narrower than the width.
    expect(promptLine(cardLines(bar('a', '漢字漢字漢字'), 0, 13))).toBe('[Talk] 漢字…')
  })

  test('the summary is clipped from the end', () => {
    const lines = cardLines(bar('a', 'review', { tools: 9, edits: 3, agents: 2, skills: ['review'], errors: 1 }), 11, 20)

    expect(lines.head).toBe('#12 · edits: 3 file…')
  })

  test('the prompt line is clipped as one line: too narrow for the text — an ellipsis after the name, too narrow for the name — the name is clipped', () => {
    const item = bar('a', 'text', { tools: 2, edits: 1 })

    expect(cardLines(item, 0, 8)).toMatchObject({ name: '[Edit]', prompt: ' …' })
    expect(cardLines(item, 0, 7)).toMatchObject({ name: '[Edit]', prompt: '…' })
    // The name is exactly the width and there is a text: the ellipsis takes the place of its last character.
    expect(cardLines(item, 0, 6)).toMatchObject({ name: '[Edit…', prompt: '' })
    expect(cardLines(item, 0, 3)).toMatchObject({ name: '[E…', prompt: '' })
    expect(cardLines(bar('a', '', { tools: 2, edits: 1 }), 0, 6)).toMatchObject({ name: '[Edit]', prompt: '' })
  })

  test('an empty text — the prompt line is the kind name alone', () => {
    expect(cardLines(bar('a', ''), 0, 80)).toEqual({ head: '#1 · talk', name: '[Talk]', prompt: '', kind: 'talk' })
  })

  test('zero width — empty lines', () => {
    expect(cardLines(bar('a', 'text'), 0, 0)).toEqual({ head: '', name: '', prompt: '', kind: 'talk' })
  })

  test('widths 0…200: CARD_ROWS lines, each no wider than columns and without padding, a clipped one — with an ellipsis', () => {
    const bars = [
      bar('a', ''),
      bar('b', 'ok', null),
      // The bar text always comes from `barText`: one line, the line break is collapsed.
      bar('c', barText('漢字 and text\non two lines '.repeat(10)), { tools: 40, edits: 12, agents: 3, skills: ['a', 'b'], errors: 5, interrupted: true }),
      bar('d', barText(`fix ${PASTED} please`), { tools: 1, errors: 1 }),
    ]

    for (const [index, item] of bars.entries()) {
      const full = linesOf(cardLines(item, index * 100, 1000))

      for (let columns = 0; columns <= 200; columns++) {
        const lines = linesOf(cardLines(item, index * 100, columns))

        expect(lines).toHaveLength(CARD_ROWS)

        lines.forEach((line, row) => {
          expect(textWidth(line)).toBeLessThanOrEqual(columns)
          expect(line).toBe(line.trimEnd())
          const whole = full[row] ?? ''

          // Fits — whole; does not fit — the start of the whole line and an ellipsis.
          if (textWidth(whole) <= columns) {
            expect(line).toBe(whole)
          } else if (columns > 0) {
            expect(line.endsWith('…')).toBe(true)
            expect(whole.startsWith(line.slice(0, -1))).toBe(true)
          }
        })
      }
    }
  })
})

describe('coverLines', () => {
  const reading = cardLines(bar('r', 'a long prompt of the reading bar', { tools: 9, edits: 3, errors: 1 }), 4, 80)

  test('a short hidden card is padded with spaces to the width of the lines of the reading bar card', () => {
    const card = coverLines(cardLines(bar('a', 'ok'), 0, 80), reading)

    // The kind is of its own card, not of the reading one under it.
    expect(card).toEqual({
      head: `#1 · talk${' '.repeat(textWidth(reading.head) - 9)}`,
      name: '[Talk]',
      prompt: ` ok${' '.repeat(textWidth(promptLine(reading)) - 9)}`,
      kind: 'talk',
    })
    expect(textWidth(card.head)).toBe(textWidth(reading.head))
    expect(textWidth(promptLine(card))).toBe(textWidth(promptLine(reading)))
  })

  test('a long line is neither padded nor clipped, the short one next to it is padded', () => {
    const long = cardLines(bar('a', 'a very long prompt of a hidden bar, longer than the reading one', { tools: 1 }), 0, 80)
    const card = coverLines(long, reading)

    expect(card.prompt).toBe(long.prompt)
    expect(textWidth(card.head)).toBe(textWidth(reading.head))
    expect(card.head.startsWith(long.head)).toBe(true)
  })

  test('a line of exactly the width — unchanged', () => {
    expect(coverLines(reading, reading)).toEqual(reading)
  })

  test('the kind name is not padded: the spaces are at the tail of the prompt, even with an empty text', () => {
    const card = coverLines(cardLines(bar('a', '', null), 0, 80), reading)

    expect(card.name).toBe('[Unknown]')
    expect(card.prompt.trim()).toBe('')
    expect(textWidth(promptLine(card))).toBe(textWidth(promptLine(reading)))
  })

  test('wide characters: padding by cells, not by characters', () => {
    const wide = cardLines(bar('w', '漢字漢字'), 0, 80)
    const card = coverLines(cardLines(bar('a', 'ab'), 0, 80), wide)

    // `[Talk] 漢字漢字` is 15 cells, `[Talk] ab` is 9: six spaces.
    expect(card.prompt).toBe(` ab${' '.repeat(6)}`)
    expect(textWidth(promptLine(card))).toBe(textWidth(promptLine(wide)))
  })

  test('widths 0…200: a padded line is no narrower than the line under it and no wider than columns', () => {
    const items = [bar('a', ''), bar('b', 'ok', null), bar('c', '漢字 and text '.repeat(20), { tools: 40, edits: 12, errors: 5, interrupted: true })]

    for (let columns = 0; columns <= 200; columns++) {
      for (const under of items) {
        for (const item of items) {
          const below = cardLines(under, 7, columns)
          const own = cardLines(item, 0, columns)
          const card = coverLines(own, below)

          expect(textWidth(card.head)).toBe(Math.max(textWidth(own.head), textWidth(below.head)))
          expect(textWidth(promptLine(card))).toBe(Math.max(textWidth(promptLine(own)), textWidth(promptLine(below))))
          expect(card.name).toBe(own.name)
          expect(card.head.trimEnd()).toBe(own.head.trimEnd())

          for (const line of [card.head, promptLine(card)]) {
            expect(textWidth(line)).toBeLessThanOrEqual(columns)
          }
        }
      }
    }
  })
})

describe('parseCommand', () => {
  test('no argument — help', () => {
    expect(parseCommand('')).toEqual({ kind: 'show' })
    expect(parseCommand('   ')).toEqual({ kind: 'show' })
  })

  test('steps, ignoring case and surrounding whitespace', () => {
    expect(parseCommand('next')).toEqual({ kind: 'next' })
    expect(parseCommand('prev')).toEqual({ kind: 'prev' })
    expect(parseCommand('first')).toEqual({ kind: 'first' })
    expect(parseCommand('  last  ')).toEqual({ kind: 'last' })
    expect(parseCommand('NEXT')).toEqual({ kind: 'next' })
  })

  test('a number and a number with a hash', () => {
    expect(parseCommand('12')).toEqual({ kind: 'index', n: 12 })
    expect(parseCommand('#12')).toEqual({ kind: 'index', n: 12 })
    expect(parseCommand(' #1 ')).toEqual({ kind: 'index', n: 1 })
  })

  test('a number out of range — a hint', () => {
    expect(parseCommand('0')).toEqual({ kind: 'bad', hint: 'no prompt #0' })
    expect(parseCommand('#0')).toEqual({ kind: 'bad', hint: 'no prompt #0' })
    expect(parseCommand('99999999999999999999')).toEqual({ kind: 'bad', hint: 'no prompt #99999999999999999999' })
  })

  test('search: the words as typed', () => {
    expect(parseCommand('find review  Plan')).toEqual({ kind: 'find', words: ['review', 'Plan'] })
    expect(parseCommand('FIND x')).toEqual({ kind: 'find', words: ['x'] })
  })

  test('search without words — a hint', () => {
    expect(parseCommand('find')).toEqual({ kind: 'bad', hint: 'find needs words: /tail-feed find <words>' })
    expect(parseCommand('find   ')).toEqual({ kind: 'bad', hint: 'find needs words: /tail-feed find <words>' })
  })

  test('the argument forms for help and the hint of the command list — from one list', () => {
    expect(COMMAND_FORMS).toBe('next, prev, first, last, toggle, <n>, #<n>, find <words>')
    expect(COMMAND_HINT).toBe('next|prev|first|last|toggle|<n>|#<n>|find <words>')
  })

  test('toggle — fold or unfold the rail, ignoring case; with an argument — not parsed', () => {
    expect(parseCommand('toggle')).toEqual({ kind: 'toggle' })
    expect(parseCommand('  TOGGLE ')).toEqual({ kind: 'toggle' })
    expect(parseCommand('toggle 2').kind).toBe('bad')
  })

  test('garbage — a hint with the argument forms', () => {
    for (const args of ['foo', '-1', '12abc', '#', '# 12', 'next 2', '3 4']) {
      const command = parseCommand(args)

      expect(command.kind).toBe('bad')
      expect(command.kind === 'bad' && command.hint).toBe(`didn't understand "${args.trim()}": /tail-feed ${COMMAND_FORMS}`)
    }
  })
})

describe('findBar', () => {
  const bars = [
    bar('a', 'do a review of the plan'),
    bar('b', 'fix the tests'),
    bar('c', 'One more REVIEW, now of the RÉSUMÉ parser'),
    bar('d', 'thanks'),
  ]

  test('the newest bar with a match', () => {
    expect(findBar(bars, ['review'])).toBe(2)
  })

  test('ignoring case', () => {
    expect(findBar(bars, ['TESTS'])).toBe(1)
    // Non-ASCII letters fold too.
    expect(findBar(bars, ['résumé'])).toBe(2)
    expect(findBar(bars, ['RÉSUMÉ'])).toBe(2)
  })

  test('all the words, in any order', () => {
    expect(findBar(bars, ['plan', 'review'])).toBe(0)
    expect(findBar(bars, ['review', 'tests'])).toBeNull()
  })

  test('not found, an empty rail — null', () => {
    expect(findBar(bars, ['deploy'])).toBeNull()
    expect(findBar([], ['review'])).toBeNull()
  })

  test('find pasted finds prompts with a paste: the search goes over the paste token in the bar text (accepted on purpose)', () => {
    const withPaste = [
      bar('a', barText(PASTED)),
      bar('b', 'thanks'),
      bar('c', barText('<pasted_content id="1f">\nstacktrace\n</pasted_content id="1f"> what is this?')),
      bar('d', 'and now without a paste'),
    ]

    expect(findBar(withPaste, ['pasted'])).toBe(2)
    expect(findBar(withPaste, ['Pasted', PASTED_QUESTION.split(' ')[0] ?? ''])).toBe(0)
    // The content of the block does not get into the bar text: it cannot be found by it.
    expect(findBar(withPaste, ['stacktrace'])).toBeNull()
  })

  test('the paste token for search is the single word pasted: text, lines and the number of lines are not searched in it', () => {
    const withPaste = [
      bar('a', 'read the text of the log'),
      bar('b', barText('<pasted_content id="1f">\none\ntwo\n</pasted_content id="1f"> what is this?')),
      bar('c', barText('<pasted_content id="2e">\nline\n</pasted_content id="2e"> and this?')),
    ]

    expect(withPaste.map((item) => item.text)).toEqual([
      'read the text of the log',
      '[Pasted text +2 lines] what is this?',
      '[Pasted text +1 line] and this?',
    ])
    expect(findBar(withPaste, ['text'])).toBe(0)
    expect(findBar(withPaste, ['lines'])).toBeNull()
    expect(findBar(withPaste, ['line'])).toBeNull()
    expect(findBar(withPaste, ['+2'])).toBeNull()
    expect(findBar(withPaste, ['pasted'])).toBe(2)
    expect(findBar(withPaste, ['pasted', 'what'])).toBe(1)
    // A word outside the token is searched as is.
    expect(findBar([bar('a', 'pasted text into the file'), ...withPaste.slice(1, 2)], ['text'])).toBe(0)
  })
})

describe('stepTarget', () => {
  const bars = [bar('a', 'one'), bar('b', 'two'), bar('c', 'three')]

  test('reading the newest: next — the edge, prev — the previous one', () => {
    expect(stepTarget(bars, null, 'next')).toBeNull()
    expect(stepTarget(bars, null, 'prev')).toBe(1)
  })

  test('in the middle — the neighbours', () => {
    expect(stepTarget(bars, 'b', 'next')).toBe(2)
    expect(stepTarget(bars, 'b', 'prev')).toBe(0)
  })

  test('at the first: prev — the edge', () => {
    expect(stepTarget(bars, 'a', 'prev')).toBeNull()
    expect(stepTarget(bars, 'a', 'next')).toBe(1)
  })

  test('first and last always lead to the edge, even from it', () => {
    expect(stepTarget(bars, 'b', 'first')).toBe(0)
    expect(stepTarget(bars, 'a', 'first')).toBe(0)
    expect(stepTarget(bars, null, 'last')).toBe(2)
    expect(stepTarget(bars, 'c', 'last')).toBe(2)
  })

  test('a jump id that is not in the rail — reading the newest', () => {
    expect(stepTarget(bars, 'gone', 'prev')).toBe(1)
    expect(stepTarget(bars, 'gone', 'next')).toBeNull()
  })
})

describe('readingIndex', () => {
  const bars = [bar('a', 'one'), bar('b', 'two'), bar('c', 'three')]

  test('the bar of the last jump; without a jump and without its bar — the newest; an empty rail — -1', () => {
    expect(readingIndex(bars, 'a')).toBe(0)
    expect(readingIndex(bars, null)).toBe(2)
    expect(readingIndex(bars, 'gone')).toBe(2)
    expect(readingIndex([], null)).toBe(-1)
  })
})

describe('commandArgs', () => {
  test('the commands without an argument — next, prev and toggle, their own argument is not read', () => {
    expect(commandArgs('tail-feed-next', '')).toBe('next')
    expect(commandArgs('tail-feed-prev', '')).toBe('prev')
    expect(commandArgs('tail-feed-toggle', '')).toBe('toggle')
    expect(commandArgs('tail-feed-next', 'first')).toBe('next')
    expect(commandArgs('tail-feed-toggle', '3')).toBe('toggle')
  })

  test('/tail-feed — the typed argument as is', () => {
    expect(commandArgs('tail-feed', ' find review ')).toBe(' find review ')
    expect(commandArgs('tail-feed', '')).toBe('')
  })
})

describe('aimCommand', () => {
  const bars = [
    bar('a', 'do a review of the plan'),
    bar('b', 'fix the tests'),
    bar('c', 'one more review, now of the code'),
    bar('d', 'thanks'),
    bar('e', 'run the checks'),
  ]
  const rail: RailState = { bars, older: 0, current: 'c' }

  /** The decision of the command `/tail-feed <args>` for the rail. */
  function aim(args: string, of: RailState = rail): CommandAim {
    return aimCommand(parseCommand(args), of)
  }

  test('toggle — folding with any rail, an empty one too', () => {
    expect(aim('toggle')).toEqual({ kind: 'toggle' })
    expect(aim('toggle', { bars: [], older: 3, current: null })).toEqual({ kind: 'toggle' })
    expect(aimCommand(parseCommand(commandArgs('tail-feed-toggle', '')), rail)).toEqual({ kind: 'toggle' })
  })

  test('each argument form leads to its bar, the number is one-based', () => {
    expect(aim('first')).toEqual({ kind: 'jump', id: 'a', n: 1 })
    expect(aim('last')).toEqual({ kind: 'jump', id: 'e', n: 5 })
    expect(aim('next')).toEqual({ kind: 'jump', id: 'd', n: 4 })
    expect(aim('prev')).toEqual({ kind: 'jump', id: 'b', n: 2 })
    expect(aim('2')).toEqual({ kind: 'jump', id: 'b', n: 2 })
    expect(aim('#5')).toEqual({ kind: 'jump', id: 'e', n: 5 })
    expect(aim('find REVIEW')).toEqual({ kind: 'jump', id: 'c', n: 3 })
    expect(aim('find plan review')).toEqual({ kind: 'jump', id: 'a', n: 1 })
  })

  test('the commands without an argument — the same as next and prev', () => {
    expect(aimCommand(parseCommand(commandArgs('tail-feed-next', '')), rail)).toEqual(aim('next'))
    expect(aimCommand(parseCommand(commandArgs('tail-feed-prev', '')), rail)).toEqual(aim('prev'))
  })

  test('no jump: next and prev go from the newest when there were no jumps', () => {
    const fresh = { ...rail, current: null }

    expect(aim('next', fresh)).toEqual({ kind: 'reply', text: '#5 is the last in the rail' })
    expect(aim('prev', fresh)).toEqual({ kind: 'jump', id: 'd', n: 4 })
  })

  test('the edge of the rail — a reply without a jump; at the first — also the turns above without a bar', () => {
    expect(aim('next', { ...rail, current: 'e' })).toEqual({ kind: 'reply', text: '#5 is the last in the rail' })
    expect(aim('prev', { ...rail, current: 'a' })).toEqual({ kind: 'reply', text: '#1 is the first in the rail' })
    expect(aim('prev', { ...rail, current: 'a', older: 3 })).toEqual({
      kind: 'reply',
      text: '#1 is the first in the rail; 3 older turns above without a bar',
    })
    expect(aim('prev', { ...rail, current: 'a', older: 1 })).toEqual({
      kind: 'reply',
      text: '#1 is the first in the rail; 1 older turn above without a bar',
    })
  })

  test('first and last from the edge — a jump all the same', () => {
    expect(aim('first', { ...rail, current: 'a' })).toEqual({ kind: 'jump', id: 'a', n: 1 })
    expect(aim('last', { ...rail, current: null })).toEqual({ kind: 'jump', id: 'e', n: 5 })
  })

  test('no such number, words not found, garbage — a reply without a jump', () => {
    expect(aim('6')).toEqual({ kind: 'reply', text: 'no prompt #6: the rail has 5 bars' })
    expect(aim('#21', { ...rail, bars: bars.slice(0, 1) })).toEqual({ kind: 'reply', text: 'no prompt #21: the rail has 1 bar' })
    expect(aim('0')).toEqual({ kind: 'reply', text: 'no prompt #0' })
    expect(aim('find deploy  prod')).toEqual({ kind: 'reply', text: 'not found: "deploy prod"' })
    expect(aim('find')).toEqual({ kind: 'reply', text: 'find needs words: /tail-feed find <words>' })
    expect(aim('forward')).toEqual({ kind: 'reply', text: `didn't understand "forward": /tail-feed ${COMMAND_FORMS}` })
  })

  test('an empty rail — nowhere to jump, any form', () => {
    const empty: RailState = { bars: [], older: 0, current: null }

    for (const args of ['next', 'prev', 'first', 'last', '1', 'find review']) {
      expect(aim(args, empty)).toEqual({ kind: 'reply', text: 'no bars — nowhere to jump' })
    }

    expect(aim('last', { ...empty, older: 7 })).toEqual({
      kind: 'reply',
      text: 'no bars — nowhere to jump; 7 older turns above without a bar',
    })
  })

  test('no argument — help: how many bars, which one is being read, the argument forms', () => {
    expect(aim('')).toEqual({ kind: 'reply', text: `5 bars, reading #3. /tail-feed ${COMMAND_FORMS}` })
    expect(aim('', { ...rail, current: null, older: 1 })).toEqual({
      kind: 'reply',
      text: `5 bars, reading #5; 1 older turn above without a bar. /tail-feed ${COMMAND_FORMS}`,
    })
    expect(aim('', { ...rail, bars: bars.slice(0, 1), current: null, older: 3 })).toEqual({
      kind: 'reply',
      text: `1 bar, reading #1; 3 older turns above without a bar. /tail-feed ${COMMAND_FORMS}`,
    })
    expect(aim('', { bars: [], older: 0, current: null })).toEqual({
      kind: 'reply',
      text: `no bars. /tail-feed ${COMMAND_FORMS}`,
    })
  })
})

describe('jumpReply', () => {
  test('a successful jump replies without a text', () => {
    expect(jumpReply(3, {})).toEqual({})
  })

  test('a denial — the denial text as is, with the bar number, for the human only', () => {
    expect(jumpReply(3, { deny: 'nothing drawn under that requestId' })).toEqual({
      text: "didn't jump to #3: nothing drawn under that requestId",
      isTextDisplayOnly: true,
    })
    expect(jumpReply(1, { deny: 'transcript not scrollable here' })).toEqual(
      replyOf("didn't jump to #1: transcript not scrollable here"),
    )
  })
})

describe('foldReply and foldNote', () => {
  test('a successful fold replies without a text, a failure — with the error text for the human only, without the mod prefix', () => {
    expect(foldReply(null)).toEqual({})
    expect(foldReply('state is gone')).toEqual(replyOf("didn't toggle the rail: state is gone"))
  })

  test('the debug log line about a failure — with the mod name, as for a jump', () => {
    expect(foldNote('state is gone')).toBe("tail-feed: didn't toggle the rail: state is gone")
  })
})

describe('replyOf and jumpNote', () => {
  test('the reply line of a command does not go into the model request', () => {
    expect(replyOf('no bars')).toEqual({ text: 'no bars', isTextDisplayOnly: true })
  })

  test('the debug log line names the jump row and the denial', () => {
    expect(jumpNote('r2', 'nothing drawn under that requestId')).toBe(
      "tail-feed: didn't jump to row r2: nothing drawn under that requestId",
    )
  })
})
