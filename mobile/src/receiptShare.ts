// M10 receipt actions (round 7 H2). Both open the NATIVE share sheet only when the user taps; nothing is sent by itself.
// - "Compartir comprobante": expo-print renders receiptHtml() to a PDF and expo-sharing opens the native sheet.
// - "Compartir captura": react-native-view-shot renders the receipt card to a PNG that expo-sharing opens (image/png).
//   (application/pdf, com.adobe.pdf). The temporary file is deleted after the sheet closes, on any error and on
//   unmount. On iOS the sheet offers "Guardar en Archivos", so the button says "Guardar PDF"; on Android the sheet
//   is a chooser with no guaranteed save target, so it says "Compartir PDF". Nothing is "downloaded".
// Closing the sheet without choosing an app is not an error. On web the native modules are not used.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { deleteAsync } from 'expo-file-system/legacy';
import { RECEIPT_TITLE, receiptHtml, type ReceiptDocument } from './receipt';

export type ReceiptAction = 'image' | 'pdf';

export const RECEIPT_ACTION_LABELS: Record<ReceiptAction, string> = {
  image: 'Compartir captura',
  pdf: 'Compartir comprobante',
};

export const RECEIPT_BUSY_LABELS: Record<ReceiptAction, string> = {
  image: 'Preparando la captura…',
  pdf: 'Generando el PDF del comprobante…',
};

export const RECEIPT_MESSAGES = {
  unavailable: 'Compartir no está disponible en este dispositivo.',
  pdfWeb: 'El PDF del comprobante solo se puede generar en la app para iOS o Android.',
  pdfFailed: 'No se pudo generar el PDF del comprobante. Inténtalo de nuevo.',
  imageFailed: 'No se pudo generar la captura del comprobante. Inténtalo de nuevo.',
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

/** Renders `target` (the receipt card) to a PNG and opens the sheet. Same contract as shareReceiptPdf. */
export async function shareReceiptImage(target: unknown, track: (uri: string | null) => void = () => undefined): Promise<string | null> {
  if (Platform.OS === 'web') return RECEIPT_MESSAGES.pdfWeb;
  let available = false;
  try { available = await Sharing.isAvailableAsync(); } catch { available = false; }
  if (!available || !target) return RECEIPT_MESSAGES.unavailable;
  let uri: string;
  try {
    uri = await captureRef(target as never, { format: 'png', quality: 1, result: 'tmpfile' });
  } catch {
    return RECEIPT_MESSAGES.imageFailed;
  }
  track(uri);
  try {
    await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: RECEIPT_TITLE });
    return null;
  } catch (error) {
    return isUserCancel(error) ? null : RECEIPT_MESSAGES.shareFailed;
  } finally {
    await removeTemporaryFile(uri);
    track(null);
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
export function useReceiptShare(doc: ReceiptDocument | null, captureTarget?: { current: unknown }, beforeCapture?: () => Promise<void>) {
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
      if (action === 'image') await beforeCapture?.();
      failure = action === 'pdf' ? await shareReceiptPdf(doc, (uri) => { temporaryFile.current = uri; }) : await shareReceiptImage(captureTarget?.current, (uri) => { temporaryFile.current = uri; });
    } catch {
      failure = action === 'pdf' ? RECEIPT_MESSAGES.pdfFailed : RECEIPT_MESSAGES.imageFailed;
    }
    lock.current = false;
    if (!mounted.current) return;
    setBusy(null);
    setError(failure ?? '');
  }, [doc, captureTarget, beforeCapture]);
  return { busy, error, run };
}
