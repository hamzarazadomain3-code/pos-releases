/**
 * The phone drawer — the pure state machine.
 *
 * The drawer is either open or closed. A route change always closes it (so
 * picking a page lands the owner back on the app), and a Back press closes it
 * too (one history entry, never two).
 */
export type DrawerState = 'closed' | 'open';

export type DrawerAction =
  | { type: 'open' }
  | { type: 'close' }
  | { type: 'toggle' }
  | { type: 'routeChanged' }
  | { type: 'back' };

export function drawerReducer(state: DrawerState, action: DrawerAction): DrawerState {
  switch (action.type) {
    case 'open':
      return 'open';
    case 'close':
    case 'routeChanged':
    case 'back':
      return 'closed';
    case 'toggle':
      return state === 'open' ? 'closed' : 'open';
    default:
      return state;
  }
}

export function isDrawerOpen(state: DrawerState): boolean {
  return state === 'open';
}
