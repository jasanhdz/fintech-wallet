// M10 receipt actions (round 7 H2). Both open the NATIVE share sheet only when the user taps; nothing is sent by itself.
// - "Compartir comprobante": the text summary through React Native's Share (iOS/Android sheet).
// - PDF: expo-print renders receiptHtml() to a PDF in the app cache, expo-sharing opens the sheet with it
//   (application/pdf, com.adobe.pdf). The temporary file is deleted after the sheet closes, on any error and on
//   unmount. On iOS the sheet offers "Guardar en Archivos", so the button says "Guardar PDF"; on Android the sheet
//   is a chooser with no guaranteed save target, so it says "Compartir PDF". Nothing is "downloaded".
// Closing the sheet without choosing an app is not an error. On web the native modules are not used.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Share } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { deleteAsync } from 'expo-file-system/legacy';
import { RECEIPT_TITLE, receiptHtml, receiptText, type ReceiptDocument } from './receipt';

export type ReceiptAction = 'text' | 'pdf';

export const RECEIPT_ACTION_LABELS: Record<ReceiptAction, string> = {
  text: 'Compartir comprobante',
  pdf: Platform.select({ ios: 'Guardar PDF', default: 'Compartir PDF' }),
};

export const RECEIPT_BUSY_LABELS: Record<ReceiptAction, string> = {
  text: 'Abriendo la hoja para compartir…',
  pdf: 'Generando el PDF del comprobante…',
};

export const RECEIPT_MESSAGES = {
  unavailable: 'Compartir no está disponible en este dispositivo.',
  pdfWeb: 'El PDF del comprobante solo se puede generar en la app para iOS o Android.',
  pdfFailed: 'No se pudo generar el PDF del comprobante. Inténtalo de nuevo.',
  shareFailed: 'No se pudo abrir la hoja para compartir. Inténtalo de nuevo.',
} as const;

// A user closing the sheet: RN-Web/navigator.share rejects with AbortError; some platforms report "cancel".
function isUserCancel(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { name, code, message } = error as { name?: unknown; code?: unknown; message?: unknown };
  return name === 'AbortError' || /cancel|dismiss/i.test(`${String(code ?? '')} ${String(message ?? '')}`);
}

/** Deletes a temporary file; idempotent and never throws (cleanup must not turn into a user-facing error). */
export async function removeTemporaryFile(uri: string | null | undefined): Promise<void> {
  if (!uri) return;
  try { await deleteAsync(uri, { idempotent: true }); } catch { /* already gone or not removable: nothing to show */ }
}

/** Shares the text summary. Resolves to an error message, or null when the sheet closed (shared or dismissed). */
export async function shareReceiptText(doc: ReceiptDocument): Promise<string | null> {
  if (Platform.OS === 'web' && typeof (globalThis as { navigator?: { share?: unknown } }).navigator?.share !== 'function') return RECEIPT_MESSAGES.unavailable;
  try {
    await Share.share({ title: RECEIPT_TITLE, message: receiptText(doc) }, { dialogTitle: RECEIPT_TITLE, subject: RECEIPT_TITLE });
    return null;
  } catch (error) {
    return isUserCancel(error) ? null : RECEIPT_MESSAGES.shareFailed;
  }
}

/**
 * Generates the PDF and opens the sheet. `track` receives the temporary uri while it exists (null once deleted) so the
 * caller can delete it on unmount. Resolves to an error message, or null when the sheet closed.
 */
export async function shareReceiptPdf(doc: ReceiptDocument, track: (uri: string | null) => void = () => undefined): Promise<string | null> {
  if (Platform.OS === 'web') return RECEIPT_MESSAGES.pdfWeb;
  let available = false;
  try { available = await Sharing.isAvailableAsync(); } catch { available = false; }
  if (!available) return RECEIPT_MESSAGES.unavailable;
  let uri: string;
  try {
    ({ uri } = await Print.printToFileAsync({ html: receiptHtml(doc) }));
  } catch {
    return RECEIPT_MESSAGES.pdfFailed;
  }
  track(uri);
  try {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: RECEIPT_TITLE });
    return null;
  } catch (error) {
    return isUserCancel(error) ? null : RECEIPT_MESSAGES.shareFailed;
  } finally {
    await removeTemporaryFile(uri);
    track(null);
  }
}

/** State for the two M10 actions: one action at a time (double taps ignored), a retryable error message. */
export function useReceiptShare(doc: ReceiptDocument | null) {
  const [busy, setBusy] = useState<ReceiptAction | null>(null);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const mounted = useRef(true);
  const temporaryFile = useRef<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const pending = temporaryFile.current;
      temporaryFile.current = null;
      void removeTemporaryFile(pending);
    };
  }, []);
  const run = useCallback(async (action: ReceiptAction) => {
    if (!doc || lock.current) return;
    lock.current = true;
    setBusy(action);
    setError('');
    let failure: string | null;
    try {
      failure = action === 'pdf' ? await shareReceiptPdf(doc, (uri) => { temporaryFile.current = uri; }) : await shareReceiptText(doc);
    } catch {
      failure = action === 'pdf' ? RECEIPT_MESSAGES.pdfFailed : RECEIPT_MESSAGES.shareFailed;
    }
    lock.current = false;
    if (!mounted.current) return;
    setBusy(null);
    setError(failure ?? '');
  }, [doc]);
  return { busy, error, run };
}
