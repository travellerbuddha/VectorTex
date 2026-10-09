import { IllegalTransitionError } from '@texholiday/contracts';

/**
 * Why a transition happens.
 * - COMMAND: an authorized domain command (never a raw "set status" edit).
 * - UPSTREAM_RESULT: a direct, verified result of our own call.
 * - RECONCILIATION: a provider/gateway lookup resolving an UNKNOWN or late state.
 */
export type TransitionCause = 'COMMAND' | 'UPSTREAM_RESULT' | 'RECONCILIATION';

export interface Machine<S extends string> {
  readonly name: string;
  readonly states: readonly S[];
  readonly terminal: ReadonlySet<S>;
  canTransition(from: S, to: S, cause: TransitionCause): boolean;
  assertTransition(from: S, to: S, cause: TransitionCause): void;
}

export function defineMachine<S extends string>(spec: {
  name: string;
  transitions: Readonly<Record<S, readonly S[]>>;
  /** State that may only be left with cause RECONCILIATION. */
  unknownState?: S;
  terminal: readonly S[];
}): Machine<S> {
  const states = Object.keys(spec.transitions) as S[];
  const terminal = new Set(spec.terminal);
  for (const t of terminal) {
    if ((spec.transitions[t] ?? []).length > 0) throw new Error(`${spec.name}: terminal state ${t} has exits`);
  }
  const allowed = new Map<S, ReadonlySet<S>>(states.map((s) => [s, new Set(spec.transitions[s])]));

  const canTransition = (from: S, to: S, cause: TransitionCause): boolean => {
    if (!allowed.get(from)?.has(to)) return false;
    if (spec.unknownState !== undefined && from === spec.unknownState && cause !== 'RECONCILIATION') return false;
    return true;
  };

  return {
    name: spec.name,
    states,
    terminal,
    canTransition,
    assertTransition(from, to, cause) {
      if (!canTransition(from, to, cause)) throw new IllegalTransitionError(spec.name, from, to);
    },
  };
}
