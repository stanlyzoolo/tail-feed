// The strip's rail under a blank line: the header with the fold button, the
// bars of the visible window, the counters of hidden bars, the card of the
// reading bar and the cards that hovering shows — or, folded, one line of the
// header and the bars; the mark above the prompt of the last jump in the
// feed. Gets a ready rail from `$.state` (the mark — its parts
// `markParts`), whether it is folded, and the table of the surface's elements;
// knows nothing about events: a jump is the `onJump` callback, folding is
// `onToggle`.

import type { Elements, RenderElement } from 'claude-code'

import type { Bar, RailState } from '../types'
import {
  BAR_COLORS,
  BAR_WIDTH,
  barColor,
  barLine,
  CARD_ROWS,
  cardLines,
  coverLines,
  fitBars,
  FOLD_WIDTH,
  foldedLine,
  foldLabel,
  GLYPHS,
  headerParts,
  KIND_COLORS,
  KIND_NAMES,
  kindOf,
  readingIndex,
  TOP_ROWS,
} from './lib'
import type { BarLine, CardLines, LineItem, MarkParts, Part } from './lib'

/** Terminal elements from `$.ui.resolve(e)`: the rail is drawn only there. */
type TerminalElements = Elements['terminal']

/**
 * The hover group of bar number `index` (zero-based): the bar and its card.
 * Hovering the bar lights the group and shows the card.
 */
export function scopeOf(index: number): string {
  return `c${index}`
}

/** The key of a bar's button: its address for `ui.press`. */
export function barKey(id: string): string {
  return `bar:${id}`
}

/** The key of a bar's hover area (the `Box` around the button); the prefix tells it from the button's key. */
export function hoverKey(id: string): string {
  return `hover:${id}`
}

/** The key of the rail's fold button (`[-]`, `[+]`): its address for `ui.press`. */
export const FOLD_KEY = 'fold'

/**
 * A segment of a rail line (`headerParts`, `barLine`): a `Text` of its own colour and weight; no colour — terminal
 * text's.
 */
function partOf(ui: TerminalElements, { text, ...style }: Part): RenderElement {
  const { Text } = ui

  return <Text {...style}>{text}</Text>
}

/**
 * The card lines `lines` (`cardLines`, `coverLines`): the first is dimmed, in
 * the second the kind name is in the kind's colour (`KIND_COLORS`), for a
 * flagged turn too. A narrow strip truncates them from the end.
 */
function cardRows(ui: TerminalElements, lines: CardLines): RenderElement[] {
  const { Text } = ui

  return [
    <Text dimColor wrap="truncate-end">
      {lines.head}
    </Text>,
    <Text wrap="truncate-end">
      <Text color={KIND_COLORS[lines.kind]}>{lines.name}</Text>
      {lines.prompt}
    </Text>,
  ]
}

/** `top` above `below` (what is lower in the `ui.render` chain), in one column. */
export function stacked(ui: TerminalElements, top: RenderElement, below: RenderElement): RenderElement {
  const { Box } = ui

  return (
    <Box flexDirection="column">
      {top}
      {below}
    </Box>
  )
}

/**
 * The mark line above the row of the prompt of the last jump in the feed
 * (`markParts`): `▸ #n/N · ` in the "you are here" colour (`BAR_COLORS.current`, like
 * the pointers of the reading bar and the `#n/N` of the header) and the kind name in the kind's colour — like
 * the `[Edit]` of the card, for a flagged turn too. A narrow feed truncates it from the end.
 */
export function markLine(ui: TerminalElements, parts: MarkParts): RenderElement {
  const { Text } = ui

  return (
    <Text wrap="truncate-end">
      <Text color={BAR_COLORS.current}>{parts.label}</Text>
      <Text color={KIND_COLORS[parts.kind]}>{KIND_NAMES[parts.kind]}</Text>
    </Text>
  )
}

/**
 * The fold button at the start of the header line (`foldLabel`: `[-]` on an
 * unfolded rail, `[+]` on a folded one) — a `plain` button, the label in the
 * colour of the header lines (`BAR_COLORS.line`).
 */
function foldButton(ui: TerminalElements, folded: boolean, onToggle: () => void): RenderElement {
  const { Button, Text } = ui
  const label = foldLabel(folded)

  return (
    <Button key={FOLD_KEY} plain label={label} onPress={onToggle}>
      <Text color={BAR_COLORS.line}>{label}</Text>
    </Button>
  )
}

