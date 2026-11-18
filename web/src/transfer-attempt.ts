export type TransferDraft = { body: Record<string, string>; key: string; transferId?: string };

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
    if (typeof value.key !== 'string' || !value.key || !value.body || typeof value.body !== 'object') {
      sessionStorage.removeItem(storageKey(userId));
      return null;
    }
    return { key: value.key, body: value.body as Record<string, string>, ...(typeof value.transferId === 'string' ? { transferId: value.transferId } : {}) };
  } catch {
    return null;
  }
}

export function saveTransferDraft(userId: string, draft: TransferDraft) {
  // Persist only the exact create request and its idempotency key; never OTP/demoOnlyCode.
  try { sessionStorage.setItem(storageKey(userId), JSON.stringify(draft)); } catch { /* Recovery remains available in memory if storage is unavailable. */ }
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
