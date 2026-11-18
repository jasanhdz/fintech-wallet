import React from 'react';
import assert from 'node:assert/strict';
import { Platform, Text } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import TestRenderer from 'react-test-renderer';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { deleteAsync } from 'expo-file-system/legacy';
import type { ProductComponents } from '@fintech-wallet/shared';
import { RECEIPT_DISCLAIMER, escapeHtml, receiptFromTransfer, receiptHtml, receiptText, type ReceiptDocument } from '../src/receipt';
import { RECEIPT_ACTION_LABELS, RECEIPT_MESSAGES, shareReceiptImage, shareReceiptPdf, useReceiptShare } from '../src/receiptShare';

jest.mock('expo-print', () => ({ printToFileAsync: jest.fn() }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('expo-file-system/legacy', () => ({ deleteAsync: jest.fn() }));
jest.mock('react-native-view-shot', () => ({ captureRef: jest.fn() }));

type Transfer = ProductComponents['schemas']['Transfer'];
type Account = ProductComponents['schemas']['Account'];

const printToFile = Print.printToFileAsync as jest.Mock;
const isAvailable = Sharing.isAvailableAsync as jest.Mock;
const shareFile = Sharing.shareAsync as jest.Mock;
const removeFile = deleteAsync as jest.Mock;

const FOLIO = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const PDF_URI = 'file:///var/mobile/Containers/Data/Application/ABC/Library/Caches/Print/receipt-1.pdf';
const SECRET_CODE = '742890';
const DANGEROUS_CONCEPT = '<img src=x onerror="alert(1)"> & \'Comida\' `x`';

const accounts: Account[] = [{ id: 'source-account-uuid', name: 'Cuenta Principal', kind: 'checking', currency: 'MXN', availableBalanceMinor: '1160000', clabe: '646180000000008412', clabeMasked: '646•••••••••••8412' }];
// Own-account destination: the API includes the full `clabe` in this variant, which must never reach the receipt.
const completed = (overrides: Partial<Transfer> = {}): Transfer => ({
  id: FOLIO, status: 'completed', sourceAccountId: 'source-account-uuid',
  destination: { id: 'destination-account-uuid', name: 'Ahorro <b>Casa</b>', kind: 'savings', currency: 'MXN', availableBalanceMinor: '999999', clabe: '646180000000004321', clabeMasked: '646•••••••••••4321' },
  amountMinor: '85000', currency: 'MXN', concept: DANGEROUS_CONCEPT, reference: '131126',
  createdAt: '2026-11-13T20:31:59.000Z', completedAt: '2026-11-13T20:32:00.456Z', receiptReference: FOLIO,
  requestId: 'request-secret-id', demoOnlyCode: SECRET_CODE, ...overrides,
});
const doc = () => receiptFromTransfer(completed(), accounts)!;

beforeEach(() => {
  printToFile.mockReset().mockResolvedValue({ uri: PDF_URI, numberOfPages: 1 });
  isAvailable.mockReset().mockResolvedValue(true);
  shareFile.mockReset().mockResolvedValue(undefined);
  removeFile.mockReset().mockResolvedValue(undefined);
});

describe('H2: receipt document (M10)', () => {
  it('carries the confirmed data: amount, business date, status, masked accounts, concept, reference, full folio and the demo notice', () => {
    const receipt = doc();
    for (const output of [receiptHtml(receipt), receiptText(receipt)]) {
      assert.match(output, /-\$850\.00 MXN/);
      assert.match(output, /13 de noviembre de 2026, 14:32 hrs \(Tiempo del Centro de México\)/);
      assert.match(output, /Completada — confirmada y aplicada/);
      assert.match(output, /Cuenta Principal •• 8412/);
      assert.match(output, /Billetera MXN •• 4321/);
      assert.match(output, /131126/);
      assert.ok(output.includes(FOLIO), 'the full UUID folio');
      assert.ok(output.includes(RECEIPT_DISCLAIMER));
      assert.equal(RECEIPT_DISCLAIMER, 'Comprobante interno de demostración — no es un comprobante bancario oficial');
    }
    assert.ok(receiptText(receipt).includes(DANGEROUS_CONCEPT), 'plain text keeps the concept verbatim');
  });

  it('excludes the code, request id, internal ids, full CLABEs, tokens and e-mail', () => {
    const receipt = doc();
    for (const output of [receiptHtml(receipt), receiptText(receipt), JSON.stringify(receipt)]) {
      for (const secret of [SECRET_CODE, 'request-secret-id', 'source-account-uuid', 'destination-account-uuid', '646180000000008412', '646180000000004321', '646•••••••••••', 'Bearer', 'accessToken', 'refresh', '@']) {
        assert.ok(!output.includes(secret), `must not contain ${secret}`);
      }
      assert.doesNotMatch(output, /SPEI|cifrad|biom|Face ID|huella/i, 'no unsupported claims');
    }
  });

  it('escapes every dynamic value in the PDF HTML', () => {
    const html = receiptHtml(doc());
    assert.ok(!html.includes('<img'), 'no injected tag');
    assert.ok(!html.includes('<b>Casa'), 'the destination name is escaped too');
    assert.ok(html.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;Comida&#39; &#96;x&#96;'));
    assert.ok(html.includes('Ahorro &lt;b&gt;Casa&lt;/b&gt;'));
    assert.doesNotMatch(html, /<script|https?:\/\//i, 'no scripts or remote resources');
    assert.equal(escapeHtml('a&b<c>d"e\'f`'), 'a&amp;b&lt;c&gt;d&quot;e&#39;f&#96;');
  });

  it('builds no success receipt for pending, rejected, expired or cancelled transfers', () => {
    for (const status of ['awaiting_confirmation', 'processing', 'rejected', 'expired', 'cancelled'] as const) {
      assert.equal(receiptFromTransfer(completed({ status }), accounts), null, status);
    }
    assert.equal(receiptFromTransfer(null, accounts), null);
  });
});

describe('H2: PDF share (expo-print + expo-sharing)', () => {
  it('happy path: print → native sheet (application/pdf, com.adobe.pdf) → delete the cached file', async () => {
    const order: string[] = [];
    printToFile.mockImplementation(async () => { order.push('print'); return { uri: PDF_URI, numberOfPages: 1 }; });
    shareFile.mockImplementation(async () => { order.push('share'); });
    removeFile.mockImplementation(async () => { order.push('delete'); });
    const tracked: Array<string | null> = [];
    assert.equal(await shareReceiptPdf(doc(), (uri) => tracked.push(uri)), null);
    assert.deepEqual(order, ['print', 'share', 'delete']);
    assert.ok(String(printToFile.mock.calls[0][0].html).includes(FOLIO));
    assert.equal(JSON.stringify(shareFile.mock.calls[0]), JSON.stringify([PDF_URI, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: 'Comprobante de transferencia · Billetera MXN' }]));
    assert.equal(JSON.stringify(removeFile.mock.calls[0]), JSON.stringify([PDF_URI, { idempotent: true }]));
    assert.deepEqual(tracked, [PDF_URI, null]);
  });

  it('closing the sheet is not an error and still deletes the file', async () => {
    shareFile.mockResolvedValueOnce(undefined);
    assert.equal(await shareReceiptPdf(doc()), null);
    shareFile.mockRejectedValueOnce(Object.assign(new Error('User cancelled the share'), { code: 'ERR_SHARING_CANCELLED' }));
    assert.equal(await shareReceiptPdf(doc()), null);
    assert.equal(removeFile.mock.calls.length, 2);
  });

  it('generation error: clear Spanish message, no sheet, nothing to delete', async () => {
    printToFile.mockRejectedValueOnce(new Error(`Failed to write ${PDF_URI}`));
    const message = await shareReceiptPdf(doc());
    assert.equal(message, RECEIPT_MESSAGES.pdfFailed);
    assert.equal(shareFile.mock.calls.length, 0);
    assert.equal(removeFile.mock.calls.length, 0);
  });

  it('share error: retryable message without paths, the file is deleted', async () => {
    shareFile.mockRejectedValueOnce(new Error(`Could not open ${PDF_URI}`));
    const message = await shareReceiptPdf(doc());
    assert.equal(message, RECEIPT_MESSAGES.shareFailed);
    assert.ok(!message!.includes('file://') && !message!.includes('/var/'));
    assert.equal(JSON.stringify(removeFile.mock.calls[0]), JSON.stringify([PDF_URI, { idempotent: true }]));
  });

  it('a failing cleanup never becomes a user-facing error', async () => {
    removeFile.mockRejectedValueOnce(new Error('gone'));
    assert.equal(await shareReceiptPdf(doc()), null);
  });

  it('sharing unavailable: message and no PDF is generated', async () => {
    isAvailable.mockResolvedValueOnce(false);
    assert.equal(await shareReceiptPdf(doc()), RECEIPT_MESSAGES.unavailable);
    assert.equal(printToFile.mock.calls.length, 0);
  });

  it('web degrades with a message, without calling the native modules', async () => {
    const restore = jest.replaceProperty(Platform, 'OS', 'web');
    try {
      assert.equal(await shareReceiptPdf(doc()), RECEIPT_MESSAGES.pdfWeb);
      assert.equal(isAvailable.mock.calls.length + printToFile.mock.calls.length, 0);
    } finally { restore.restore(); }
  });

  it('labels the PDF share as the primary receipt action and the screenshot as the second one', () => {
    assert.equal(Platform.OS, 'ios');
    assert.equal(RECEIPT_ACTION_LABELS.pdf, 'Compartir comprobante');
    assert.equal(RECEIPT_ACTION_LABELS.image, 'Compartir captura');
  });
});

describe('H2: screenshot share (react-native-view-shot + expo-sharing)', () => {
  it('captures the receipt card to a PNG and shares it as image/png; dismissing is not an error; the file is deleted', async () => {
    (isAvailable as jest.Mock).mockResolvedValue(true);
    (captureRef as jest.Mock).mockResolvedValueOnce('file:///cache/receipt.png');
    (shareFile as jest.Mock).mockResolvedValueOnce(undefined);
    assert.equal(await shareReceiptImage({ node: 1 }), null);
    assert.equal((captureRef as jest.Mock).mock.calls[0]![1].format, 'png');
    assert.equal((shareFile as jest.Mock).mock.calls.at(-1)![1].mimeType, 'image/png');
    assert.equal(JSON.stringify((removeFile as jest.Mock).mock.calls.at(-1)), JSON.stringify(['file:///cache/receipt.png', { idempotent: true }]));
  });

  it('a failed capture is a retryable message and nothing is shared; no target means unavailable', async () => {
    (isAvailable as jest.Mock).mockResolvedValue(true);
    const shares = (shareFile as jest.Mock).mock.calls.length;
    (captureRef as jest.Mock).mockRejectedValueOnce(new Error('boom /private/var'));
    assert.equal(await shareReceiptImage({ node: 1 }), RECEIPT_MESSAGES.imageFailed);
    assert.equal(await shareReceiptImage(null), RECEIPT_MESSAGES.unavailable);
    assert.equal((shareFile as jest.Mock).mock.calls.length, shares);
  });
});

describe('H2: useReceiptShare state', () => {
  function harness(receipt: ReceiptDocument | null) {
    let api: ReturnType<typeof useReceiptShare>;
    function Probe() { api = useReceiptShare(receipt); return <Text>{`${api.busy ?? 'idle'}|${api.error}`}</Text>; }
    let renderer: TestRenderer.ReactTestRenderer;
    TestRenderer.act(() => { renderer = TestRenderer.create(<Probe/>); });
    return { get api() { return api!; }, text: () => String((renderer!.toJSON() as { children: string[] }).children[0]), renderer: renderer! };
  }

  it('one generation at a time: a double tap does not print twice; busy until the sheet closes', async () => {
    let release!: () => void;
    shareFile.mockImplementation(() => new Promise<void>((resolve) => { release = resolve; }));
    const probe = harness(doc());
    let first!: Promise<void>;
    await TestRenderer.act(async () => { first = probe.api.run('pdf'); void probe.api.run('pdf'); void probe.api.run('image'); });
    assert.equal(probe.text(), 'pdf|');
    assert.equal(printToFile.mock.calls.length, 1);
    await TestRenderer.act(async () => { release(); await first; });
    assert.equal(probe.text(), 'idle|', 'closing the sheet restores the UI with no failure message');
    assert.equal(removeFile.mock.calls.length, 1);
  });

  it('error then retry: the message is shown, cleared on retry', async () => {
    printToFile.mockRejectedValueOnce(new Error('x'));
    const probe = harness(doc());
    await TestRenderer.act(async () => { await probe.api.run('pdf'); });
    assert.equal(probe.text(), `idle|${RECEIPT_MESSAGES.pdfFailed}`);
    await TestRenderer.act(async () => { await probe.api.run('pdf'); });
    assert.equal(probe.text(), 'idle|');
  });

  it('unmounting while the sheet is open deletes the temporary PDF', async () => {
    shareFile.mockImplementation(() => new Promise<void>(() => undefined));
    const probe = harness(doc());
    await TestRenderer.act(async () => { void probe.api.run('pdf'); await new Promise((resolve) => setTimeout(resolve, 0)); });
    assert.equal(shareFile.mock.calls.length, 1);
    assert.equal(removeFile.mock.calls.length, 0);
    await TestRenderer.act(async () => { probe.renderer.unmount(); });
    assert.equal(JSON.stringify(removeFile.mock.calls[0]), JSON.stringify([PDF_URI, { idempotent: true }]));
  });

  it('without a completed-transfer document nothing runs', async () => {
    const probe = harness(null);
    await TestRenderer.act(async () => { await probe.api.run('pdf'); await probe.api.run('image'); });
    assert.equal(printToFile.mock.calls.length + isAvailable.mock.calls.length, 0);
  });
});
