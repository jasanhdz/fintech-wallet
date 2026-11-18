import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMxnFromMinor, mxnInputSchema, parseMxnToMinor, transferConfirmRequestSchema, transferCreateRequestSchema } from '@fintech-wallet/shared';
import { ApiError, request, requestTransfer, type Account } from './api.js';
import { AppShell, Notice, StatePanel } from './components.js';
import { useSession } from './session.js';
import { clearTransferDraft, readTransferDraft, saveTransferDraft, type TransferDraft } from './transfer-attempt.js';

type Beneficiary = { id: string; name: string; alias: string; clabeMasked: string; destinationAccountId: string };
type Transfer = { id: string; status: 'awaiting_confirmation' | 'processing' | 'completed' | 'rejected'; sourceAccountId: string; destination: Beneficiary | Account; amountMinor: string; currency: 'MXN'; concept: string; reference: string; createdAt: string; completedAt?: string | null; receiptReference?: string | null; demoOnlyCode?: string };
type RejectionDetails = { destinationType: 'beneficiary' | 'own_account'; sourceName?: string; sourceBalanceMinor?: string; destinationName?: string; amountMinor: string; concept: string; reference: string };
type DefinitiveRejection = { kind: 'insufficient_balance' | 'daily_limit'; message: string; details?: RejectionDetails };
const confirmationAttempts = new Map<string, { code: string; key: string }>();
const recoveryFlights = new Map<string, Promise<Transfer>>();
const createKey = () => crypto.randomUUID();

function recoverTransferDraft(userId: string, draft: TransferDraft): Promise<Transfer> {
  const flightKey = `${userId}:${draft.key}`;
  const inFlight = recoveryFlights.get(flightKey);
  if (inFlight) return inFlight;
  const recovery = (async () => {
    if (draft.transferId) return request<Transfer>(`/transfers/${draft.transferId}`);
    const transfer = await requestTransfer<Transfer>('/transfers', draft.key, { method: 'POST', body: JSON.stringify(draft.body) });
    saveTransferDraft(userId, { ...draft, transferId: transfer.id });
    return transfer;
  })().finally(() => recoveryFlights.delete(flightKey));
  recoveryFlights.set(flightKey, recovery);
  return recovery;
}

function errorText(error: unknown) {
  if (error instanceof ApiError) {
    const detail = error.problem.detail || error.problem.title;
    if (/insufficient|saldo/i.test(`${error.problem.type} ${error.problem.title} ${detail}`)) return 'Saldo insuficiente. No se realizó ningún débito.';
    if (/limit|l[ií]mite/i.test(`${error.problem.type} ${error.problem.title} ${detail}`)) return 'Se alcanzó el límite diario configurado. No se realizó ningún débito.';
    return `${detail} (referencia ${error.problem.requestId})`;
  }
  return error instanceof Error ? error.message : 'No fue posible completar la solicitud.';
}

function definitiveRejection(error: unknown): DefinitiveRejection | null {
  if (!(error instanceof ApiError)) return null;
  const reason = `${error.problem.type} ${error.problem.title} ${error.problem.detail}`;
  if (/insufficient|saldo/i.test(reason)) return { kind: 'insufficient_balance', message: 'El saldo disponible no alcanza para esta transferencia. No se realizó ningún débito.' };
  if (/limit|l[ií]mite/i.test(reason)) return { kind: 'daily_limit', message: 'Se alcanzó el límite diario configurado para esta demostración. No se realizó ningún débito.' };
  return null;
}

function rejectionDetails(body: Record<string, string>, accounts: Account[], recipients: Beneficiary[]): RejectionDetails | undefined {
  const { sourceAccountId, destinationType, destinationAccountId, beneficiaryId, amountMinor, concept, reference } = body;
  if ((destinationType !== 'beneficiary' && destinationType !== 'own_account') || typeof amountMinor !== 'string' || !/^[1-9][0-9]*$/.test(amountMinor)) return undefined;
  const source = accounts.find((account) => account.id === sourceAccountId);
  const destination = destinationType === 'own_account'
    ? accounts.find((account) => account.id === destinationAccountId)
    : recipients.find((item) => item.id === beneficiaryId);
  return {
    destinationType,
    ...(source ? { sourceName: source.name, sourceBalanceMinor: source.availableBalanceMinor } : {}),
    ...(destination ? { destinationName: destination.name } : {}),
    amountMinor,
    concept: concept ?? '',
    reference: reference ?? '',
  };
}

