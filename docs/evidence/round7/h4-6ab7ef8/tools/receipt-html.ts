// Evaluator: builds the real receipt HTML/text with the app's own module for a MALICIOUS completed transfer, writes them to argv[2].
import { writeFileSync } from 'node:fs';
import { receiptFromTransfer, receiptHtml, receiptText } from '../../../../../mobile/src/receipt';
const transfer: any = {
  id: '11111111-2222-3333-4444-555555555555', status: 'completed', sourceAccountId: 'src-1', amountMinor: '1234567', currency: 'MXN',
  concept: '<img src=x onerror=alert(1)>&"\'`', reference: '1234567', createdAt: '2026-11-16T15:00:00.000Z', completedAt: '2026-11-16T15:00:05.000Z',
  receiptReference: '11111111-2222-3333-4444-555555555555', requestId: 'req-SECRET', demoOnlyCode: '987654',
  destination: { id: 'dest-uuid', name: '<script>alert("x")</script> Carlos', alias: '"><b>alias</b>', kind: 'checking', clabe: '646180000000001231', clabeMasked: '646•••••••••••1231' },
};
const accounts: any[] = [{ id: 'src-1', name: 'Cuenta <b>principal</b>', kind: 'checking', currency: 'MXN', availableBalanceMinor: '1', clabe: '646180000000009999', clabeMasked: '646•••••••••••9999' }];
const doc = receiptFromTransfer(transfer, accounts)!;
const out = process.argv[2]!;
writeFileSync(`${out}/receipt-malicious.html`, receiptHtml(doc));
writeFileSync(`${out}/receipt-malicious.txt`, receiptText(doc));
for (const status of ['awaiting_confirmation', 'processing', 'rejected', 'expired', 'cancelled']) console.log(status, '->', receiptFromTransfer({ ...transfer, status }, accounts));
console.log('doc keys:', Object.keys(doc).join(','));
