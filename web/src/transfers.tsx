import { useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { formatMxnFromMinor, mxnInputSchema, parseMxnToMinor, transferConfirmRequestSchema, transferCreateRequestSchema } from '@fintech-wallet/shared';
import { ApiError, request, requestTransfer, type Account } from './api.js';
import { AppShell, Notice, StatePanel } from './components.js';
import { useSession } from './session.js';

type Beneficiary = { id: string; name: string; alias: string; clabeMasked: string; destinationAccountId: string };
type Transfer = { id: string; status: 'awaiting_confirmation' | 'processing' | 'completed' | 'rejected'; sourceAccountId: string; destination: Beneficiary | Account; amountMinor: string; currency: 'MXN'; concept: string; reference: string; createdAt: string; completedAt?: string | null; receiptReference?: string | null; demoOnlyCode?: string };
type Draft = { body: Record<string, string>; key: string };
// Never persisted: retaining this in memory enables an exact retry while this page stays alive.
const attempts = new Map<string, Draft>();
const confirmationAttempts = new Map<string, { code: string; key: string }>();
const createKey = () => crypto.randomUUID();

function errorText(error: unknown) {
  if (error instanceof ApiError) {
    const detail = error.problem.detail || error.problem.title;
    if (/insufficient|saldo/i.test(`${error.problem.type} ${error.problem.title} ${detail}`)) return 'Saldo insuficiente. No se realizó ningún débito.';
    if (/limit|l[ií]mite/i.test(`${error.problem.type} ${error.problem.title} ${detail}`)) return 'Se alcanzó el límite diario configurado. No se realizó ningún débito.';
    return `${detail} (referencia ${error.problem.requestId})`;
  }
  return error instanceof Error ? error.message : 'No fue posible completar la solicitud.';
}

export function NewTransferPage() {
  const { session, hydrated } = useSession();
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: () => request<{ items: Account[] }>('/accounts') });
  const beneficiaries = useQuery({ queryKey: ['beneficiaries'], queryFn: () => request<{ items: Beneficiary[] }>('/beneficiaries') });
  const [destinationType, setDestinationType] = useState<'beneficiary' | 'own_account'>('beneficiary');
  const [review, setReview] = useState(false);
  const [reviewSummary, setReviewSummary] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const submitLock = useRef(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  if (!hydrated) return <AppShell><StatePanel title="Cargando tu sesión">Estamos verificando tu acceso.</StatePanel></AppShell>;
  if (!session) return <Navigate to="/login" replace state={{ from: '/transfers/new' }} />;
  const ownAccounts = accounts.data?.items ?? [];
  const recipients = beneficiaries.data?.items ?? [];
  const accountsError = accounts.error;
  const beneficiariesError = beneficiaries.error;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (submitLock.current) return; submitLock.current = true; setBusy(true); setError('');
    const form = new FormData(event.currentTarget);
    let amountMinor: string;
    try { const amount = mxnInputSchema.parse(String(form.get('amount') ?? '')); amountMinor = parseMxnToMinor(amount); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Revisa el importe.'); submitLock.current = false; setBusy(false); return; }
    const sourceAccountId = String(form.get('sourceAccountId') ?? '');
    const concept = String(form.get('concept') ?? '').trim();
    const reference = String(form.get('reference') ?? '');
    const body = destinationType === 'beneficiary'
      ? { sourceAccountId, destinationType, beneficiaryId: String(form.get('beneficiaryId') ?? ''), amountMinor, concept, reference }
      : { sourceAccountId, destinationType, destinationAccountId: String(form.get('destinationAccountId') ?? ''), amountMinor, concept, reference };
    const parsed = transferCreateRequestSchema.safeParse(body);
    if (!parsed.success) { setError(parsed.error.issues.map((issue) => issue.message).join(' ')); submitLock.current = false; setBusy(false); return; }
    if (body.destinationType === 'own_account' && body.destinationAccountId === sourceAccountId) { setError('Elige una cuenta de destino distinta a la cuenta de origen.'); submitLock.current = false; setBusy(false); return; }
    const serialized = JSON.stringify(parsed.data);
    const prior = attempts.get('uncertain');
    const draft: Draft = prior && JSON.stringify(prior.body) === serialized ? prior : { body: parsed.data as unknown as Record<string, string>, key: createKey() };
    try {
      const result = await requestTransfer<Transfer>('/transfers', draft.key, { method: 'POST', body: JSON.stringify(draft.body) });
      attempts.delete('uncertain');
      attempts.set(result.id, draft);
      navigate(`/transfers/${result.id}/status`, { state: { transfer: result } });
    } catch (cause) {
      // Keep exact key+payload for an explicit retry; never silently mint a second attempt.
      attempts.set('uncertain', draft);
      setError(`No conocemos el resultado del envío. Reintenta con la misma clave y los mismos datos. ${errorText(cause)}`);
    } finally { submitLock.current = false; setBusy(false); }
  }

  if (accounts.isPending || beneficiaries.isPending) return <AppShell active="transfers"><StatePanel title="Cargando opciones">Consultando tus cuentas y beneficiarios.</StatePanel></AppShell>;
  if (accountsError || beneficiariesError) return <AppShell active="transfers"><StatePanel title="No pudimos cargar tus opciones" action={<button className="secondary-button" onClick={() => { void accounts.refetch(); void beneficiaries.refetch(); }}>Intentar de nuevo</button>}>{errorText(accountsError ?? beneficiariesError)}</StatePanel></AppShell>;
  return <AppShell active="transfers"><section className="transfer-page"><Link className="back-link" to="/accounts">← Volver a mis cuentas</Link><span className="eyebrow">TRANSFERENCIA INTERNA</span><h1>{review ? 'Revisa tu transferencia' : 'Nueva transferencia'}</h1><p className="transfer-intro">Envía MXN a una cuenta tuya o a un beneficiario de Billetera.</p>
    {error && <Notice>{error}</Notice>}
    {ownAccounts.length === 0 ? <StatePanel title="No tienes cuentas disponibles">No hay una cuenta de origen para realizar una transferencia.</StatePanel> : <form className="transfer-form" onSubmit={review ? (event) => { event.preventDefault(); void submit(event); } : (event) => { event.preventDefault(); setError(''); const data = new FormData(event.currentTarget); const amount = mxnInputSchema.safeParse(String(data.get('amount') ?? '')); if (!amount.success) { setError('Ingresa un importe positivo con hasta dos decimales.'); return; } if (!String(data.get('concept') ?? '').trim() || String(data.get('concept')).length > 40 || !/^[0-9]{1,7}$/.test(String(data.get('reference') ?? ''))) { setError('Revisa el concepto (1–40 caracteres) y la referencia (1–7 dígitos).'); return; } if (destinationType === 'own_account' && data.get('sourceAccountId') === data.get('destinationAccountId')) { setError('Elige una cuenta de destino distinta a la cuenta de origen.'); return; } if (destinationType === 'beneficiary' && !recipients.some((item) => item.id === data.get('beneficiaryId'))) { setError('Selecciona un beneficiario para continuar.'); return; } const source = ownAccounts.find((item) => item.id === data.get('sourceAccountId')); const destination = destinationType === 'beneficiary' ? recipients.find((item) => item.id === data.get('beneficiaryId')) : ownAccounts.find((item) => item.id === data.get('destinationAccountId')); setReviewSummary([`Origen: ${source?.name ?? ''}`, `Destino: ${destination?.name ?? ''}${destination && 'alias' in destination ? ` (${destination.alias})` : ''}`, `Importe: ${formatMxnFromMinor(parseMxnToMinor(amount.data))}`, `Concepto: ${String(data.get('concept') ?? '').trim()}`, `Referencia: ${String(data.get('reference') ?? '')}`]); setReview(true); }} noValidate>
      <div className="transfer-type" role="group" aria-label="Tipo de destino"><button type="button" className={destinationType === 'beneficiary' ? 'selected' : ''} aria-pressed={destinationType === 'beneficiary'} onClick={() => { setDestinationType('beneficiary'); setReview(false); }}>Beneficiario</button><button type="button" className={destinationType === 'own_account' ? 'selected' : ''} aria-pressed={destinationType === 'own_account'} onClick={() => { setDestinationType('own_account'); setReview(false); }}>Entre mis cuentas</button></div>
      <label className="transfer-field"><span>Cuenta de origen</span><select name="sourceAccountId" required defaultValue=""><option value="" disabled>Selecciona una cuenta</option>{ownAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} · disponible {formatMxnFromMinor(account.availableBalanceMinor)}</option>)}</select></label>
       {destinationType === 'beneficiary' ? recipients.length === 0 ? <StatePanel title="Aún no tienes beneficiarios" action={<Link className="secondary-button button-link" to="/beneficiaries/new">Agregar beneficiario</Link>}>Registra primero un beneficiario interno para continuar.</StatePanel> : <label className="transfer-field"><span>Beneficiario</span><select name="beneficiaryId" required defaultValue=""><option value="" disabled>Selecciona un beneficiario</option>{recipients.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.alias} · {item.clabeMasked}</option>)}</select></label> : <label className="transfer-field"><span>Cuenta de destino</span><select name="destinationAccountId" required defaultValue=""><option value="" disabled>Selecciona una cuenta</option>{ownAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {formatMxnFromMinor(account.availableBalanceMinor)}</option>)}</select></label>}
      <label className="transfer-field"><span>Importe en MXN</span><div className="amount-input"><span aria-hidden="true">$</span><input name="amount" type="text" inputMode="decimal" placeholder="0.00" autoComplete="off" required aria-label="Importe en MXN" /></div><small>Usa hasta dos decimales. El saldo y los límites se validan al enviar.</small></label>
      <label className="transfer-field"><span>Concepto</span><input name="concept" maxLength={40} minLength={1} required placeholder="¿Para qué es esta transferencia?" /><small>Hasta 40 caracteres.</small></label>
      <label className="transfer-field"><span>Referencia numérica</span><input name="reference" inputMode="numeric" pattern="[0-9]{1,7}" maxLength={7} required placeholder="Ej. 1234567" /><small>De 1 a 7 dígitos.</small></label>
    {review && <section className="transfer-review" aria-label="Revisión de transferencia"><h2>Confirma los datos</h2><dl>{reviewSummary.map((line, index) => <div key={index}><dt>{line.split(': ')[0]}</dt><dd>{line.split(': ').slice(1).join(': ')}</dd></div>)}</dl><strong>El envío puede requerir confirmación adicional.</strong></section>}
      <div className="transfer-actions">{review && <button type="button" className="secondary-button" onClick={() => setReview(false)}>Editar</button>}<button className="primary-button" disabled={busy}>{busy ? 'Enviando…' : review ? 'Enviar transferencia' : 'Continuar a revisión'} <span aria-hidden="true">→</span></button></div>
    </form>}
  </section></AppShell>;
}

