/**
 * What the main agent did in a turn — from a human prompt to the next human
 * prompt. Computed from the tool calls of the transcript (`summarize`).
 */
export type TurnSummary = {
  /** Total tool calls, with and without errors. */
  tools: number
  /** Distinct files in successful Edit, Write, NotebookEdit calls; a call without a path is a separate file. */
  edits: number
  /** Successful Agent and Workflow calls. */
  agents: number
  /** Skill names from successful Skill calls (`input.skill`), without repeats, in call order. */
  skills: string[]
  /** Calls with `isError`: a tool error, a permission denial, a command with a non-zero exit code. */
  errors: number
  /** The turn was interrupted by the human (Esc, permission denial) or cut off (`turn.complete` with `aborted`). */
  interrupted: boolean
}

/** A bar of the rail: the `UserMessage` row of a human prompt and the summary of its turn. */
export type Bar = {
  /** `requestId` of the `UserMessage` row — the jump target. */
  id: string
  /**
   * The prompt for the card and the search (`barText`): a paste block is the token `[Pasted text +N lines]`,
   * whitespace is collapsed, no longer than `BAR_TEXT_MAX`.
   */
  text: string
  /** The turn summary; null — the turn is running or not bound (kind `unknown`). */
  summary: TurnSummary | null
}

/** The rail of bars of the session (`$.state` is bound to the session). */
export type RailState = {
  /** Bars in feed order, oldest first. */
  bars: Bar[]
  /** Transcript turns older than the first bar that have no row yet (rows are drawn lazily). */
  older: number
  /**
   * id of the bar of the last jump: the reading bar and the mark above its prompt in the feed; null — the
   * newest bar is the reading one, there is no mark.
   */
  current: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'tail-feed': {
      /**
       * The rail of bars. Stored with a shape tag (`atom(ref, initial, { shape })`):
       * a value of another version of the mod reads as the initial one.
       */
      rail: Shaped<RailState>
      /**
       * The rail is folded by its own button (`[-]`/`[+]`, the `toggle` command) into one line: header and bars, no
       * card. Only the toggle writes it, not `flush`; no value — unfolded.
       */
      folded: boolean
    }
  }
}
