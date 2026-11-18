// M10 receipt document (round 7 H2). One pure builder turns a CONFIRMED transfer (the same object the M10 screen
// renders, read from the API with the user's session) into the data shared as text or PDF. Only the fields a receipt
// needs are copied: amount, business-time date, status, masked origin/destination (last 4 digits), concept,
// reference and the real folio. Never copied: the destination's full `clabe`, `demoOnlyCode`, `requestId`, account
// or beneficiary ids, the user's email, tokens. Non-completed transfers produce no document.
import type { ProductComponents } from '@fintech-wallet/shared';
import { formatMoney } from './money';
import { BUSINESS_ZONE_LABEL, DATE_UNAVAILABLE, formatBusinessDateTime } from './dates';

type Transfer = ProductComponents['schemas']['Transfer'];
type Account = ProductComponents['schemas']['Account'];

export const RECEIPT_DISCLAIMER = 'Comprobante interno de demostración — no es un comprobante bancario oficial';
export const RECEIPT_TITLE = 'Comprobante de transferencia · Billetera MXN';

export type ReceiptDocument = {
  amount: string;
  date: string;
  status: string;
  originName: string;
  originEnding: string;
  recipientName: string;
  recipientAlias: string;
  destinationEnding: string;
  concept: string;
  reference: string;
  folio: string;
  operationType: string;
};

const ending = (masked: string | undefined) => (masked ?? '').replace(/\D/g, '').slice(-4);

/** The receipt of a completed transfer, or null for any other status (no success receipt for pending/rejected/expired/cancelled). */
export function receiptFromTransfer(transfer: Transfer | null | undefined, accounts: Account[]): ReceiptDocument | null {
  if (!transfer || transfer.status !== 'completed') return null;
  const folio = transfer.receiptReference || transfer.id;
  if (!folio) return null;
  const origin = accounts.find((account) => account.id === transfer.sourceAccountId);
  const when = formatBusinessDateTime(transfer.completedAt ?? transfer.createdAt);
  const destination = transfer.destination;
  return {
    amount: `${formatMoney(transfer.amountMinor, { sign: 'debit' })} MXN`,
    date: when ? `${when} (${BUSINESS_ZONE_LABEL})` : DATE_UNAVAILABLE,
    status: 'Completada — confirmada y aplicada',
    originName: origin?.name ?? '—',
    originEnding: origin ? ending(origin.clabeMasked) : '',
    recipientName: destination.name,
    recipientAlias: 'alias' in destination ? destination.alias : '',
    destinationEnding: ending(destination.clabeMasked),
    concept: transfer.concept,
    reference: transfer.reference,
    folio,
    operationType: 'Transferencia interna',
  };
}

const masked = (value: string) => (value ? `•• ${value}` : '—');

function rows(doc: ReceiptDocument): Array<[string, string]> {
  return [
    ['Monto', doc.amount],
    ['Fecha', doc.date],
    ['Estado', doc.status],
    ['Cuenta origen', doc.originEnding ? `${doc.originName} ${masked(doc.originEnding)}` : doc.originName],
    ['Para', doc.recipientAlias ? `${doc.recipientName} (${doc.recipientAlias})` : doc.recipientName],
    ['Cuenta destino', `Billetera MXN ${masked(doc.destinationEnding)}`],
    ['Concepto', doc.concept],
    ['Referencia', doc.reference],
    ['Folio interno', doc.folio],
    ['Tipo de operación', doc.operationType],
  ];
}

/** Plain-text summary for the "Compartir comprobante" action (native share sheet). */
export function receiptText(doc: ReceiptDocument): string {
  return [RECEIPT_TITLE, 'Transferencia completada', ...rows(doc).map(([label, value]) => `${label}: ${value}`), '', RECEIPT_DISCLAIMER].join('\n');
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
export function escapeHtml(value: string): string {
  return String(value).replace(/[&<>"'`]/g, (char) => HTML_ESCAPES[char]!);
}

/** HTML for expo-print. Every dynamic value goes through escapeHtml; no scripts, no remote resources. */
export function receiptHtml(doc: ReceiptDocument): string {
  const body = rows(doc).map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join('');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escapeHtml(RECEIPT_TITLE)}</title><style>
body{font-family:-apple-system,"Helvetica Neue",Roboto,Arial,sans-serif;color:#141b2c;margin:32px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:28px;margin:8px 0 16px}
.notice{border:1px solid #b54708;border-radius:8px;padding:10px 12px;color:#7a2e00;font-size:13px;margin:0 0 20px}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{padding:8px 0;border-bottom:1px solid #e1e2ec;vertical-align:top}
th{text-align:left;color:#434655;font-weight:500;width:38%}td{text-align:right;font-weight:600;word-break:break-all}
footer{margin-top:24px;color:#747686;font-size:12px}
</style></head><body>
<h1>${escapeHtml(RECEIPT_TITLE)}</h1>
<p class="notice">${escapeHtml(RECEIPT_DISCLAIMER)}</p>
<p>Transferencia completada</p><h2>${escapeHtml(doc.amount)}</h2>
<table>${body}</table>
<footer>${escapeHtml(RECEIPT_DISCLAIMER)}</footer>
</body></html>`;
}
