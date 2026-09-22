/** 助手会话状态机：处理记录、连续拒绝计数、静默。 */

import type { AssistantState, HandledEntry } from './types';

/** 连续拒绝多少条后进入静默模式。 */
export const QUIET_THRESHOLD = 3;

export function createAssistantState(): AssistantState {
  return { handled: {}, dismissStreak: 0, quiet: false };
}

/** 采纳与保持需求都会打断「连续拒绝」，只有连续的拒绝才累计。 */
export function handleSuggestion(
  state: AssistantState,
  id: string,
  status: HandledEntry['status'],
  text?: string,
): AssistantState {
  const handled = { ...state.handled, [id]: text ? { status, text } : { status } };
  if (status === 'ignored') {
    const dismissStreak = state.dismissStreak + 1;
    return { handled, dismissStreak, quiet: state.quiet || dismissStreak >= QUIET_THRESHOLD };
  }
  return { handled, dismissStreak: 0, quiet: state.quiet };
}

export function toggleQuiet(state: AssistantState, quiet = !state.quiet): AssistantState {
  return { ...state, quiet, dismissStreak: quiet ? state.dismissStreak : 0 };
}

export function handledIds(state: AssistantState): string[] {
  return Object.keys(state.handled);
}

export function handledCount(state: AssistantState): number {
  return handledIds(state).length;
}

export function adoptedTexts(state: AssistantState): string[] {
  return Object.values(state.handled)
    .filter((h) => h.status === 'adopted')
    .map((h) => h.text ?? '')
    .filter(Boolean);
}