/**
 * The strip's rail. Above it are TOP_ROWS blank lines (`paddingTop`), in both
 * views. Unfolded (`folded` false): the header line — the `[-]` button
 * (`foldButton`) followed by `headerParts` (` Feed · #n/N ─────` to the edge,
 * as one `Text`: if it does not fit, it is truncated from the end, not
 * wrapped), under it the bar line (`barLine`: `‹N`, the bars of the `fitBars`
 * window, `N›`) and CARD_ROWS card lines (`cardRows`), which are always there
 * (E4): the rail's height does not depend on hovering. A bar is the kind's
 * glyph BAR_WIDTH times, in the kind's colour (`barColor`). The items of the
 * bar line are separated by gap cells; there is a cell at the start and at the
 * end of the line too. The reading bar (`reading`, the index from
 * `readingIndex`) is the bar of the last jump (`current`), without a jump —
 * the newest: the bar window always keeps it (`fitBars`), the cells at its
 * sides are pointers in the `BAR_COLORS.current` colour, and its card is
 * visible without hovering too — first among the card lines. The cards of the
 * other visible bars lie behind it hidden (`position: "absolute"`, in bar
 * order) and so are drawn over it: hovering a bar opens its card (the
 * `scopeOf` group), and the padding with spaces (`coverLines`) wipes out the
 * letters of the reading bar's card. The reading bar has no hidden card:
 * hovering it opens nothing. The kind name in the card (`[Edit]`) is in the
 * kind's colour, for a flagged turn too. Not a single bar in the window —
 * null: the rail is not drawn.
 *
 * Folded (`folded` true) — one line under the blank one: the `[+]` button, the
 * header label, the bar line and a line to the edge (`foldedLine`); no cards.
 * Not a single bar fits — the button and the header: the rail can always be
 * unfolded while the strip has room for the button.
 *
 * `columns` is the strip's width (`bodyColumns`). An empty rail or a strip
 * narrower than the fold button — null. A click on a bar — `onJump` with the
 * id of its row, on the fold button — `onToggle`.
 */
export function railRow(
  ui: TerminalElements,
  rail: RailState,
  columns: number,
  folded: boolean,
  onJump: (id: string) => void,
  onToggle: () => void,
): RenderElement | null {
  const { Box, Button, Text } = ui
  const reading = readingIndex(rail.bars, rail.current)
  const readingBar = rail.bars[reading]

  if (readingBar === undefined || columns < FOLD_WIDTH) {
    return null
  }

  // An item of the bar line: a counter — as dimmed text, a bar — as a button in its own hover group.
  const itemOf = (item: LineItem): RenderElement[] => {
    if ('label' in item) {
      return [<Text dimColor>{item.label}</Text>]
    }

    // A bar of the window is always in the rail: `barLine` takes the numbers from the `fitBars` window.
    const bar = rail.bars[item.index]

    if (bar === undefined) {
      return []
    }

    const glyph = GLYPHS[kindOf(bar.summary)].repeat(BAR_WIDTH)

    // Under the pointer the engine inverts the button: for `▂▂` the top of the
    // cell above the empty stripe becomes the coloured part (the bar "jumps"),
    // `██` becomes an empty cell (the bar disappears). The engine puts the
    // `hover` styles of a plain button after its own inversion, and
    // `inverse: false` removes it; hovering is shown by the bar's card. Keyboard
    // focus (ctrl+x tab) inverts the bar, as before.
    return [
      <Box key={hoverKey(bar.id)} hover={{ scope: scopeOf(item.index) }}>
        <Button key={barKey(bar.id)} plain label={glyph} hover={{ inverse: false }} onPress={() => onJump(bar.id)}>
          <Text color={barColor(bar.summary)}>{glyph}</Text>
        </Button>
      </Box>,
    ]
  }
  // The bar line: a gap cell before each item, the last one — after the last item.
  const lineOf = (line: BarLine): RenderElement => (
    <Box flexDirection="row">
      {line.gaps.flatMap((gap, i) => {
        const item = line.items[i]

        return [partOf(ui, gap), ...(item === undefined ? [] : itemOf(item))]
      })}
    </Box>
  )
  // Segments as one line: if they do not fit, they are truncated from the end, not wrapped.
  const textOf = (parts: Part[]): RenderElement[] =>
    parts.length === 0 ? [] : [<Text wrap="truncate-end">{parts.map((part) => partOf(ui, part))}</Text>]

  if (folded) {
    const { head, line, tail } = foldedLine(rail.bars.length, reading, columns, rail.older)

    return (
      <Box flexDirection="row" paddingTop={TOP_ROWS}>
        {[foldButton(ui, true, onToggle), ...textOf(head), ...(line === null ? [] : [lineOf(line)]), ...textOf(tail)]}
      </Box>
    )
  }

  const window = fitBars(rail.bars.length, reading, columns, rail.older)

  if (window.from === window.to) {
    return null
  }

  const visible = rail.bars.slice(window.from, window.to).map((bar, i): [Bar, number] => [bar, window.from + i])
  const line = barLine(window, rail.bars.length, rail.older, reading)
  const header = headerParts(rail.bars.length, reading, columns)
  // The card of the reading bar is always visible; hovering opens the cards of the others over it.
  const under = cardLines(readingBar, reading, columns)

  return (
    <Box flexDirection="column" paddingTop={TOP_ROWS}>
      <Box flexDirection="row">{[foldButton(ui, false, onToggle), ...textOf(header)]}</Box>
      {lineOf(line)}
      <Box width="100%" height={CARD_ROWS}>
        <Box width="100%" height={CARD_ROWS} flexDirection="column">
          {cardRows(ui, under)}
        </Box>
        {visible
          .filter(([, index]) => index !== reading)
          .map(([bar, index]) => {
            const lines = cardLines(bar, index, columns)

            return (
              <Box
                position="absolute"
                top={0}
                left={0}
                width="100%"
                height={CARD_ROWS}
                flexDirection="column"
                display="none"
                hover={{ scope: scopeOf(index), display: 'flex' }}
              >
                {cardRows(ui, coverLines(lines, under))}
              </Box>
            )
          })}
      </Box>
    </Box>
  )
}
