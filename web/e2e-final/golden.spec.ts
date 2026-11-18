// REC-02 golden trace. Record (only with web/src identical to f0ed4bc):
//   WF_GOLDEN_RECORD=1 npx playwright test -c web/e2e-final/playwright.config.ts --project final golden.spec.ts
// Compare (any later SHA): same command without WF_GOLDEN_RECORD; writes network-traces.json.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import * as data from './fixtures/data.js';
import { installMockApi, type MockApi } from './helpers/mock-api.js';
import { ROOT, evidencePath } from './helpers/evidence.js';
import { diffTraces, draftState, normaliseTrace, type ScenarioTrace } from './helpers/traces.js';
import * as ui from './golden/driver.js';

const BASE_SHA = 'f0ed4bc';
const GOLDEN = resolve(ROOT, 'docs/evidence/web-final', BASE_SHA, 'network-golden.json');
const RECORD = process.env.WF_GOLDEN_RECORD === '1';
const password = 'Sintetica-Prueba-2026';
const transferInput = { amount: '123', concept: 'Prueba de envío', reference: '4321' };

type GoldenFile = { codeSha: string; method: string; scenarios: ScenarioTrace[] };

function mergeInto(file: string, trace: ScenarioTrace, codeSha: string) {
  mkdirSync(dirname(file), { recursive: true });
  const current: GoldenFile = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as GoldenFile : { codeSha, method: 'Playwright [F] page.route over **/v1/**; non-GET only; keyClass = Idempotency-Key equality class; bodySha256 = SHA-256 of the request body', scenarios: [] };
  current.codeSha = codeSha;
  current.scenarios = [...current.scenarios.filter((item) => item.scenario !== trace.scenario), trace].sort((a, b) => a.scenario.localeCompare(b.scenario));
  writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`);
}

async function finish(page: Page, api: MockApi, scenario: string) {
  await page.waitForLoadState('networkidle');
  const trace: ScenarioTrace = { scenario, steps: normaliseTrace(api.requests), draftAfter: await draftState(page, data.user.id) };
  if (RECORD) {
    const drift = execFileSync('git', ['diff', '--name-only', BASE_SHA, '--', 'web/src', 'web/index.html', 'web/public'], { cwd: ROOT, encoding: 'utf8' }).trim();
    const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '--', 'web/src', 'web/public'], { cwd: ROOT, encoding: 'utf8' }).trim();
    expect(drift + untracked, 'golden must be recorded with the web code of f0ed4bc').toBe('');
    mergeInto(GOLDEN, trace, BASE_SHA);
    return;
  }
  mergeInto(evidencePath('network-traces.json'), trace, process.env.WF_EVIDENCE_SHA ?? 'local');
  const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as GoldenFile;
  const expected = golden.scenarios.filter((item) => item.scenario === scenario);
  expect(expected, `golden has scenario ${scenario}`).toHaveLength(1);
  expect(diffTraces(expected, [trace])).toEqual([]);
}

const awaiting = () => data.transfer({ status: 'awaiting_confirmation', completedAt: null, receiptReference: null, expiresAt: '2026-11-17T16:05:00.000Z', demoOnlyCode: '246810' });

test.describe('REC-02 golden non-GET traces', () => {
  test('S1 create 201', async ({ page }) => {
    const api = await installMockApi(page);
    await ui.fillBeneficiaryTransfer(page, transferInput);
    await ui.sendFromReview(page);
    await ui.expectCompleted(page);
    await finish(page, api, 'S1-create-201');
  });

  test('S2 create 202 + confirm', async ({ page }) => {
    const api = await installMockApi(page, { createReplies: [{ status: 202, body: awaiting() }] });
    await ui.fillBeneficiaryTransfer(page, transferInput);
    await ui.sendFromReview(page);
    await ui.enterCode(page, '246810');
    await ui.expectCompleted(page);
    await finish(page, api, 'S2-create-202-confirm');
  });

  test('S3 create aborted + explicit retry', async ({ page }) => {
    const api = await installMockApi(page, { createReplies: ['abort'] });
    await ui.fillBeneficiaryTransfer(page, transferInput);
    await ui.sendFromReview(page);
    await ui.expectUncertain(page);
    await ui.retryUncertain(page);
    await ui.expectCompleted(page);
    await finish(page, api, 'S3-abort-retry');
  });

  test('S4 reload with a record without transferId', async ({ page }) => {
    const api = await installMockApi(page, { createReplies: ['abort'] });
    await ui.fillBeneficiaryTransfer(page, transferInput);
    await ui.sendFromReview(page);
    await ui.expectUncertain(page);
    await page.reload();
    await ui.expectCompleted(page);
    await finish(page, api, 'S4-reload-record-without-id');
  });

  test('S5 login with resumeTransfer', async ({ page }) => {
    const body = { sourceAccountId: data.ids.checking, destinationType: 'beneficiary', beneficiaryId: data.ids.beneficiary, amountMinor: '12300', concept: 'Prueba de envío', reference: '4321' };
    await page.addInitScript(({ userId, draft }) => {
      if (sessionStorage.getItem('wf-seeded')) return;
      sessionStorage.setItem('wf-seeded', '1');
      sessionStorage.setItem('wallet:web:active-user', userId);
      sessionStorage.setItem(`wallet:web:transfer-attempt:${userId}`, JSON.stringify(draft));
    }, { userId: data.user.id, draft: { key: 'synthetic-seeded-attempt', body } });
    const api = await installMockApi(page, { authenticated: false });
    await ui.resumeFromSessionExpired(page);
    await ui.login(page, data.user.email, password);
    await ui.expectCompleted(page);
    await finish(page, api, 'S5-login-resume-transfer');
  });

  test('S6 create 422 then 429', async ({ page }) => {
    const api = await installMockApi(page, { createReplies: [
      { status: 422, body: data.problem(422, 'Saldo insuficiente.', 'Unprocessable Entity') },
      { status: 429, body: data.problem(429, 'Se excedió el límite diario.', 'Too Many Requests') },
    ] });
    await ui.fillBeneficiaryTransfer(page, transferInput);
    await ui.sendFromReview(page);
    await ui.expectRejected(page);
    await ui.editAfterRejection(page);
    await ui.sendFromReview(page);
    await ui.expectRejected(page);
    await finish(page, api, 'S6-create-422-then-429');
  });

  test('S7 logout with a pending record', async ({ page }) => {
    const api = await installMockApi(page, { createReplies: ['abort'] });
    await ui.fillBeneficiaryTransfer(page, transferInput);
    await ui.sendFromReview(page);
    await ui.expectUncertain(page);
    await ui.logout(page);
    await finish(page, api, 'S7-logout-with-record');
  });
});