function RejectionPanel({ rejection, children }: { rejection: DefinitiveRejection; children: ReactNode }) {
  const details = rejection.details;
  return <section className="transfer-rejection" role="alert"><span className="rejection-icon" aria-hidden="true">!</span><span className="eyebrow">TRANSFERENCIA NO REALIZADA</span><h2>{rejection.kind === 'insufficient_balance' ? 'Saldo insuficiente' : 'Límite diario alcanzado'}</h2><p>{rejection.message}</p>{details && <dl className="rejection-breakdown"><div><dt>Estado</dt><dd>{rejection.kind === 'daily_limit' ? 'Límite diario de demostración alcanzado' : 'Saldo insuficiente'}</dd></div><div><dt>Tipo de operación</dt><dd>{details.destinationType === 'own_account' ? 'Entre mis cuentas' : 'Beneficiario Billetera'}</dd></div><div><dt>Cuenta de origen</dt><dd>{details.sourceName ?? 'Cuenta de origen'}</dd></div>{details.destinationName && <div><dt>Destino</dt><dd data-sensitive>{details.destinationName}</dd></div>}<div><dt>Importe solicitado</dt><dd data-sensitive>{formatMxnFromMinor(details.amountMinor)} MXN</dd></div>{details.sourceBalanceMinor !== undefined && <div><dt>{rejection.kind === 'insufficient_balance' ? 'Saldo disponible sin débito' : 'Saldo disponible consultado'}</dt><dd data-sensitive>{formatMxnFromMinor(details.sourceBalanceMinor)} MXN</dd></div>}<div><dt>Concepto</dt><dd data-sensitive>{details.concept}</dd></div><div><dt>Referencia</dt><dd data-sensitive>{details.reference}</dd></div></dl>}<p className="rejection-detail">No se realizó ningún débito. {rejection.kind === 'insufficient_balance' ? 'Revisa la cuenta de origen y el importe antes de volver a intentarlo.' : 'El servicio no proporciona el uso acumulado ni el monto disponible del límite en esta respuesta.'}</p><div className="rejection-actions">{children}</div></section>;
}

function parseAmountMinor(value: string) {
  const parsed = mxnInputSchema.safeParse(value);
  return parsed.success ? BigInt(parseMxnToMinor(parsed.data)) : null;
}

