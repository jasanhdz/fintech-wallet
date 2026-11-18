// Normalised non-GET traces for REC-02: method, path, Idempotency-Key equality class and body hash.
// Keys and bodies never appear in the trace; only their equality class and SHA-256.
import type { Page } from '@playwright/test';
import type { RecordedRequest } from './mock-api.js';

export type TraceStep = { method: string; path: string; keyClass: string; bodySha256: string | null; aborted: boolean };
export type ScenarioTrace = { scenario: string; steps: TraceStep[]; draftAfter: 'none' | 'without-transfer-id' | 'with-transfer-id' | 'unreadable' };

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export function normaliseTrace(requests: RecordedRequest[]): TraceStep[] {
  const classes = new Map<string, string>();
  return requests.filter((item) => item.method !== 'GET').map((item) => {
    let keyClass = 'none';
    if (item.idempotencyKey) {
      if (!classes.has(item.idempotencyKey)) classes.set(item.idempotencyKey, `K${classes.size + 1}`);
      keyClass = classes.get(item.idempotencyKey)!;
    }
    return { method: item.method, path: item.path.replace(UUID, ':id'), keyClass, bodySha256: item.bodySha256, aborted: item.aborted };
  });
}

/** Read-only summary of the same-tab attempt record (never returns key, ids or body). */
export async function draftState(page: Page, userId: string): Promise<ScenarioTrace['draftAfter']> {
  return page.evaluate((id) => {
    try {
      const raw = sessionStorage.getItem(`wallet:web:transfer-attempt:${id}`);
      if (!raw) return 'none' as const;
      const parsed = JSON.parse(raw) as { transferId?: string };
      return parsed.transferId ? 'with-transfer-id' as const : 'without-transfer-id' as const;
    } catch { return 'unreadable' as const; }
  }, userId);
}

export function diffTraces(golden: ScenarioTrace[], actual: ScenarioTrace[]): string[] {
  const problems: string[] = [];
  for (const expected of golden) {
    const found = actual.find((item) => item.scenario === expected.scenario);
    if (!found) { problems.push(`${expected.scenario}: missing`); continue; }
    if (JSON.stringify(found.steps) !== JSON.stringify(expected.steps)) problems.push(`${expected.scenario}: steps differ\n  golden ${JSON.stringify(expected.steps)}\n  actual ${JSON.stringify(found.steps)}`);
    if (found.draftAfter !== expected.draftAfter) problems.push(`${expected.scenario}: draftAfter ${found.draftAfter} != ${expected.draftAfter}`);
  }
  return problems;
}
