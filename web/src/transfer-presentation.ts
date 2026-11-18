/** Presentation-only fields that may arrive on the create response but not on a later status GET. */
export type DemoCodeTransfer = { status: string; demoOnlyCode?: string };

/**
 * Keep the demo code only in the in-memory view model while the server still expects confirmation.
 * The fresh transfer remains authoritative for every other field and terminal status.
 */
export function mergeTransferDemoCode<T extends DemoCodeTransfer>(fresh: T, previous?: Pick<DemoCodeTransfer, 'demoOnlyCode'>): T {
  if (fresh.status !== 'awaiting_confirmation' || fresh.demoOnlyCode || !previous?.demoOnlyCode) return fresh;
  return { ...fresh, demoOnlyCode: previous.demoOnlyCode };
}