function TransferSummary({ accounts, recipients, destinationType, sourceAccountId, destinationAccountId, beneficiaryId, amount, concept, reference, mode, body }: {
  accounts: Account[]; recipients: Beneficiary[]; destinationType: 'beneficiary' | 'own_account'; sourceAccountId: string; destinationAccountId: string; beneficiaryId: string; amount: string; concept: string; reference: string; mode: 'entry' | 'review' | 'recovery'; body?: Record<string, string>;
}) {
  const sourceId = body?.sourceAccountId ?? sourceAccountId;
  const kind = body?.destinationType === 'own_account' || body?.destinationType === 'beneficiary' ? body.destinationType : destinationType;
  const destinationId = body?.destinationAccountId ?? destinationAccountId;
  const selectedBeneficiaryId = body?.beneficiaryId ?? beneficiaryId;
  const source = accounts.find((account) => account.id === sourceId);
  const recipient = kind === 'beneficiary' ? recipients.find((item) => item.id === selectedBeneficiaryId) : undefined;
  const destinationAccount = kind === 'own_account' ? accounts.find((account) => account.id === destinationId) : undefined;
  const destinationName = recipient ? `${recipient.name} · ${recipient.alias}` : destinationAccount?.name;
  const rawAmount = body?.amountMinor ?? undefined;
  const amountMinor = rawAmount && /^[1-9][0-9]*$/.test(rawAmount) ? BigInt(rawAmount) : parseAmountMinor(amount);
  const available = source ? BigInt(source.availableBalanceMinor) : null;
  const canProject = amountMinor !== null && available !== null && amountMinor <= available;
  const destinationAvailable = destinationAccount ? BigInt(destinationAccount.availableBalanceMinor) : null;
  const maxBalance = 9_223_372_036_854_775_807n;
  const projectedDestination = canProject && destinationAvailable !== null && destinationAvailable + amountMinor! <= maxBalance ? destinationAvailable + amountMinor! : null;
  return <aside className={`transfer-summary transfer-summary-${mode}`} aria-label={mode === 'recovery' ? 'Datos del mismo intento pendiente' : 'Resumen de transferencia'}>
    <h2>{mode === 'recovery' ? 'Intento pendiente' : mode === 'review' ? 'Resumen de revisión' : 'Resumen de transferencia'}</h2>
    <div className="transfer-summary-amount"><span>Importe</span><strong data-sensitive>{amountMinor !== null ? `${formatMxnFromMinor(amountMinor.toString())} MXN` : '—'}</strong></div>
    <dl className="transfer-summary-details"><div><dt>Origen</dt><dd>{source?.name ?? (sourceId ? 'Cuenta seleccionada' : 'Selecciona una cuenta')}</dd></div><div><dt>Destino</dt><dd data-sensitive>{destinationName ?? (kind === 'own_account' ? 'Selecciona una cuenta' : 'Selecciona un beneficiario')}</dd></div><div><dt>Concepto</dt><dd data-sensitive>{(body?.concept ?? concept) || '—'}</dd></div><div><dt>Referencia</dt><dd data-sensitive>{(body?.reference ?? reference) || '—'}</dd></div></dl>
    {mode === 'entry' && <div className="transfer-current-balances"><h3>Saldos disponibles actuales</h3><p><span>Origen</span><strong data-sensitive>{source ? formatMxnFromMinor(source.availableBalanceMinor) : 'Se muestra al seleccionar una cuenta'}</strong></p>{kind === 'own_account' && <p><span>Destino</span><strong data-sensitive>{destinationAccount ? formatMxnFromMinor(destinationAccount.availableBalanceMinor) : 'Se muestra al seleccionar una cuenta'}</strong></p>}</div>}
    {mode === 'review' && <div className="transfer-projected-balances"><h3>Saldos estimados si se completa</h3><p><span>Origen</span><strong data-sensitive>{canProject ? formatMxnFromMinor((available! - amountMinor!).toString()) : 'No disponible con los datos actuales'}</strong></p>{kind === 'own_account' && <p><span>Destino</span><strong data-sensitive>{projectedDestination !== null ? formatMxnFromMinor(projectedDestination.toString()) : 'No disponible con los datos actuales'}</strong></p>}{kind === 'beneficiary' && <p><span>Saldo del beneficiario</span><strong>No disponible</strong></p>}</div>}
    {mode === 'recovery' && <p className="transfer-summary-safe-note">Se consultará o reintentará con la misma operación guardada. No se muestra información de autenticación.</p>}
  </aside>;
}

