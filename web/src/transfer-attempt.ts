export type TransferDraft = { body: Record<string, string>; key: string; transferId?: string };
export type TransferAttemptSummary = { destinationType: 'beneficiary' | 'own_account'; amountMinor: string; concept: string; reference: string };

const storageKey = (userId: string) => `wallet:web:transfer-attempt:${userId}`;
const prefix = 'wallet:web:transfer-attempt:';
const activeUserKey = 'wallet:web:active-user';

export function activateTransferUser(userId: string) {
  try {
    const previousUserId = sessionStorage.getItem(activeUserKey);
    if (previousUserId && previousUserId !== userId) clearAllTransferDrafts();
    sessionStorage.setItem(activeUserKey, userId);
  } catch { /* Recovery stays scoped by userId even when browser storage is unavailable. */ }
}

export function readTransferDraft(userId: string): TransferDraft | null {
  try {
    const raw = sessionStorage.getItem(storageKey(userId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<TransferDraft>;
    const body = value.body;
    const validBody = body && typeof body === 'object' && !Array.isArray(body)
      && Object.values(body).every((field) => typeof field === 'string')
      && (body.destinationType === 'beneficiary' || body.destinationType === 'own_account');
    if (typeof value.key !== 'string' || !value.key || !validBody || (value.transferId !== undefined && typeof value.transferId !== 'string')) {
      sessionStorage.removeItem(storageKey(userId));
      return null;
    }
    return { key: value.key, body: body as Record<string, string>, ...(typeof value.transferId === 'string' ? { transferId: value.transferId } : {}) };
  } catch {
    return null;
  }
}

/** Exposes only presentation-safe fields for same-tab recovery context; never returns the key or account identifiers. */
export function readActiveTransferSummary(): TransferAttemptSummary | null {
  try {
    const userId = sessionStorage.getItem(activeUserKey);
    if (!userId) return null;
    const draft = readTransferDraft(userId);
    if (!draft) return null;
    const { destinationType, amountMinor, concept, reference } = draft.body;
    if ((destinationType !== 'beneficiary' && destinationType !== 'own_account')
      || typeof amountMinor !== 'string' || !/^[1-9][0-9]*$/.test(amountMinor)
      || typeof concept !== 'string' || concept.length < 1 || concept.length > 40
      || typeof reference !== 'string' || !/^[0-9]{1,7}$/.test(reference)) return null;
    return { destinationType, amountMinor, concept, reference };
  } catch { return null; }
}

export function saveTransferDraft(userId: string, draft: TransferDraft) {
  // Persist only the exact create request and its idempotency key; never OTP/demoOnlyCode.
  try {
    const safeDraft = { key: draft.key, body: draft.body, ...(draft.transferId ? { transferId: draft.transferId } : {}) };
    sessionStorage.setItem(storageKey(userId), JSON.stringify(safeDraft));
  } catch { /* Recovery remains available in memory if storage is unavailable. */ }
}

export function clearTransferDraft(userId: string) {
  try { sessionStorage.removeItem(storageKey(userId)); } catch { /* Ignore unavailable browser storage. */ }
}

export function clearAllTransferDrafts() {
  try {
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(prefix)) sessionStorage.removeItem(key);
    }
  } catch { /* Ignore unavailable browser storage. */ }
}

export function forgetTransferUser() {
  try { sessionStorage.removeItem(activeUserKey); } catch { /* Ignore unavailable browser storage. */ }
}