export function TransferStatusPage() {
  const { session, hydrated } = useSession(); const { transferId = '' } = useParams(); const location = useLocation(); const navigate = useNavigate();
  const initial = (location.state as { transfer?: Transfer } | null)?.transfer;
  const status = useQuery({ queryKey: ['transfer', transferId], queryFn: () => request<Transfer>(`/transfers/${transferId}`), enabled: Boolean(transferId), initialData: initial, refetchInterval: (query) => query.state.data?.status === 'processing' ? 1500 : false });
  const [code, setCode] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const submitLock = useRef(false);
  if (!hydrated) return <AppShell active="transfers"><StatePanel title="Cargando tu sesión">Verificando acceso.</StatePanel></AppShell>;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!status.data && status.isPending) return <AppShell active="transfers"><StatePanel title="Consultando transferencia">Recuperando el estado real del intento.</StatePanel></AppShell>;
  if (!status.data && status.error) return <AppShell active="transfers"><StatePanel title="No pudimos consultar el intento" action={<button className="secondary-button" onClick={() => void status.refetch()}>Consultar de nuevo</button>}>{errorText(status.error)}</StatePanel></AppShell>;
  const transfer = status.data;
  if (!transfer) return null;
  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (submitLock.current) return; submitLock.current = true; setBusy(true); setError(''); const parsed = transferConfirmRequestSchema.safeParse({ code });
    if (!parsed.success) { setError('Ingresa el código de 6 dígitos recibido.'); submitLock.current = false; setBusy(false); return; }
    const previous = confirmationAttempts.get(transferId);
    const attempt = previous?.code === code ? previous : { code, key: createKey() };
    confirmationAttempts.set(transferId, attempt);
    try { const result = await requestTransfer<Transfer>(`/transfers/${transferId}/confirm`, attempt.key, { method: 'POST', body: JSON.stringify(parsed.data) }); confirmationAttempts.delete(transferId); statusClientUpdate(result); }
    catch (cause) { setError(`No se confirmó la respuesta. Puedes reintentar el mismo código con la misma clave. ${errorText(cause)}`); }
    finally { submitLock.current = false; setBusy(false); }
  }
  function statusClientUpdate(next: Transfer) { navigate(`/transfers/${next.id}/status`, { replace: true, state: { transfer: next } }); }
  const retry = attempts.get(transferId) ?? attempts.get('uncertain');
  async function retryCreate() {
    if (!retry) { void status.refetch(); return; }
    setBusy(true); setError('');
    try { const result = await requestTransfer<Transfer>('/transfers', retry.key, { method: 'POST', body: JSON.stringify(retry.body) }); attempts.delete('uncertain'); attempts.set(result.id, retry); void status.refetch(); }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }
  return <AppShell active="transfers"><section className="transfer-result"><Link className="back-link" to="/accounts">← Volver a mis cuentas</Link><span className="eyebrow">ESTADO DE TRANSFERENCIA</span><h1>{transfer.status === 'completed' ? 'Transferencia completada' : transfer.status === 'awaiting_confirmation' ? 'Confirma tu transferencia' : transfer.status === 'rejected' ? 'Transferencia rechazada' : 'Estamos verificando el resultado'}</h1>
    {error && <Notice>{error}</Notice>}{status.error && <Notice tone="info">No pudimos actualizar el estado. El intento sigue disponible para consulta.</Notice>}
    {transfer.status === 'awaiting_confirmation' ? <><p>Ingresa el código de un solo uso asociado a este intento.</p>{transfer.demoOnlyCode && <Notice tone="info">Código de demostración local: <strong>{transfer.demoOnlyCode}</strong></Notice>}<form className="transfer-form" onSubmit={confirm}><label className="transfer-field"><span>Código de confirmación</span><input value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} aria-label="Código de confirmación de 6 dígitos" required /></label><button className="primary-button" disabled={busy}>{busy ? 'Verificando…' : 'Confirmar transferencia'}</button></form></> : transfer.status === 'rejected' ? <Notice>El intento fue rechazado. No se realizó ningún débito. {errorText(status.error)}</Notice> : transfer.status === 'processing' ? <><p>Estamos comprobando el resultado con el servicio.</p><button className="secondary-button" onClick={() => void status.refetch()}>Consultar estado</button></> : <><div className="receipt-card"><h2>Comprobante interno</h2><dl><dt>Importe</dt><dd>{formatMxnFromMinor(transfer.amountMinor)}</dd><dt>Concepto</dt><dd>{transfer.concept}</dd><dt>Referencia</dt><dd>{transfer.reference}</dd><dt>Folio interno</dt><dd>{transfer.receiptReference || transfer.id}</dd><dt>Estado</dt><dd>Completada</dd></dl></div><Link className="secondary-button button-link" to="/accounts">Volver a mis cuentas</Link></>}
    {(status.error || transfer.status === 'processing') && <div className="transfer-actions"><button className="secondary-button" disabled={busy} onClick={() => void status.refetch()}>Consultar resultado</button>{retry && <button className="primary-button" disabled={busy} onClick={() => void retryCreate()}>Reintentar mismo envío</button>}</div>}
  </section></AppShell>;
}