export function NewTransferPage() {
  const { session, hydrated } = useSession();
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: () => request<{ items: Account[] }>('/accounts') });
  const beneficiaries = useQuery({ queryKey: ['beneficiaries'], queryFn: () => request<{ items: Beneficiary[] }>('/beneficiaries') });
  const [destinationType, setDestinationType] = useState<'beneficiary' | 'own_account'>('beneficiary');
  const [review, setReview] = useState(false);
  const [sourceAccountId, setSourceAccountId] = useState('');
  const [destinationAccountId, setDestinationAccountId] = useState('');
  const [beneficiaryId, setBeneficiaryId] = useState('');
  const [amount, setAmount] = useState('');
  const [concept, setConcept] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const submitLock = useRef(false);
  const [error, setError] = useState('');
  const [rejection, setRejection] = useState<DefinitiveRejection | null>(null);
  const [uncertainDraft, setUncertainDraft] = useState<TransferDraft | null>(null);
  const navigate = useNavigate();
  const [recovering, setRecovering] = useState(false);
  useEffect(() => {
    if (!hydrated || !session) return;
    const draft = readTransferDraft(session.user.id);
    if (!draft) return;
    let active = true;
    setRecovering(true);
    void (async () => {
      try {
        const transfer = await recoverTransferDraft(session.user.id, draft);
        if (active) navigate(`/transfers/${transfer.id}/status`, { replace: true, state: { transfer } });
      } catch (cause) {
        if (active && !(cause instanceof ApiError && cause.problem.status === 401)) {
          setUncertainDraft(draft);
          setError(errorText(cause));
        }
      } finally { if (active) setRecovering(false); }
    })();
    return () => { active = false; };
  }, [hydrated, session, navigate]);
  if (!hydrated) return <AppShell><StatePanel title="Cargando tu sesión">Estamos verificando tu acceso.</StatePanel></AppShell>;
  if (!session) return <Navigate to="/login" replace state={{ from: '/transfers/new' }} />;
  if (recovering) return <AppShell active="transfers"><StatePanel title="Recuperando tu transferencia">Consultando el intento anterior con la misma clave. No inicies otro envío.</StatePanel></AppShell>;
  const currentUserId = session.user.id;
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
    const prior = readTransferDraft(currentUserId);
    if (prior && JSON.stringify(prior.body) !== serialized) { setError('Hay un intento anterior pendiente de recuperar. Reintenta sus mismos datos; no se enviará una transferencia nueva.'); submitLock.current = false; setBusy(false); return; }
    const draft: TransferDraft = prior && JSON.stringify(prior.body) === serialized ? prior : { body: parsed.data as unknown as Record<string, string>, key: createKey() };
    saveTransferDraft(currentUserId, draft);
    try {
      const result = await requestTransfer<Transfer>('/transfers', draft.key, { method: 'POST', body: JSON.stringify(draft.body) });
      saveTransferDraft(currentUserId, { ...draft, transferId: result.id });
      navigate(`/transfers/${result.id}/status`, { state: { transfer: result } });
    } catch (cause) {
      // Keep exact key+payload for an explicit retry; never silently mint a second attempt.
      const definitivelyRejected = cause instanceof ApiError && [422, 429].includes(cause.problem.status);
      if (definitivelyRejected) clearTransferDraft(currentUserId);
      if (definitivelyRejected) {
        const rejected = definitiveRejection(cause);
        if (rejected) { setError(''); setRejection({ ...rejected, details: rejectionDetails(parsed.data as unknown as Record<string, string>, ownAccounts, recipients) }); }
        else setError(`${errorText(cause)} Puedes corregir los datos y crear un nuevo intento.`);
      }
      else { setUncertainDraft(draft); setError(errorText(cause)); }
    } finally { submitLock.current = false; setBusy(false); }
  }

  async function recoverUncertainAttempt() {
    if (!uncertainDraft) return;
    setBusy(true);
    try {
      const result = await requestTransfer<Transfer>('/transfers', uncertainDraft.key, { method: 'POST', body: JSON.stringify(uncertainDraft.body) });
      saveTransferDraft(currentUserId, { ...uncertainDraft, transferId: result.id });
      navigate(`/transfers/${result.id}/status`, { state: { transfer: result } });
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }

  if (accounts.isPending || beneficiaries.isPending) return <AppShell active="transfers"><StatePanel title="Cargando opciones">Consultando tus cuentas y beneficiarios.</StatePanel></AppShell>;
  if (accountsError || beneficiariesError) return <AppShell active="transfers"><StatePanel title="No pudimos cargar tus opciones" action={<button className="secondary-button" onClick={() => { void accounts.refetch(); void beneficiaries.refetch(); }}>Intentar de nuevo</button>}>{errorText(accountsError ?? beneficiariesError)}</StatePanel></AppShell>;
  if (uncertainDraft) return <AppShell active="transfers"><section className="transfer-result transfer-result-uncertain"><Link className="back-link" to="/accounts">← Volver a mis cuentas</Link><span className="eyebrow">ESTADO DE TRANSFERENCIA</span><h1>Estamos verificando el resultado</h1><div className="uncertain-layout"><section className="uncertain-card"><span className="uncertain-icon" aria-hidden="true">…</span><h2>Tu envío sigue en verificación</h2><p>La respuesta se interrumpió antes de confirmar el resultado. Consulta usando el mismo intento; no se iniciará una transferencia distinta.</p>{error && <Notice tone="info">No pudimos consultar todavía. El mismo intento permanece guardado para recuperarlo.</Notice>}<button className="primary-button" disabled={busy} onClick={() => void recoverUncertainAttempt()}>{busy ? 'Consultando…' : 'Consultar / reintentar este mismo intento'}</button><p className="uncertain-note">Puedes volver a esta pantalla después de recargar.</p></section><TransferSummary accounts={ownAccounts} recipients={recipients} destinationType="beneficiary" sourceAccountId="" destinationAccountId="" beneficiaryId="" amount="" concept="" reference="" mode="recovery" body={uncertainDraft.body} /></div></section></AppShell>;
  return <AppShell active="transfers"><section className="transfer-page"><Link className="back-link" to="/accounts">← Volver a mis cuentas</Link><span className="eyebrow">{rejection ? 'ESTADO DE LA OPERACIÓN' : 'TRANSFERENCIA INTERNA'}</span><h1>{rejection ? 'Transferencia no realizada' : review ? 'Revisa tu transferencia' : 'Nueva transferencia'}</h1>{rejection && <RejectionPanel rejection={rejection}><button type="button" className="secondary-button" onClick={() => setRejection(null)}>Editar datos</button><Link className="primary-button button-link" to="/accounts">Volver a mis cuentas</Link></RejectionPanel>}<div className="transfer-layout" hidden={Boolean(rejection)}><div className="transfer-primary"><p className="transfer-intro">Envía MXN a una cuenta tuya o a un beneficiario de Billetera.</p>
    {error && !rejection && <Notice>{error}</Notice>}
    {ownAccounts.length === 0 ? <StatePanel title="No tienes cuentas disponibles">No hay una cuenta de origen para realizar una transferencia.</StatePanel> : <form className="transfer-form" onSubmit={review ? (event) => { event.preventDefault(); void submit(event); } : (event) => { event.preventDefault(); setError(''); const data = new FormData(event.currentTarget); const amountResult = mxnInputSchema.safeParse(String(data.get('amount') ?? '')); if (!amountResult.success) { setError('Ingresa un importe positivo con hasta dos decimales.'); return; } if (!String(data.get('concept') ?? '').trim() || String(data.get('concept')).length > 40 || !/^[0-9]{1,7}$/.test(String(data.get('reference') ?? ''))) { setError('Revisa el concepto (1–40 caracteres) y la referencia (1–7 dígitos).'); return; } if (destinationType === 'own_account' && data.get('sourceAccountId') === data.get('destinationAccountId')) { setError('Elige una cuenta de destino distinta a la cuenta de origen.'); return; } if (destinationType === 'beneficiary' && !recipients.some((item) => item.id === data.get('beneficiaryId'))) { setError('Selecciona un beneficiario para continuar.'); return; } setReview(true); }} noValidate>
      <div className="transfer-form-fields" hidden={review}><div className="transfer-type" role="group" aria-label="Tipo de destino"><button type="button" className={destinationType === 'beneficiary' ? 'selected' : ''} aria-pressed={destinationType === 'beneficiary'} onClick={() => { setDestinationType('beneficiary'); setBeneficiaryId(''); setReview(false); }}>Beneficiario</button><button type="button" className={destinationType === 'own_account' ? 'selected' : ''} aria-pressed={destinationType === 'own_account'} onClick={() => { setDestinationType('own_account'); setDestinationAccountId(''); setReview(false); }}>Entre mis cuentas</button></div>
      <label className="transfer-field"><span>Cuenta de origen</span><select name="sourceAccountId" required value={sourceAccountId} onChange={(event) => { setSourceAccountId(event.target.value); setReview(false); }}><option value="" disabled>Selecciona una cuenta</option>{ownAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} · disponible {formatMxnFromMinor(account.availableBalanceMinor)}</option>)}</select></label>
        {destinationType === 'beneficiary' ? recipients.length === 0 ? <StatePanel title="Aún no tienes beneficiarios" action={<Link className="secondary-button button-link" to="/beneficiaries/new">Agregar beneficiario</Link>}>Registra primero un beneficiario interno para continuar.</StatePanel> : <label className="transfer-field"><span>Beneficiario</span><select name="beneficiaryId" required value={beneficiaryId} onChange={(event) => { setBeneficiaryId(event.target.value); setReview(false); }}><option value="" disabled>Selecciona un beneficiario</option>{recipients.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.alias} · {item.clabeMasked}</option>)}</select></label> : <label className="transfer-field"><span>Cuenta de destino</span><select name="destinationAccountId" required value={destinationAccountId} onChange={(event) => { setDestinationAccountId(event.target.value); setReview(false); }}><option value="" disabled>Selecciona una cuenta</option>{ownAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {formatMxnFromMinor(account.availableBalanceMinor)}</option>)}</select></label>}
      <label className="transfer-field"><span>Importe en MXN</span><div className="amount-input"><span aria-hidden="true">$</span><input name="amount" type="text" inputMode="decimal" placeholder="0.00" autoComplete="off" required aria-label="Importe en MXN" value={amount} onChange={(event) => { setAmount(event.target.value); setReview(false); }} /></div><small>Usa hasta dos decimales. El saldo y los límites se validan al enviar.</small></label>
      <label className="transfer-field"><span>Concepto</span><input name="concept" maxLength={40} minLength={1} required placeholder="¿Para qué es esta transferencia?" value={concept} onChange={(event) => { setConcept(event.target.value); setReview(false); }} /><small>Hasta 40 caracteres.</small></label>
      <label className="transfer-field"><span>Referencia numérica</span><input name="reference" inputMode="numeric" pattern="[0-9]{1,7}" maxLength={7} required placeholder="Ej. 1234567" value={reference} onChange={(event) => { setReference(event.target.value); setReview(false); }} /><small>De 1 a 7 dígitos.</small></label></div>
    {review && <section className="transfer-review" aria-label="Revisión de transferencia"><h2>Confirma los datos</h2><dl><div><dt>Origen</dt><dd>{ownAccounts.find((item) => item.id === sourceAccountId)?.name ?? '—'}</dd></div><div><dt>Destino</dt><dd data-sensitive>{destinationType === 'beneficiary' ? recipients.find((item) => item.id === beneficiaryId)?.name ?? '—' : ownAccounts.find((item) => item.id === destinationAccountId)?.name ?? '—'}</dd></div><div><dt>Importe</dt><dd data-sensitive>{parseAmountMinor(amount) === null ? '—' : formatMxnFromMinor(parseAmountMinor(amount)!.toString())}</dd></div><div><dt>Concepto</dt><dd data-sensitive>{concept || '—'}</dd></div><div><dt>Referencia</dt><dd data-sensitive>{reference || '—'}</dd></div></dl><strong>El envío puede requerir confirmación adicional.</strong></section>}
      <div className="transfer-actions">{review && <button type="button" className="secondary-button" onClick={() => setReview(false)}>Editar</button>}<button className="primary-button" disabled={busy}>{busy ? 'Enviando…' : review ? 'Enviar transferencia' : 'Continuar a revisión'} <span aria-hidden="true">→</span></button></div>
    </form>}</div><TransferSummary accounts={ownAccounts} recipients={recipients} destinationType={destinationType} sourceAccountId={sourceAccountId} destinationAccountId={destinationAccountId} beneficiaryId={beneficiaryId} amount={amount} concept={concept} reference={reference} mode={review ? 'review' : 'entry'} /></div>
  </section></AppShell>;
}

export function TransferStatusPage() {
  const { session, hydrated } = useSession(); const { transferId = '' } = useParams(); const location = useLocation(); const navigate = useNavigate();
  const queryClient = useQueryClient();
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: () => request<{ items: Account[] }>('/accounts'), enabled: Boolean(session) });
  const initial = (location.state as { transfer?: Transfer } | null)?.transfer;
  const status = useQuery({ queryKey: ['transfer', transferId], queryFn: () => request<Transfer>(`/transfers/${transferId}`), enabled: Boolean(transferId), initialData: initial, refetchInterval: (query) => query.state.data?.status === 'processing' ? 1500 : false });
  const [code, setCode] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [rejection, setRejection] = useState<DefinitiveRejection | null>(null);
  const submitLock = useRef(false);
  useEffect(() => {
    if (session && (status.data?.status === 'completed' || status.data?.status === 'rejected')) clearTransferDraft(session.user.id);
  }, [session, status.data]);
  if (!hydrated) return <AppShell active="transfers"><StatePanel title="Cargando tu sesión">Verificando acceso.</StatePanel></AppShell>;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  const currentUserId = session.user.id;
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
    catch (cause) {
      const rejected = definitiveRejection(cause);
      if (rejected) {
        clearTransferDraft(currentUserId); confirmationAttempts.delete(transferId); setError('');
        const refreshed = await accounts.refetch();
        const destinationType = 'alias' in transfer.destination ? 'beneficiary' : 'own_account';
        const body = {
          sourceAccountId: transfer.sourceAccountId,
          destinationType,
          ...(destinationType === 'beneficiary' ? { beneficiaryId: transfer.destination.id } : { destinationAccountId: transfer.destination.id }),
          amountMinor: transfer.amountMinor, concept: transfer.concept, reference: transfer.reference,
        };
        const context = rejectionDetails(body, refreshed.data?.items ?? accounts.data?.items ?? [], []);
        setRejection({ ...rejected, details: context ? { ...context, destinationName: transfer.destination.name } : undefined });
      }
      else setError(`No se confirmó la respuesta. Puedes reintentar el mismo código con la misma clave. ${errorText(cause)}`);
    }
    finally { submitLock.current = false; setBusy(false); }
  }
  function statusClientUpdate(next: Transfer) { queryClient.setQueryData(['transfer', next.id], next); navigate(`/transfers/${next.id}/status`, { replace: true, state: { transfer: next } }); }
  const retry = readTransferDraft(currentUserId);
  const sourceAccount = accounts.data?.items.find((account) => account.id === transfer.sourceAccountId);
  async function retryCreate() {
    if (!retry) { void status.refetch(); return; }
    setBusy(true); setError('');
    try { const result = await requestTransfer<Transfer>('/transfers', retry.key, { method: 'POST', body: JSON.stringify(retry.body) }); saveTransferDraft(currentUserId, { ...retry, transferId: result.id }); void status.refetch(); }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }
  if (rejection) return <AppShell active="transfers"><section className="transfer-result"><Link className="back-link" to="/accounts">← Volver a mis cuentas</Link><span className="eyebrow">ESTADO DE LA OPERACIÓN</span><h1>Transferencia no realizada</h1><RejectionPanel rejection={rejection}><Link className="secondary-button button-link" to="/transfers/new">Iniciar otra transferencia</Link><Link className="primary-button button-link" to="/accounts">Volver a mis cuentas</Link></RejectionPanel></section></AppShell>;
  const uncertain = transfer.status === 'processing';
  return <AppShell active="transfers"><section className={`transfer-result ${uncertain ? 'transfer-result-uncertain' : ''}`}><Link className="back-link" to="/accounts">← Volver a mis cuentas</Link><span className="eyebrow">ESTADO DE TRANSFERENCIA</span><h1>{transfer.status === 'completed' ? 'Transferencia completada' : transfer.status === 'awaiting_confirmation' ? 'Confirma tu transferencia' : transfer.status === 'rejected' ? 'Transferencia rechazada' : 'Estamos verificando el resultado'}</h1>
    {error && <Notice>{error}</Notice>}{status.error && <Notice tone="info">No pudimos actualizar el estado. El intento sigue disponible para consulta.</Notice>}
    {transfer.status === 'awaiting_confirmation' ? <><p>Ingresa el código de un solo uso asociado a este intento.</p>{transfer.demoOnlyCode && <Notice tone="info">Código de demostración local: <strong>{transfer.demoOnlyCode}</strong></Notice>}<form className="transfer-form" onSubmit={confirm}><label className="transfer-field otp-field"><span>Código de confirmación</span><div className="otp-boxes"><input id="transfer-otp" className="otp-input" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} aria-label="Código de confirmación de 6 dígitos" aria-describedby="transfer-otp-help" aria-valuetext={`${code.length} de 6 dígitos ingresados`} required /><span id="transfer-otp-help" className="sr-only">Un solo campo de seis dígitos. Puedes escribir, pegar o usar el código de autocompletado.</span>{Array.from({ length: 6 }, (_, index) => <span className={`otp-box ${code[index] ? 'filled' : ''}`} aria-hidden="true" key={index}>{code[index] || ''}</span>)}</div></label><button className="primary-button" disabled={busy || code.length !== 6}>{busy ? 'Verificando…' : 'Confirmar transferencia'}</button></form></> : transfer.status === 'rejected' ? <Notice>El intento fue rechazado. No se realizó ningún débito. {errorText(status.error)}</Notice> : transfer.status === 'processing' ? <section className="uncertain-card"><span className="uncertain-icon" aria-hidden="true">…</span><h2>Estamos comprobando tu envío</h2><p>El resultado todavía no está disponible. Tu intento se conserva y puedes consultar su estado.</p><button className="primary-button" disabled={busy} onClick={() => void status.refetch()}>Consultar resultado</button><p className="uncertain-note">No vuelvas a enviar la transferencia mientras verificamos.</p></section> : <><div className="receipt-card receipt-card-completed"><header className="receipt-heading"><span className="receipt-icon" aria-hidden="true">✓</span><div><span className="eyebrow">OPERACIÓN COMPLETADA</span><h2>Comprobante interno</h2><p>Billetera MXN · Transferencia interna</p></div><span className="receipt-status">Completada</span></header><div className="receipt-amount"><span>Importe transferido</span><strong data-sensitive>{formatMxnFromMinor(transfer.amountMinor)} <small>MXN</small></strong></div><div className="receipt-parties"><section><span>CUENTA DE ORIGEN</span><strong data-sensitive>{sourceAccount?.name ?? 'Cuenta de origen'}</strong><small>{sourceAccount ? sourceAccount.kind === 'savings' ? 'Cuenta de ahorro' : 'Cuenta principal' : 'Cuenta Billetera'}</small></section><section><span>DESTINATARIO</span><strong data-sensitive>{transfer.destination.name}</strong><small data-sensitive>{'alias' in transfer.destination ? transfer.destination.alias : transfer.destination.kind === 'savings' ? 'Cuenta de ahorro' : 'Cuenta propia'}</small></section></div>{'availableBalanceMinor' in transfer.destination && <section className="receipt-post-state"><span>Saldo disponible de destino informado</span><strong data-sensitive>{formatMxnFromMinor(transfer.destination.availableBalanceMinor)} MXN</strong></section>}<dl className="receipt-details"><div><dt>Concepto</dt><dd data-sensitive>{transfer.concept}</dd></div><div><dt>Referencia</dt><dd data-sensitive>{transfer.reference}</dd></div><div><dt>Folio interno</dt><dd>{transfer.receiptReference || transfer.id}</dd></div><div><dt>Estado</dt><dd>Completada</dd></div><div><dt>Fecha y hora</dt><dd>{new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(transfer.completedAt ?? transfer.createdAt))}</dd></div></dl><p className="receipt-disclaimer">Constancia interna de una operación registrada en Billetera. No es un comprobante CEP ni un documento oficial.</p></div><Link className="secondary-button button-link" to="/accounts">Volver a mis cuentas</Link></>}
    {(status.error || (transfer.status === 'processing' && retry)) && <div className="transfer-actions">{status.error && <button className="secondary-button" disabled={busy} onClick={() => void status.refetch()}>Consultar resultado</button>}{transfer.status === 'processing' && retry && <button className="primary-button" disabled={busy} onClick={() => void retryCreate()}>Reintentar mismo envío</button>}</div>}
  </section></AppShell>;
}
