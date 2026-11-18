import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMxnFromMinor, transferConfirmRequestSchema, transferCreateRequestSchema } from '@fintech-wallet/shared';
import { ApiError, request, requestTransfer, type Account } from './api.js';
import { ActionBar, AppShell, AccessUnavailable, FormErrorSummary, Notice, StatePanel, clabeTail, initialsOf, PageHeader, type ErrorSummaryItem } from './components.js';
import { Amount } from './home.js';
import { Icon, type IconName } from './icons.js';
import { classifyConfirmFailure, sanitizeCode, secondsLeft } from './transfer-outcome.js';
import { CodeView, ReceiptView, SendingView, VerifyView, panelFromBody, panelFromTransfer, type CodeFailure, type Transfer, type VerifyCause } from './transfer-screens.js';
import { useTransferPolicy, type TransferPolicy } from './policy.js';
import { useSession } from './session.js';
import { clearTransferDraft, readTransferDraft, saveTransferDraft, type TransferDraft } from './transfer-attempt.js';
import {
  TRANSFER_FIELDS, TRANSFER_MESSAGES, amountMinorOf, barWidth, beneficiaryBlocked, createBody, effectiveOwnDestination, errorCount,
  minorToInput, projectDebit, requiresCode, shortfall, validateTransfer, type DestinationType, type TransferErrors, type TransferField, type TransferValues,
} from './transfer-form.js';
import { orderAccounts } from './account-order.js';
import { mergeTransferDemoCode } from './transfer-presentation.js';

type Beneficiary = { id: string; name: string; alias: string; clabeMasked: string; destinationAccountId: string; ownAccountId?: string };
type RejectionKind = 'insufficient_balance' | 'daily_limit';
/** W13: server-confirmed rejection (422/429 with the contract detail) plus figures read after it (GET only). */
type W13Rejection = { kind: RejectionKind; amountMinor: string; sourceAccount?: Account; policy?: TransferPolicy };
/** W13 «Modificar monto» from the confirm step: W08 opens with the attempt's values (navigation state only). */
type TransferPrefill = { destinationType: DestinationType; sourceAccountId: string; beneficiaryId?: string; destinationAccountId?: string; amount: string; concept: string; reference: string };
const confirmationAttempts = new Map<string, { code: string; key: string }>();
const recoveryFlights = new Map<string, Promise<Transfer>>();
const createKey = () => crypto.randomUUID();
/** D-UX-6: up to this many own accounts the source is shown inline as a radio group. */
const INLINE_SOURCES = 3;

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

/** Only a server answer whose detail names the balance or the daily limit is a W13 rejection (DEP-2 mapping). */
function definitiveRejection(error: unknown): { kind: RejectionKind } | null {
  if (!(error instanceof ApiError)) return null;
  const reason = `${error.problem.type} ${error.problem.title} ${error.problem.detail}`;
  if (/insufficient|saldo/i.test(reason)) return { kind: 'insufficient_balance' };
  if (/limit|l[ií]mite/i.test(reason)) return { kind: 'daily_limit' };
  return null;
}

const tailOf = (clabeMasked: string | undefined) => clabeTail(clabeMasked);
const accountIcon = (account: Account | undefined): IconName => account?.kind === 'savings' ? 'savings' : 'walletOutlined';
/** `$1,234.56 MXN` (single «MXN», D-3) as plain text for inline sentences. */
const mxn = (minor: string) => formatMxnFromMinor(minor);
const demoSuffix = (policy: TransferPolicy | undefined) => policy?.demoOnly ? ' (demostración)' : '';

type RadioItem = { id: string; disabledReason?: string };

/**
 * D-8: selectable cards as an ARIA radio group (one tab stop; arrows move and select; Space/Enter select;
 * Enter or a click also «commits», e.g. to fold the list). Disabled cards stay visible with their reason.
 */
function RadioCards<T extends RadioItem>({ id, labelledBy, items, selected, onSelect, onCommit, render, describedBy, invalid, className = '' }: {
  id?: string; labelledBy: string; items: readonly T[]; selected: string; onSelect: (id: string) => void; onCommit?: () => void;
  render: (item: T, checked: boolean) => ReactNode; describedBy?: string; invalid?: boolean; className?: string;
}) {
  const group = useRef<HTMLDivElement>(null);
  const enabled = items.filter((item) => !item.disabledReason);
  const tabStop = enabled.some((item) => item.id === selected) ? selected : enabled[0]?.id;
  const focusItem = (itemId: string) => group.current?.querySelector<HTMLElement>(`[data-radio-id="${CSS.escape(itemId)}"]`)?.focus();
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>, item: T) {
    const index = enabled.findIndex((candidate) => candidate.id === item.id);
    if (['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(event.key) && enabled.length) {
      event.preventDefault();
      const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1;
      const next = enabled[(index + step + enabled.length) % enabled.length]!;
      onSelect(next.id); focusItem(next.id);
    } else if (event.key === ' ') { event.preventDefault(); onSelect(item.id); }
    else if (event.key === 'Enter') { event.preventDefault(); onSelect(item.id); onCommit?.(); }
  }
  return <div ref={group} id={id} className={`tf-options ${className}`} role="radiogroup" aria-labelledby={labelledBy} aria-describedby={describedBy} aria-invalid={invalid || undefined}>
    {items.map((item) => {
      const checked = item.id === selected && !item.disabledReason;
      const reasonId = item.disabledReason ? `${id ?? labelledBy}-${item.id}-reason` : undefined;
      return <div key={item.id} role="radio" data-radio-id={item.id} aria-checked={checked} aria-disabled={item.disabledReason ? true : undefined}
        aria-labelledby={`${id ?? labelledBy}-${item.id}-name`} aria-describedby={reasonId} tabIndex={item.disabledReason ? -1 : item.id === tabStop ? 0 : -1}
        className={`tf-option${checked ? ' is-checked' : ''}${item.disabledReason ? ' is-disabled' : ''}`}
        onClick={item.disabledReason ? undefined : () => { onSelect(item.id); onCommit?.(); }} onKeyDown={item.disabledReason ? undefined : (event) => onKeyDown(event, item)}>
        <span className="tf-radio-mark" aria-hidden="true">{item.disabledReason ? <Icon name="block" size={14} /> : checked ? <Icon name="check" size={14} /> : null}</span>
        {render(item, checked)}
      </div>;
    })}
  </div>;
}

function FieldError({ id, children }: { id: string; children?: string }) {
  if (!children) return null;
  return <p id={id} className="tf-field-error t-body-sm-medium"><Icon name="report" size={16} /><span>{children}</span></p>;
}

function SectionLabel({ step, id, children, invalid }: { step: string; id: string; children: string; invalid?: boolean }) {
  return <span className={`tf-label${invalid ? ' is-error' : ''}`}><span className="t-label-caps" aria-hidden="true">{step}</span><span className="t-label-caps" id={id}>{children}</span>{invalid && <span className="tf-required" aria-hidden="true">*</span>}</span>;
}

function AccountSummaryCard({ account, ownerTag }: { account: Account; ownerTag?: string }) {
  return <div className="tf-select-card">
    <span className="tf-tile tf-tile-primary"><Icon name="bank" size={22} /></span>
    <span className="tf-card-text">
      <span className="t-headline-sm tf-ellipsis" title={account.name}>{account.name}</span>
      <span className="t-code-data tf-muted" data-clabe>{ownerTag ?? '••••'} {tailOf(account.clabeMasked)}</span>
    </span>
    <span className="tf-card-amount"><span className="tf-meta-caps">Saldo disponible</span><Amount minor={account.availableBalanceMinor} className="t-headline-sm tf-amount-value" suffixClassName="t-code-data tf-amount-suffix" /></span>
  </div>;
}

function BeneficiaryCardBody({ item, nameId, reason, reasonId }: { item: Beneficiary; nameId?: string; reason?: string; reasonId?: string }) {
  return <>
    <span className="tf-avatar" aria-hidden="true">{initialsOf(item.name)}</span>
    <span className="tf-card-text">
      <span className="tf-name-row"><span className="t-headline-sm tf-ellipsis" id={nameId} title={item.name}>{item.name}</span><span className="chip chip-neutral tf-alias t-code-data" title={`Alias: ${item.alias}`}>Alias: {item.alias}</span></span>
      <span className="t-code-data tf-muted" data-clabe>Cuenta •••• {tailOf(item.clabeMasked)}</span>
      {reason && <span className="tf-option-reason t-body-sm" id={reasonId}><Icon name="block" size={16} />{reason}</span>}
    </span>
  </>;
}

/** Shared W08 entry state: what the user captured, kept when switching tabs and when coming back from W09/W13. */
function useInitialTransferState() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const prefill = (location.state as { prefill?: TransferPrefill } | null)?.prefill;
  return {
    prefill,
    destinationType: prefill?.destinationType ?? (params.get('type') === 'own_account' ? 'own_account' as const : 'beneficiary' as const),
    sourceAccountId: prefill?.sourceAccountId ?? params.get('source') ?? '',
    beneficiaryId: prefill?.beneficiaryId ?? params.get('beneficiaryId') ?? '',
    destinationAccountId: prefill?.destinationAccountId ?? '',
    values: { amount: prefill?.amount ?? '', concept: prefill?.concept ?? '', reference: prefill?.reference ?? '' },
  };
}

export function NewTransferPage() {
  const { session, hydrated } = useSession();
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: () => request<{ items: Account[] }>('/accounts') });
  const beneficiaries = useQuery({ queryKey: ['beneficiaries'], queryFn: () => request<{ items: Beneficiary[] }>('/beneficiaries') });
  const policy = useTransferPolicy();
  const initial = useInitialTransferState();
  const [destinationType, setDestinationType] = useState<DestinationType>(initial.destinationType);
  const [step, setStep] = useState<'entry' | 'review'>('entry');
  // ?source=, ?beneficiaryId= and ?type=own_account only set initial values (D-8, W06-F1); no request.
  const [sourceAccountId, setSourceAccountId] = useState(initial.sourceAccountId);
  const [destinationAccountId, setDestinationAccountId] = useState(initial.destinationAccountId);
  const [beneficiaryId, setBeneficiaryId] = useState(initial.beneficiaryId);
  const [values, setValues] = useState<TransferValues>(initial.values);
  // SPEC §5.5: errors appear on submit; afterwards only the fields flagged then (or blurred since) are re-validated live.
  const [flagged, setFlagged] = useState<ReadonlySet<TransferField>>(() => new Set());
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [recipientOpen, setRecipientOpen] = useState(false);
  // Focus moves after React commits (never in a later frame, so typing can't land in another field).
  const [focusTarget, setFocusTarget] = useState<TransferField | 'heading' | 'sourceToggle' | 'recipientToggle' | null>(initial.prefill ? 'amount' : null);
  const [busy, setBusy] = useState(false);
  const submitLock = useRef(false);
  const [error, setError] = useState('');
  const [rejection, setRejection] = useState<W13Rejection | null>(null);
  const [uncertainDraft, setUncertainDraft] = useState<TransferDraft | null>(null);
  const navigate = useNavigate();
  // W11-V2 while the same-tab record is recovered on mount (its action: GET with an id, same-key POST without one).
  const [recovering, setRecovering] = useState<TransferDraft | null>(null);
  const [uncertainCause, setUncertainCause] = useState<VerifyCause>('interrupted');
  const [retryFailed, setRetryFailed] = useState(false);
  const sourceToggle = useRef<HTMLButtonElement>(null);
  const recipientToggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!hydrated || !session) return;
    const draft = readTransferDraft(session.user.id);
    if (!draft) return;
    let active = true;
    setRecovering(draft);
    void (async () => {
      try {
        const transfer = await recoverTransferDraft(session.user.id, draft);
        if (active) navigate(`/transfers/${transfer.id}/status`, { replace: true, state: { transfer } });
      } catch (cause) {
        if (active && !(cause instanceof ApiError && cause.problem.status === 401)) {
          setUncertainDraft(draft);
          setUncertainCause(cause instanceof ApiError ? 'answer' : 'interrupted');
          setError(errorText(cause));
        }
      } finally { if (active) setRecovering(null); }
    })();
    return () => { active = false; };
  }, [hydrated, session, navigate]);
  // Focus follows the step: the W08 amount after «Modificar monto» (W13-F1), the h1 after a step change.
  useEffect(() => {
    if (!focusTarget) return;
    const target = focusTarget === 'heading' ? document.querySelector<HTMLElement>('main h1')
      : focusTarget === 'sourceToggle' ? sourceToggle.current
        : focusTarget === 'recipientToggle' ? recipientToggle.current
          : focusTarget === 'recipient' ? document.querySelector<HTMLElement>('#tf-recipient-options [role="radio"][tabindex="0"]') ?? recipientToggle.current
            : document.getElementById(`tf-${focusTarget}`);
    if (!target) return;
    target.focus();
    if (focusTarget === 'heading') window.scrollTo(0, 0);
    setFocusTarget(null);
  });
  if (!hydrated) return <AppShell><StatePanel tone="loading" title="Cargando tu sesión">Estamos verificando tu acceso.</StatePanel></AppShell>;
  if (!session) return <Navigate to="/login" replace state={{ from: '/transfers/new' }} />;
  if (recovering) return <AppShell active="transfers"><VerifyView mode="verifying" action={recovering.transferId ? 'query' : 'resend'} cause="pending" panel={panelFromBody(recovering.body, accounts.data?.items ?? [], beneficiaries.data?.items ?? [])} /></AppShell>;
  const currentUserId = session.user.id;
  // ORD-02 / D-UX-6: client order (principal first); the default source is ?source= or the principal account.
  const ownAccounts = orderAccounts(accounts.data?.items ?? []);
  const recipients = beneficiaries.data?.items ?? [];
  const accountsError = accounts.error;
  const beneficiariesError = beneficiaries.error;
  const policyData = policy.isSuccess ? policy.data : undefined;

  // D-7: identity, not names. The source defaults to ?source= or the first account.
  const sourceId = ownAccounts.some((account) => account.id === sourceAccountId) ? sourceAccountId : ownAccounts[0]?.id ?? '';
  const source = ownAccounts.find((account) => account.id === sourceId);
  const ownDestinationId = effectiveOwnDestination(ownAccounts, sourceId, destinationAccountId);
  const ownDestination = ownAccounts.find((account) => account.id === ownDestinationId);
  const selectedBeneficiary = recipients.find((item) => item.id === beneficiaryId);
  const selectedBlocked = selectedBeneficiary ? beneficiaryBlocked(selectedBeneficiary, sourceId) : false;
  const recipientId = destinationType === 'beneficiary' ? selectedBeneficiary?.id ?? '' : ownDestinationId;
  const errors = validateTransfer(values, { type: destinationType, id: recipientId, blocked: destinationType === 'beneficiary' && selectedBlocked });
  const shownErrors: TransferErrors = Object.fromEntries(TRANSFER_FIELDS.filter((field) => flagged.has(field) && errors[field]).map((field) => [field, errors[field]]));
  const flag = (field: TransferField) => { if (flagged.size > 0 && !flagged.has(field)) setFlagged(new Set([...flagged, field])); };
  const amountMinor = amountMinorOf(values.amount);
  const noBeneficiaries = destinationType === 'beneficiary' && recipients.length === 0;
  const noSecondAccount = destinationType === 'own_account' && ownAccounts.length < 2;
  const continueReason = noBeneficiaries ? 'Registra un beneficiario o transfiere entre tus cuentas para continuar.'
    : noSecondAccount ? 'Necesitas una segunda cuenta propia para transferir entre tus cuentas.'
      : destinationType === 'beneficiary' && selectedBlocked ? `${TRANSFER_MESSAGES.blockedBeneficiary}. Elige otra cuenta de origen u otro beneficiario.` : null;
  const body = amountMinor === null ? null : createBody({ destinationType, sourceAccountId: sourceId, beneficiaryId: selectedBeneficiary?.id ?? '', destinationAccountId: ownDestinationId, amountMinor: amountMinor.toString(), concept: values.concept, reference: values.reference });

  const setValue = (field: keyof TransferValues) => (value: string) => setValues((current) => ({ ...current, [field]: value }));
  function chooseType(next: DestinationType) { setDestinationType(next); setRecipientOpen(false); }

  function continueToReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    if (continueReason) return;
    if (errorCount(errors) > 0) {
      setFlagged(new Set(TRANSFER_FIELDS.filter((field) => errors[field])));
      if (errors.recipient && destinationType === 'beneficiary') setRecipientOpen(true);
      const first = TRANSFER_FIELDS.find((field) => errors[field]);
      if (first) setFocusTarget(first);
      return;
    }
    setFlagged(new Set()); setStep('review'); setFocusTarget('heading');
  }

  async function submit() {
    if (submitLock.current) return; submitLock.current = true; setBusy(true); setError('');
    const minor = amountMinorOf(values.amount);
    if (minor === null) { setError(TRANSFER_MESSAGES.amountInvalid); submitLock.current = false; setBusy(false); return; }
    const createRequest = createBody({ destinationType, sourceAccountId: sourceId, beneficiaryId: selectedBeneficiary?.id ?? '', destinationAccountId: ownDestinationId, amountMinor: minor.toString(), concept: values.concept, reference: values.reference });
    const parsed = transferCreateRequestSchema.safeParse(createRequest);
    if (!parsed.success) { setError(parsed.error.issues.map((issue) => issue.message).join(' ')); submitLock.current = false; setBusy(false); return; }
    if (createRequest.destinationType === 'own_account' && createRequest.destinationAccountId === sourceId) { setError('Elige una cuenta de destino distinta a la cuenta de origen.'); submitLock.current = false; setBusy(false); return; }
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
        if (rejected) {
          setError('');
          // W13-V2/V4: balance and limits as the server reports them after the rejection (GET only).
          const [freshAccounts, freshPolicy] = await Promise.all([accounts.refetch(), policy.refetch()]);
          const accountsNow = freshAccounts.status === 'success' ? freshAccounts.data.items : undefined;
          setRejection({ kind: rejected.kind, amountMinor: minor.toString(), sourceAccount: accountsNow?.find((account) => account.id === sourceId), policy: freshPolicy.status === 'success' ? freshPolicy.data : undefined });
          setFocusTarget('heading');
        }
        else setError(`${errorText(cause)} Puedes corregir los datos y crear un nuevo intento.`);
      }
      else { setUncertainDraft(draft); setUncertainCause(cause instanceof ApiError ? 'answer' : 'interrupted'); setRetryFailed(false); setError(errorText(cause)); }
    } finally { submitLock.current = false; setBusy(false); }
  }

  async function recoverUncertainAttempt() {
    if (!uncertainDraft) return;
    setBusy(true); setRetryFailed(false);
    try {
      const result = await requestTransfer<Transfer>('/transfers', uncertainDraft.key, { method: 'POST', body: JSON.stringify(uncertainDraft.body) });
      saveTransferDraft(currentUserId, { ...uncertainDraft, transferId: result.id });
      navigate(`/transfers/${result.id}/status`, { state: { transfer: result } });
    } catch (cause) { setError(errorText(cause)); setUncertainCause(cause instanceof ApiError ? 'answer' : 'interrupted'); setRetryFailed(true); }
    finally { setBusy(false); }
  }

  if (accounts.isPending || beneficiaries.isPending) return <AppShell active="transfers"><StatePanel tone="loading" title="Cargando opciones">Consultando tus cuentas y beneficiarios.</StatePanel></AppShell>;
  if (accountsError || beneficiariesError) return <AppShell active="transfers"><StatePanel tone="error" title="No pudimos cargar tus opciones" action={<button type="button" className="btn btn-secondary" onClick={() => { void accounts.refetch(); void beneficiaries.refetch(); }}>Intentar de nuevo</button>}>{errorText(accountsError ?? beneficiariesError)}</StatePanel></AppShell>;
  if (uncertainDraft) {
    // W11-V3 / V2: the only action repeats the same POST with the record's key and body (F-W11-1 copy).
    const panel = panelFromBody(uncertainDraft.body, ownAccounts, recipients);
    return <AppShell active="transfers"><VerifyView mode={busy ? 'verifying' : 'unknown'} action="resend" cause={busy ? 'interrupted' : uncertainCause} panel={panel}
      notice={retryFailed ? 'No pudimos confirmar todavía. El mismo intento permanece guardado para volver a verificarlo.' : undefined} onAction={() => void recoverUncertainAttempt()} /></AppShell>;
  }
  if (rejection) return <AppShell active="transfers"><RejectionView rejection={rejection} onModify={() => { setRejection(null); setStep('entry'); setFocusTarget('amount'); }} /></AppShell>;
  // W11-V1 while the POST of this review is in flight (the review CTA is gone: one tap, one POST).
  if (step === 'review' && body && busy) return <AppShell active="transfers"><SendingView panel={panelFromBody(body, ownAccounts, recipients)} /></AppShell>;
  if (step === 'review' && body) {
    return <AppShell active="transfers"><ReviewView body={body} source={source} beneficiary={selectedBeneficiary} destinationAccount={ownDestination} policy={policyData} holder={session.user.fullName} busy={busy} error={error}
      onModify={() => { setStep('entry'); setError(''); setFocusTarget('heading'); }} onConfirm={() => void submit()} /></AppShell>;
  }
  if (ownAccounts.length === 0) return <AppShell active="transfers"><StatePanel title="No tienes cuentas disponibles">No hay una cuenta de origen para realizar una transferencia.</StatePanel></AppShell>;

  const remaining = policyData?.dailyRemainingMinor;
  const otherAccounts = ownAccounts.filter((account) => account.id !== sourceId);
  const beneficiaryItems = recipients.map((item) => ({ ...item, disabledReason: beneficiaryBlocked(item, sourceId) ? TRANSFER_MESSAGES.blockedBeneficiary : undefined }));
  const ownItems = [...otherAccounts, ...ownAccounts.filter((account) => account.id === sourceId)].map((account) => ({ ...account, disabledReason: account.id === sourceId ? TRANSFER_MESSAGES.sameAccount : undefined }));
  const showRecipientList = destinationType === 'beneficiary' && !noBeneficiaries && (!selectedBeneficiary || recipientOpen);
  const describe = (...ids: Array<string | false | undefined>) => ids.filter(Boolean).join(' ') || undefined;
  const fieldLabels: Record<TransferField, string> = { recipient: destinationType === 'beneficiary' ? 'Destinatario' : 'Cuenta de destino', amount: 'Importe a transferir', concept: 'Concepto', reference: 'Referencia numérica' };
  const fieldTargets: Record<TransferField, string> = { recipient: 'tf-recipient-options', amount: 'tf-amount', concept: 'tf-concept', reference: 'tf-reference' };
  const summaryItems: ErrorSummaryItem[] = TRANSFER_FIELDS.filter((field) => shownErrors[field]).map((field) => ({ field: fieldTargets[field], label: fieldLabels[field], message: shownErrors[field]! }));

  return <AppShell active="transfers"><div className="tf-page">
    <PageHeader className="tf-header" eyebrow={<p className="tf-breadcrumb t-body-sm"><span>Transferir</span><span className="tf-crumb-sep" aria-hidden="true">/</span><span className="t-body-sm-medium tf-crumb-current">Nueva transferencia</span></p>}
      title="Transferir dinero" subtitle="Envía fondos a un beneficiario registrado o entre tus cuentas propias." />
    {error && <Notice>{error}</Notice>}
    <div className="tf-layout">
      <div className="tf-main"><div className="tf-card">
        <form className="transfer-form tf-form" noValidate onSubmit={continueToReview} aria-describedby={continueReason ? 'tf-continue-reason' : undefined}>
          <div className="tf-section" role="group" aria-labelledby="tf-source-label">
            <div className="tf-section-head"><SectionLabel step="1." id="tf-source-label">Cuenta de origen</SectionLabel>
              {ownAccounts.length > INLINE_SOURCES && <button ref={sourceToggle} type="button" className="tf-link t-body-sm-medium" aria-expanded={sourceOpen} aria-controls="tf-source-options" onClick={() => setSourceOpen((open) => !open)}>Cambiar cuenta</button>}
            </div>
            {/* D-UX-6: with up to three accounts the source is always a radio group (changing it is one click). */}
            {sourceOpen || (ownAccounts.length > 1 && ownAccounts.length <= INLINE_SOURCES)
              ? <RadioCards id="tf-source-options" labelledBy="tf-source-label" items={ownAccounts} selected={sourceId} onSelect={setSourceAccountId} className="tf-options-compact"
                onCommit={ownAccounts.length > INLINE_SOURCES ? () => { setSourceOpen(false); setFocusTarget('sourceToggle'); } : undefined}
                render={(account) => <><span className="tf-tile tf-tile-primary"><Icon name={accountIcon(account)} size={22} /></span><span className="tf-card-text"><span className="t-headline-sm tf-ellipsis" id={`tf-source-options-${account.id}-name`} title={account.name}>{account.name}</span><span className="t-code-data tf-muted" data-clabe>•••• {tailOf(account.clabeMasked)}</span></span><span className="tf-card-amount"><span className="tf-meta-caps">Saldo disponible</span><Amount minor={account.availableBalanceMinor} className="t-headline-sm tf-amount-value" suffixClassName="t-code-data tf-amount-suffix" /></span></>} />
              : source && <AccountSummaryCard account={source} />}
          </div>

          <div className="tf-section" role="group" aria-labelledby="tf-type-label">
            <div className="tf-section-head"><SectionLabel step="2." id="tf-type-label">Tipo de destino</SectionLabel></div>
            <div className="tf-segmented">
              <button type="button" className={destinationType === 'beneficiary' ? 'is-active' : ''} aria-pressed={destinationType === 'beneficiary'} onClick={() => chooseType('beneficiary')}><Icon name="personOutlined" size={18} /><span>A un beneficiario</span></button>
              <button type="button" className={destinationType === 'own_account' ? 'is-active' : ''} aria-pressed={destinationType === 'own_account'} onClick={() => chooseType('own_account')}><Icon name="syncAlt" size={18} /><span>Entre mis cuentas</span></button>
            </div>
          </div>

          {destinationType === 'beneficiary' ? <div className="tf-section" role="group" aria-labelledby="tf-recipient-label">
            <div className="tf-section-head"><SectionLabel step="3." id="tf-recipient-label" invalid={Boolean(shownErrors.recipient)}>Destinatario</SectionLabel>
              {selectedBeneficiary && <button ref={recipientToggle} type="button" className="tf-link t-body-sm-medium" aria-expanded={recipientOpen} aria-controls="tf-recipient-options" onClick={() => setRecipientOpen((open) => !open)}>Buscar otro beneficiario</button>}
            </div>
            {noBeneficiaries ? <div className="tf-empty">
              <span className="tf-empty-icon"><Icon name="personAddOutlined" size={32} /><span className="tf-empty-badge"><Icon name="infoOutlined" size={16} /></span></span>
              <h2 className="t-headline-sm">No tienes beneficiarios registrados en tu cuenta</h2>
              <p className="t-body-md">Registra primero un beneficiario de Billetera MXN.</p>
              <div className="tf-empty-actions">
                <Link className="btn btn-primary" to="/beneficiaries/new"><Icon name="add" /><span>Agregar nuevo beneficiario</span></Link>
                {ownAccounts.length > 1 && <button type="button" className="btn tf-btn-white" onClick={() => chooseType('own_account')}>Transferir a cuenta propia</button>}
              </div>
            </div>
              : showRecipientList
                ? <RadioCards id="tf-recipient-options" labelledBy="tf-recipient-label" items={beneficiaryItems} selected={selectedBeneficiary?.id ?? ''} onSelect={setBeneficiaryId} describedBy={describe(shownErrors.recipient && 'tf-recipient-error')} invalid={Boolean(shownErrors.recipient)}
                  onCommit={() => { setRecipientOpen(false); setFocusTarget('recipientToggle'); }}
                  render={(item) => <BeneficiaryCardBody item={item} nameId={`tf-recipient-options-${item.id}-name`} reason={item.disabledReason} reasonId={`tf-recipient-options-${item.id}-reason`} />} />
                : selectedBeneficiary && <div className={`tf-select-card${selectedBlocked ? ' is-blocked' : ''}`}>
                  <BeneficiaryCardBody item={selectedBeneficiary} reason={selectedBlocked ? TRANSFER_MESSAGES.blockedBeneficiary : undefined} />
                </div>}
            <FieldError id="tf-recipient-error">{shownErrors.recipient}</FieldError>
          </div>
            : <div className="tf-section" role="group" aria-labelledby="tf-destination-label">
              <div className="tf-section-head"><SectionLabel step="3." id="tf-destination-label" invalid={Boolean(shownErrors.recipient)}>Cuenta de destino</SectionLabel>
                {!noSecondAccount && <span className="t-body-sm tf-muted">{otherAccounts.length} {otherAccounts.length === 1 ? 'cuenta disponible' : 'cuentas disponibles'}</span>}
              </div>
              {noSecondAccount ? <div className="tf-info-panel">
                <span className="tf-info-icon"><Icon name="infoOutlined" size={22} /></span>
                <div className="tf-info-text"><h2 className="t-body-md-medium">No cuentas con otra cuenta propia disponible</h2><p className="t-body-sm">Para transferir entre tus cuentas necesitas al menos dos cuentas de Billetera MXN. Puedes continuar transfiriendo a un beneficiario registrado.</p></div>
                <button type="button" className="btn tf-btn-tonal" onClick={() => chooseType('beneficiary')}><Icon name="personAddOutlined" size={18} /><span>Transferir a un beneficiario</span></button>
              </div>
                : <RadioCards id="tf-recipient-options" labelledBy="tf-destination-label" items={ownItems} selected={ownDestinationId} onSelect={setDestinationAccountId} describedBy={describe(shownErrors.recipient && 'tf-recipient-error')} invalid={Boolean(shownErrors.recipient)} className="tf-options-own"
                  render={(account) => <>
                    <span className="tf-tile tf-tile-soft"><Icon name={accountIcon(account)} size={22} /></span>
                    <span className="tf-card-text">
                      <span className="tf-name-row"><span className={account.disabledReason ? 't-body-md-medium tf-ellipsis' : 't-headline-sm tf-ellipsis'} id={`tf-recipient-options-${account.id}-name`} title={account.name}>{account.name}</span>{account.disabledReason && <span className="chip chip-neutral tf-origin-chip t-label-caps">Origen actual</span>}</span>
                      <span className="t-code-data tf-muted" data-clabe>N° •• {tailOf(account.clabeMasked)}</span>
                    </span>
                    {account.disabledReason
                      ? <span className="tf-option-reason t-body-sm" id={`tf-recipient-options-${account.id}-reason`}>{account.disabledReason}</span>
                      : <span className="tf-card-amount"><span className="t-label-caps tf-muted">Saldo actual</span><Amount minor={account.availableBalanceMinor} className="t-body-md-medium tf-amount-value" suffixClassName="t-body-sm tf-amount-suffix" /></span>}
                  </>} />}
              <FieldError id="tf-recipient-error">{shownErrors.recipient}</FieldError>
            </div>}

          <div className={`tf-field${shownErrors.amount ? ' is-invalid' : ''}`}>
            <div className="tf-section-head"><span className={`tf-label${shownErrors.amount ? ' is-error' : ''}`}><span className="t-label-caps" aria-hidden="true">4.</span><label className="t-label-caps" htmlFor="tf-amount">Importe a transferir</label>{shownErrors.amount && <span className="tf-required" aria-hidden="true">*</span>}</span>
              {remaining !== undefined && <span className="t-body-sm tf-muted" id="tf-amount-daily">Disponible hoy: <strong className="tf-strong" data-amount>{mxn(remaining)}</strong>{demoSuffix(policyData)}</span>}
            </div>
            <div className="tf-amount-input">
              <span className="tf-amount-currency t-headline-md" aria-hidden="true">$</span>
              <input id="tf-amount" name="amount" className="t-headline-md" type="text" inputMode="decimal" autoComplete="off" placeholder="0.00" value={values.amount} onChange={(event) => setValue('amount')(event.target.value)} onBlur={() => flag('amount')}
                aria-invalid={shownErrors.amount ? true : undefined} aria-describedby={describe(shownErrors.amount && 'tf-amount-error', remaining !== undefined && 'tf-amount-daily')} />
              <span className="tf-amount-badge t-code-data" aria-hidden="true">MXN</span>
            </div>
            <FieldError id="tf-amount-error">{shownErrors.amount}</FieldError>
          </div>

          <div className="tf-two">
            <div className={`tf-field${shownErrors.concept ? ' is-invalid' : ''}`}>
              <div className="tf-section-head"><span className={`tf-label${shownErrors.concept ? ' is-error' : ''}`}><span className="t-label-caps" aria-hidden="true">5.</span><label className="t-label-caps" htmlFor="tf-concept">Concepto</label>{shownErrors.concept && <span className="tf-required" aria-hidden="true">*</span>}</span>
                <span className={`t-code-data ${shownErrors.concept ? 'tf-error-text' : 'tf-muted'}`} id="tf-concept-count">{values.concept.length} / 40</span>
              </div>
              <div className="tf-input"><input id="tf-concept" name="concept" className="t-body-md" maxLength={40} autoComplete="off" placeholder="Ej. Pago de renta" value={values.concept} onChange={(event) => setValue('concept')(event.target.value)} onBlur={() => flag('concept')}
                aria-invalid={shownErrors.concept ? true : undefined} aria-describedby={describe(shownErrors.concept && 'tf-concept-error', 'tf-concept-count')} />{shownErrors.concept && <Icon name="warning" className="tf-input-icon" />}</div>
              <FieldError id="tf-concept-error">{shownErrors.concept}</FieldError>
            </div>
            <div className={`tf-field${shownErrors.reference ? ' is-invalid' : ''}`}>
              <div className="tf-section-head"><span className={`tf-label${shownErrors.reference ? ' is-error' : ''}`}><span className="t-label-caps" aria-hidden="true">6.</span><label className="t-label-caps" htmlFor="tf-reference">Referencia numérica</label>{shownErrors.reference && <span className="tf-required" aria-hidden="true">*</span>}</span>
                <span className="t-code-data tf-muted" id="tf-reference-hint">Hasta 7 dígitos</span>
              </div>
              <div className="tf-input"><input id="tf-reference" name="reference" className="t-code-data tf-input-code" inputMode="numeric" maxLength={7} autoComplete="off" placeholder="p. ej. 1234567" value={values.reference} onChange={(event) => setValue('reference')(event.target.value)} onBlur={() => flag('reference')}
                aria-invalid={shownErrors.reference ? true : undefined} aria-describedby={describe(shownErrors.reference && 'tf-reference-error', 'tf-reference-hint')} />{shownErrors.reference && <Icon name="errorOutlined" className="tf-input-icon" />}</div>
              <FieldError id="tf-reference-error">{shownErrors.reference}</FieldError>
            </div>
          </div>

          {summaryItems.length > 0 && <FormErrorSummary id="tf-error-summary" items={summaryItems} title={`Corrige ${summaryItems.length === 1 ? 'el campo marcado' : `los ${summaryItems.length} campos marcados`} para continuar`} />}
          <div className="form-footer">
            <Link className="btn btn-outline" to="/accounts">Cancelar</Link>
            <ActionBar reason={continueReason ?? undefined} reasonId="tf-continue-reason">
              <button type="submit" className="btn btn-primary tf-continue" disabled={Boolean(continueReason)} aria-describedby={continueReason ? 'tf-continue-reason' : undefined}><span>Continuar a revisión</span><Icon name="arrowForward" size={18} /></button>
            </ActionBar>
          </div>
        </form>
      </div></div>
      <EntrySummary destinationType={destinationType} amountMinor={amountMinor} source={source} destination={ownDestination} beneficiary={selectedBlocked ? undefined : selectedBeneficiary} open={summaryOpen} onToggle={() => setSummaryOpen((open) => !open)} />
    </div>
  </div></AppShell>;
}

/**
 * W08-V4 «Resumen previo» (beneficiary) / W08-V5 «Resumen proyectado» (own accounts). Estimates only (D-5).
 * D-UX-6: ≥1024 a sticky side column; <1024 a block after the form, collapsed behind a 44 px toggle.
 */
function EntrySummary({ destinationType, amountMinor, source, destination, beneficiary, open, onToggle }: {
  destinationType: DestinationType; amountMinor: bigint | null; source?: Account; destination?: Account; beneficiary?: Beneficiary; open: boolean; onToggle: () => void;
}) {
  const projection = projectDebit(source?.availableBalanceMinor, amountMinor);
  const own = destinationType === 'own_account';
  const title = own ? 'Resumen proyectado' : 'Resumen previo';
  const missingAmount = <span className="tf-missing">Ingresa un importe</span>;
  const amount = amountMinor !== null ? <span data-amount>{mxn(amountMinor.toString())}</span> : missingAmount;
  const destinationProjected = destination && amountMinor !== null ? (BigInt(destination.availableBalanceMinor) + amountMinor).toString() : null;
  const sourceAfter = projection ? projection.exceeds ? <span className="tf-missing">Supera el saldo disponible</span> : <span data-amount>{mxn(projection.projected.toString())}</span> : missingAmount;
  return <aside className={`tf-summary${open ? ' is-open' : ''}`} aria-labelledby="tf-summary-title">
    <h2 className="t-headline-sm tf-summary-title" id="tf-summary-title">
      <span className="tf-summary-label"><Icon name="receipt" size={20} className="tf-primary-icon" /><span>{title}</span></span>
      <button type="button" className="tf-summary-toggle" aria-expanded={open} aria-controls="tf-summary-body" onClick={onToggle}>
        <Icon name="receipt" size={20} className="tf-primary-icon" />
        <span className="tf-summary-toggle-text">{title} · <span data-amount>{amountMinor !== null ? mxn(amountMinor.toString()) : 'sin importe'}</span></span>
        <Icon name="expandMore" size={20} className="tf-summary-chevron" />
      </button>
    </h2>
    <div className="tf-summary-body" id="tf-summary-body">
      <dl className="tf-summary-rows t-body-md">
        {own ? <>
          <div><dt>Monto a traspasar</dt><dd className="t-body-md-medium">{amount}</dd></div>
          <div><dt>Saldo final en origen{source && <> <span data-clabe>(•• {tailOf(source.clabeMasked)})</span></>}</dt><dd className="t-body-md-medium">{sourceAfter}</dd></div>
          <div><dt>Saldo final en destino{destination && <> <span data-clabe>(•• {tailOf(destination.clabeMasked)})</span></>}</dt><dd className="t-body-md-medium">{destinationProjected ? <span data-amount>{mxn(destinationProjected)}</span> : destination ? missingAmount : <span className="tf-missing">Elige una cuenta de destino</span>}</dd></div>
        </> : <>
          <div><dt>Para</dt><dd className="t-body-md-medium">{beneficiary ? <span className="tf-summary-name" title={beneficiary.name}>{beneficiary.name}</span> : <span className="tf-missing">Elige un destinatario</span>}</dd></div>
          <div><dt>Desde</dt><dd className="t-body-md-medium">{source?.name ?? '—'}</dd></div>
          <div className="tf-summary-total"><dt>Monto a debitar</dt><dd className="t-headline-sm">{amount}</dd></div>
        </>}
      </dl>
      {!own && <div className="tf-projection">
        <div className="tf-projection-head t-body-sm"><span className="tf-muted">Saldo proyectado</span><strong>{sourceAfter}</strong></div>
        <div className="tf-bar" aria-hidden="true"><span style={{ width: projection && !projection.exceeds ? projection.width : '0%' }} /></div>
        {projection && <span className="tf-projection-note t-body-sm tf-muted">{projection.exceeds ? 'El importe supera el saldo disponible actual' : projection.percent ? `Representa el ${projection.percent}% de tu saldo disponible actual` : 'Saldo estimado con tu saldo disponible actual'}</span>}
      </div>}
      <p className="t-body-sm tf-muted tf-summary-note">{own ? 'Saldos estimados con tus saldos disponibles actuales.' : 'Estimación con tu saldo disponible actual.'}</p>
    </div>
  </aside>;
}

type CreateBody = ReturnType<typeof createBody>;

/**
 * W09 · references `w09_revisar_transferencia` (normal), `w09_revisi_n_6_000_mxn` (requires a code) and
 * `w09_revisi_n_entre_cuentas_propias` (own accounts, HTML only). Shows exactly the body that will be sent.
 */
function ReviewView({ body, source, beneficiary, destinationAccount, policy, holder, busy, error, onModify, onConfirm }: {
  body: CreateBody; source?: Account; beneficiary?: Beneficiary; destinationAccount?: Account; policy?: TransferPolicy; holder: string;
  busy: boolean; error: string; onModify: () => void; onConfirm: () => void;
}) {
  const code = requiresCode(body.amountMinor, policy);
  const amount = BigInt(body.amountMinor);
  const projection = projectDebit(source?.availableBalanceMinor, amount);
  const ctaLabel = code ? 'Continuar a verificación' : 'Confirmar transferencia';
  const cta = (className: string, icon: IconName = 'arrowForward') => <button type="button" className={`btn btn-primary ${className}`} disabled={busy} aria-busy={busy || undefined} onClick={onConfirm}>
    {busy ? <><Icon name="spinner" size={18} className="spin" /><span>Enviando…</span></> : icon === 'send' ? <><Icon name="send" size={18} /><span>{ctaLabel}</span></> : <><span>{ctaLabel}</span><Icon name="arrowForward" size={18} /></>}
  </button>;
  const modify = (className: string) => <button type="button" className={`btn ${className}`} disabled={busy} onClick={onModify}><Icon name="edit" size={18} /><span>Modificar datos</span></button>;
  const codeText = policy && code ? `Como el importe es igual o mayor al umbral configurado (${mxn(policy.otpThresholdMinor)}${policy.demoOnly ? ', demostración' : ''}), te pediremos un código de confirmación en el siguiente paso.` : null;
  const neutral = code === null ? <p className="t-body-sm tr-neutral"><Icon name="infoOutlined" size={16} /><span>Puede requerir un código de confirmación.</span></p> : null;

  if (body.destinationType === 'own_account') {
    const destinationProjected = destinationAccount ? (BigInt(destinationAccount.availableBalanceMinor) + amount).toString() : null;
    return <div className="tr-page tr-page-own">
      <ol className="tr-stepper">
        <li className="tr-step-done"><span className="tr-step-dot"><Icon name="check" size={16} /></span><span className="t-body-sm-medium">1. Configuración de envío</span><span className="sr-only">(completado)</span></li>
        <li aria-hidden="true" className="tr-step-sep"><Icon name="chevronRight" size={14} /></li>
        <li className="tr-step-current" aria-current="step"><span className="tr-step-dot t-body-sm-medium">2</span><span className="t-body-md-medium">Revisión y confirmación</span></li>
      </ol>
      <h1 className="t-headline-lg" tabIndex={-1}>Revisa y confirma tu transferencia</h1>
      {error && <Notice>{error}</Notice>}
      <div className="tr-own-banner">
        <span className="tr-own-banner-tile"><Icon name="infoOutlined" size={22} /></span>
        <div className="tr-own-banner-text"><h2 className="t-headline-sm">Revisa los datos antes de enviar</h2><p className="t-body-md">El traspaso entre tus cuentas aún no ha sido confirmado.</p></div>
        <span className="chip tr-step-chip t-label-caps">Paso 2 de 2</span>
      </div>
      <div className="tr-grid">
        <div className="tr-col-main">
          <section className="tr-card tr-breakdown" aria-labelledby="tr-breakdown-title">
            <div className="tr-breakdown-head"><span className="t-label-caps tf-muted">Entre cuentas propias</span><h2 className="t-headline-md" id="tr-breakdown-title">Desglose de la operación</h2></div>
            <div className="tr-hero"><span className="t-label-caps tf-muted">Monto a traspasar</span><Amount minor={body.amountMinor} className="t-display-currency tr-hero-amount" suffixClassName="t-headline-sm tr-hero-suffix" /></div>
            <div className="tr-flow">
              <div className="tr-node"><div className="tr-node-head"><span className="t-label-caps tf-muted">Cuenta origen</span><Icon name="arrowOutward" size={18} className="tf-muted" /></div>
                <div className="tr-node-account"><span className="tr-node-tile"><Icon name="bank" size={18} /></span><span className="tf-card-text"><span className="t-headline-sm tf-ellipsis" title={source?.name}>{source?.name ?? 'Cuenta de origen'}</span><span className="t-code-data tf-muted" data-clabe>•• {tailOf(source?.clabeMasked)}</span></span></div>
                <div className="tr-node-balance"><span className="t-body-sm tf-muted">Saldo disponible:</span>{source ? <Amount minor={source.availableBalanceMinor} className="t-body-md-medium" suffixClassName="" /> : <span>—</span>}</div></div>
              <span className="tr-flow-arrow" aria-hidden="true"><Icon name="trendingFlat" size={20} /></span>
              <div className="tr-node"><div className="tr-node-head"><span className="t-label-caps tf-muted">Cuenta destino</span><Icon name="subdirectoryArrowRight" size={18} className="tr-secondary-icon" /></div>
                <div className="tr-node-account"><span className="tr-node-tile tr-node-tile-dest"><Icon name={accountIcon(destinationAccount)} size={18} /></span><span className="tf-card-text"><span className="t-headline-sm tf-ellipsis" title={destinationAccount?.name}>{destinationAccount?.name ?? 'Cuenta propia'}</span><span className="t-code-data tf-muted" data-clabe>•• {tailOf(destinationAccount?.clabeMasked)}</span></span></div>
                <div className="tr-node-balance"><span className="t-body-sm tf-muted">Saldo actual:</span>{destinationAccount ? <Amount minor={destinationAccount.availableBalanceMinor} className="t-body-md-medium" suffixClassName="" /> : <span>—</span>}</div></div>
            </div>
            <dl className="tr-meta-strip">
              <div><dt className="t-label-caps tf-muted">Concepto de transferencia</dt><dd className="t-body-lg tr-medium">{body.concept}</dd></div>
              <div><dt className="t-label-caps tf-muted">Número de referencia</dt><dd className="t-code-data tr-reference">{body.reference}</dd></div>
            </dl>
          </section>
          <section className="tr-card" aria-labelledby="tr-projection-title">
            <div className="tr-projection-head"><Icon name="calculateOutlined" size={22} className="tf-primary-icon" /><h2 className="t-headline-sm" id="tr-projection-title">Proyección estimada</h2></div>
            <div className="tr-projection-grid">
              <div className="tr-projection-card"><div className="tr-projection-top"><span className="t-body-md-medium tf-ellipsis" title={source?.name}>{source?.name ?? 'Cuenta de origen'}</span><span className="chip chip-error t-label-caps">Cargo</span></div>
                <p className="t-code-data tf-muted tr-formula">{source ? <><span data-amount>{mxn(source.availableBalanceMinor).replace(/ MXN$/, '')}</span> − <span className="tr-error-text" data-amount>{mxn(body.amountMinor).replace(/ MXN$/, '')}</span></> : '—'}</p>
                <div className="tr-new-balance"><span className="t-body-sm-medium tf-muted">Nuevo saldo:</span>{projection && !projection.exceeds ? <Amount minor={projection.projected.toString()} className="t-headline-sm" suffixClassName="t-body-sm tf-amount-suffix" /> : <span className="t-body-sm">{projection?.exceeds ? 'El importe supera el saldo disponible actual' : '—'}</span>}</div></div>
              <div className="tr-projection-card"><div className="tr-projection-top"><span className="t-body-md-medium tf-ellipsis" title={destinationAccount?.name}>{destinationAccount?.name ?? 'Cuenta propia'}</span><span className="chip chip-success t-label-caps">Abono</span></div>
                <p className="t-code-data tf-muted tr-formula">{destinationAccount ? <><span data-amount>{mxn(destinationAccount.availableBalanceMinor).replace(/ MXN$/, '')}</span> + <span className="tr-success-text" data-amount>{mxn(body.amountMinor).replace(/ MXN$/, '')}</span></> : '—'}</p>
                <div className="tr-new-balance"><span className="t-body-sm-medium tf-muted">Nuevo saldo:</span>{destinationProjected ? <Amount minor={destinationProjected} className="t-headline-sm tr-success-strong" suffixClassName="t-body-sm tf-amount-suffix" /> : <span>—</span>}</div></div>
            </div>
          </section>
        </div>
        <aside className="tr-col-side" aria-labelledby="tr-summary-title">
          <div className="tr-card tr-summary">
            <h2 className="t-headline-md" id="tr-summary-title">Resumen</h2>
            <dl className="tr-summary-list t-body-sm">
              <div><dt className="tf-muted">Titular:</dt><dd className="t-body-sm-medium tf-ellipsis" title={holder}>{holder}</dd></div>
              <div><dt className="tf-muted">Tipo de traspaso:</dt><dd className="t-body-sm-medium">Entre cuentas propias</dd></div>
              <div className="tr-summary-total"><dt className="t-body-md-medium">Total a debitar:</dt><dd className="t-headline-sm tf-primary-text" data-amount>{mxn(body.amountMinor)}</dd></div>
            </dl>
            {codeText && <p className="t-body-sm tr-code-note"><Icon name="lockOutlined" size={16} /><span>{codeText}</span></p>}
            {neutral}
            <div className="tr-side-actions"><span className="only-wide">{cta('btn-block', 'send')}</span>{modify('btn-secondary btn-block')}</div>
          </div>
        </aside>
      </div>
      <div className="only-compact"><ActionBar>{cta('btn-block', 'send')}</ActionBar></div>
    </div>;
  }

  const card = (withFooter: boolean, withBanner: boolean) => <section className="tr-card tr-main-card" aria-labelledby="tr-amount-label">
    {withBanner && <div className="tr-banner"><span className="tr-banner-tile"><Icon name="infoOutlined" size={20} /></span><div><h2 className="t-body-md-medium">Revisa los datos antes de enviar</h2><p className="t-body-sm tf-muted">Verifica los detalles antes de continuar. La operación aún no ha sido enviada ni debitada.</p>{neutral}</div></div>}
    <div className="tr-amount-block">
      <div><span className="t-label-caps tf-muted" id="tr-amount-label">Monto a transferir</span><Amount minor={body.amountMinor} className="t-display-currency tr-amount" suffixClassName="t-body-lg tr-amount-suffix" /></div>
      <span className="chip chip-neutral chip-dot tr-kind-chip t-body-sm-medium"><span className="chip-dot-mark" aria-hidden="true" />Transferencia interna</span>
    </div>
    <div className="tr-divider" />
    <div className="tr-details">
      <div className="tr-parties">
        <div className="tr-party"><div className="tr-party-head"><span className="t-label-caps tf-muted">Cuenta de origen</span><Icon name="bank" size={18} className="tf-muted" /></div>
          <p className="tr-party-name"><span className="t-body-md-medium tf-ellipsis" title={source?.name}>{source?.name ?? 'Cuenta de origen'}</span><span className="t-code-data tf-muted" data-clabe>(•• {tailOf(source?.clabeMasked)})</span></p>
          <p className="t-body-sm tf-muted">Saldo actual: {source ? <span className="t-body-sm-medium tr-strong" data-amount>{mxn(source.availableBalanceMinor)}</span> : '—'}</p></div>
        <div className="tr-party"><div className="tr-party-head"><span className="t-label-caps tf-muted">Destinatario</span><Icon name="howToReg" size={18} className="tf-primary-icon" /></div>
          <p className="tr-party-name"><span className="t-body-md-medium tf-ellipsis" title={beneficiary?.name}>{beneficiary?.name ?? 'Beneficiario'}</span>{beneficiary && <span className="chip tr-alias-chip t-body-sm-medium" title={beneficiary.alias}>{beneficiary.alias}</span>}</p>
          <p className="t-body-sm tf-muted">Billetera MXN <span className="t-code-data" data-clabe>(•• {tailOf(beneficiary?.clabeMasked)})</span></p></div>
      </div>
      <dl className="tr-meta">
        <div><dt className="t-label-caps tf-muted">Concepto del envío</dt><dd><Icon name="notes" size={18} className="tf-muted" /><span className="t-body-md-medium tr-concept">{body.concept}</span></dd></div>
        <div><dt className="t-label-caps tf-muted">Número de referencia</dt><dd><Icon name="tag" size={18} className="tf-muted" /><span className="t-code-data tr-reference">{body.reference}</span></dd></div>
      </dl>
      <div className="tr-estimate">
        <div className="tr-estimate-head"><span className="tr-estimate-title"><Icon name="calculateOutlined" size={18} className="tf-muted" /><span className="t-body-sm-medium">Saldo estimado post-operación</span></span><span className="t-body-sm tf-muted">Desglose contable</span></div>
        {projection && !projection.exceeds
          ? <div className="tr-estimate-row"><p className="t-code-data tf-muted tr-formula"><span data-amount>{mxn(projection.available.toString()).replace(/ MXN$/, '')}</span> − <span className="tr-error-text" data-amount>{mxn(body.amountMinor).replace(/ MXN$/, '')}</span> =</p><Amount minor={projection.projected.toString()} className="t-headline-md tr-estimate-value" suffixClassName="t-body-sm tf-amount-suffix" /></div>
          : <p className="t-body-sm-medium tr-exceeds">{projection?.exceeds ? 'El importe supera el saldo disponible actual' : '—'}</p>}
        {projection && !projection.exceeds && <div className="tf-bar" aria-hidden="true"><span style={{ width: projection.width }} /></div>}
      </div>
    </div>
    {withFooter && <div className="tr-footer">{modify('btn-outline tr-modify')}<span className="only-wide">{cta('tr-confirm')}</span></div>}
  </section>;

  const header = <>
    <div className="tr-crumbs"><p className="tf-breadcrumb t-body-sm"><span>Transferir</span><Icon name="chevronRight" size={14} /><span className="t-body-sm-medium tf-crumb-current">Paso 2 de 2: Revisión</span></p>{!code && <span className="tr-steps" aria-hidden="true"><span /><span /></span>}</div>
    <div className="tr-title">
      <p className="tr-eyebrow t-label-caps"><span className="tr-eyebrow-dot" aria-hidden="true" />Confirmación requerida</p>
      <h1 className="t-headline-lg" tabIndex={-1}>Revisa y confirma tu transferencia</h1>
      <p className="t-body-md tf-muted">Verifica los detalles antes de procesar el envío. El dinero aún no ha sido debitado.</p>
    </div>
  </>;

  if (code) {
    return <div className="tr-page tr-page-code">
      {header}
      <span className="tr-steps tr-steps-wide" aria-hidden="true"><span /><span /></span>
      {error && <Notice>{error}</Notice>}
      <div className="tr-standalone-banner"><span className="tr-banner-tile tr-banner-tile-solid"><Icon name="infoOutlined" size={20} /></span><div><h2 className="t-body-md-medium">Revisa los datos antes de enviar</h2><p className="t-body-md tf-muted">Verifica los detalles antes de continuar. La operación aún no ha sido enviada ni debitada.</p></div></div>
      <div className="tr-grid">
        <div className="tr-col-main">{card(false, false)}</div>
        <aside className="tr-col-side" aria-labelledby="tr-code-title">
          <div className="tr-card tr-code-card">
            <h2 className="t-headline-sm tr-code-title" id="tr-code-title"><Icon name="lockOutlined" size={20} className="tr-tertiary-icon" /><span>Se requiere código de confirmación</span></h2>
            <p className="t-body-sm tf-muted">{codeText}</p>
            <div className="tr-side-actions"><span className="only-wide">{cta('btn-block')}</span>{modify('btn-secondary btn-block')}</div>
          </div>
        </aside>
      </div>
      <div className="only-compact"><ActionBar>{cta('btn-block')}</ActionBar></div>
    </div>;
  }
  return <div className="tr-page">
    {header}
    {error && <Notice>{error}</Notice>}
    {card(true, true)}
    <div className="only-compact"><ActionBar>{cta('btn-block')}</ActionBar></div>
  </div>;
}

/** W13 · references `w13_saldo_insuficiente` and `w13_l_mite_diario`. Only after a server-confirmed rejection. */
function RejectionView({ rejection, onModify }: { rejection: W13Rejection; onModify: () => void }) {
  const { kind, amountMinor, sourceAccount, policy } = rejection;
  const actions = <div className="rj-actions">
    <button type="button" className="btn btn-primary rj-modify" onClick={onModify}><Icon name="edit" size={18} /><span>Modificar monto</span></button>
    <Link className={`btn btn-secondary ${kind === 'insufficient_balance' ? 'rj-home-even' : 'rj-home'}`} to="/accounts">{kind === 'insufficient_balance' && <Icon name="arrowBack" size={18} />}<span>Volver al inicio</span></Link>
  </div>;
  if (kind === 'insufficient_balance') {
    const available = sourceAccount?.availableBalanceMinor;
    const missing = shortfall(amountMinor, available);
    return <div className="rj-page">
      <header className="rj-header rj-header-center">
        <span className="rj-icon"><Icon name="walletOutlined" size={28} /></span>
        <h1 className="t-headline-lg" tabIndex={-1}>Transferencia rechazada: Saldo insuficiente</h1>
        <p className="t-body-md tf-muted">El monto solicitado supera los fondos disponibles en tu cuenta.</p>
      </header>
      <section className="rj-card" aria-label="Detalle del rechazo">
        <div className="rj-alert" role="alert"><Icon name="error" size={20} className="rj-alert-icon" /><div><p className="t-body-md-medium">Fondos preservados</p><p className="t-body-sm tf-muted">No se realizó ningún cargo por este intento. Tu saldo permanece intacto.</p></div></div>
        <dl className="rj-breakdown">
          <div className="rj-breakdown-head"><dt className="t-label-caps tf-muted">Desglose de operación</dt><dd className="t-code-data tf-muted">MXN</dd></div>
          <div className="rj-row"><dt className="t-body-md tf-muted"><Icon name="arrowOutward" size={18} />Monto solicitado</dt><dd><Amount minor={amountMinor} className="t-headline-sm rj-value" suffixClassName="rj-suffix" /></dd></div>
          {available !== undefined
            ? <div className="rj-row"><dt className="t-body-md tf-muted"><Icon name="bank" size={18} />Saldo disponible en cuenta</dt><dd><Amount minor={available} className="t-headline-sm rj-value" suffixClassName="rj-suffix" /></dd></div>
            : <div className="rj-row"><dt className="t-body-md tf-muted"><Icon name="bank" size={18} />Saldo disponible en cuenta</dt><dd className="t-body-sm tf-muted">No pudimos consultarlo ahora</dd></div>}
          {missing !== null && <div className="rj-row rj-row-missing"><dt className="t-body-md-medium"><Icon name="trendingDown" size={18} />Faltante para completar</dt><dd className="t-headline-sm rj-value" data-amount>Faltan {mxn(missing.toString()).replace(/ MXN$/, '')}<span className="rj-suffix"> MXN</span></dd></div>}
          {available !== undefined && <div className="rj-row rj-row-final"><dt className="t-body-md-medium"><Icon name="checkCircleOutlined" size={18} className="rj-ok-icon" />Saldo final de la cuenta<span className="chip chip-success t-label-caps rj-intact">Intacto</span></dt><dd><Amount minor={available} className="t-headline-md rj-value" suffixClassName="rj-suffix" /></dd></div>}
        </dl>
        {actions}
      </section>
    </div>;
  }
  const limitRows = policy !== undefined;
  return <div className="rj-page">
    <header className="rj-header">
      <span className="chip rj-chip t-label-caps"><Icon name="doNotDisturbOnOutlined" size={16} />Operación no procesada</span>
      <h1 className="t-headline-lg" tabIndex={-1}>Transferencia rechazada: Límite diario alcanzado</h1>
      <p className="t-body-md tf-muted">El monto solicitado excede el disponible diario de transferencias.</p>
    </header>
    <section className="rj-card" aria-label="Detalle del rechazo">
      <div className="rj-alert rj-alert-neutral" role="alert"><Icon name="schedule" size={22} className="rj-tertiary-icon" /><p className="t-body-md-medium">Rechazo confirmado: No se realizó ningún cargo por este intento.</p></div>
      <div className="rj-limits">
        <p className="t-label-caps tf-muted" id="rj-limits-title">Desglose de límites y montos</p>
        <dl className="rj-limits-panel" aria-labelledby="rj-limits-title">
          {limitRows && <>
            <div className="rj-line"><dt className="t-body-md tf-muted">Límite diario configurado{demoSuffix(policy)}</dt><dd className="t-code-data rj-medium" data-amount>{mxn(policy.dailyLimitMinor)}</dd></div>
            <div className="rj-limit-bar" aria-hidden="true"><span className="rj-used" style={{ width: barWidth(BigInt(policy.dailyUsedMinor), BigInt(policy.dailyLimitMinor)) }} /><span className="rj-left" style={{ width: barWidth(BigInt(policy.dailyRemainingMinor), BigInt(policy.dailyLimitMinor)) }} /></div>
            <div className="rj-line"><dt className="t-body-md tf-muted"><span className="rj-dot rj-dot-used" aria-hidden="true" />Monto acumulado enviado hoy</dt><dd className="t-code-data rj-medium" data-amount>{mxn(policy.dailyUsedMinor)}</dd></div>
            <div className="rj-line"><dt className="t-body-md tf-muted"><span className="rj-dot rj-dot-left" aria-hidden="true" />Disponible restante hoy</dt><dd className="t-code-data rj-remaining" data-amount>{mxn(policy.dailyRemainingMinor)}</dd></div>
            <div className="rj-separator" aria-hidden="true" />
          </>}
          <div className="rj-line"><dt className="t-body-md">Monto solicitado en esta operación</dt><dd className="t-code-data rj-requested" data-amount>{mxn(amountMinor)}</dd></div>
          <div className="rj-line rj-charge"><dt className="t-body-md-medium">Cargo aplicado</dt><dd><span className="t-code-data rj-charge-value" data-amount>{mxn('0')}</span><span className="t-body-sm tf-muted"> (sin débito)</span></dd></div>
        </dl>
      </div>
      <p className="rj-info t-body-sm"><Icon name="infoOutlined" size={20} className="tf-primary-icon" /><span>{limitRows ? `La operación no pudo completarse porque supera el disponible diario de ${mxn(policy.dailyRemainingMinor)}. Tu límite se restablece al iniciar el siguiente día de negocio (${policy.businessTimeZone}).` : 'La operación supera el disponible diario de transferencias. Tu límite se restablece al iniciar el siguiente día de negocio.'}</span></p>
      {actions}
    </section>
  </div>;
}

/** Navigation state for W13 «Modificar monto» after a rejection in confirm (the record was already cleared). */
function prefillFrom(transfer: Transfer): TransferPrefill {
  const own = !('alias' in transfer.destination);
  return {
    destinationType: own ? 'own_account' : 'beneficiary', sourceAccountId: transfer.sourceAccountId,
    ...(own ? { destinationAccountId: transfer.destination.id } : { beneficiaryId: transfer.destination.id }),
    amount: minorToInput(transfer.amountMinor), concept: transfer.concept, reference: transfer.reference,
  };
}

export function TransferStatusPage() {
  const { session, hydrated } = useSession(); const { transferId = '' } = useParams(); const location = useLocation(); const navigate = useNavigate();
  const queryClient = useQueryClient();
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: () => request<{ items: Account[] }>('/accounts'), enabled: Boolean(session) });
  const initial = (location.state as { transfer?: Transfer } | null)?.transfer;
  const status = useQuery({
    queryKey: ['transfer', transferId],
    queryFn: async () => {
      const fresh = await request<Transfer>(`/transfers/${transferId}`);
      const previous = initial ?? queryClient.getQueryData<Transfer>(['transfer', transferId]);
      return mergeTransferDemoCode(fresh, previous);
    },
    enabled: Boolean(transferId), initialData: initial,
    refetchInterval: (query) => query.state.data?.status === 'processing' ? 1500 : false,
  });
  const policy = useTransferPolicy();
  const [code, setCode] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false); const [rejection, setRejection] = useState<W13Rejection | null>(null);
  const [failure, setFailure] = useState<CodeFailure>(null);
  const [selectCode, setSelectCode] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const otpInput = useRef<HTMLInputElement>(null);
  const expiryChecked = useRef('');
  const previousStatus = useRef<Transfer['status'] | undefined>(undefined);
  const submitLock = useRef(false);
  useEffect(() => {
    if (session && (status.data?.status === 'completed' || status.data?.status === 'rejected')) clearTransferDraft(session.user.id);
  }, [session, status.data]);
  const current = status.data;
  const awaiting = current?.status === 'awaiting_confirmation';
  const seconds = awaiting ? secondsLeft(current?.expiresAt, now) : null;
  // W10-V1 countdown from the server's `expiresAt` (display only).
  useEffect(() => {
    if (!awaiting || !current?.expiresAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [awaiting, current?.expiresAt]);
  // W10-F2: at 00:00 the attempt is read once (GET); only a server `expired` shows V9.
  useEffect(() => {
    if (seconds !== 0 || !current || busy || expiryChecked.current === current.id) return;
    expiryChecked.current = current.id;
    void status.refetch();
  }, [seconds, current, busy, status]);
  // W12-V5: when the attempt turns completed in this view, balances are read again (GET only).
  useEffect(() => {
    const previous = previousStatus.current;
    previousStatus.current = current?.status;
    if (previous && previous !== 'completed' && current?.status === 'completed') void queryClient.invalidateQueries({ queryKey: ['accounts'] });
  }, [current?.status, queryClient]);
  // W10-V8: after «Código incorrecto» the focus returns to the input with its text selected.
  useEffect(() => {
    if (!selectCode) return;
    otpInput.current?.focus(); otpInput.current?.select(); setSelectCode(false);
  });
  if (!hydrated) return <AppShell active="transfers"><StatePanel tone="loading" title="Cargando tu sesión">Verificando acceso.</StatePanel></AppShell>;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  const currentUserId = session.user.id;
  const accountItems = accounts.data?.items ?? [];
  const retry = readTransferDraft(currentUserId);
  if (!status.data && status.isPending) return <AppShell active="transfers"><StatePanel tone="loading" title="Consultando transferencia">Recuperando el estado real del intento.</StatePanel></AppShell>;
  // D-11: 403/404 for a transfer id → W14 access card. Presentation only: no request and no change to the record.
  if (!status.data && status.error instanceof ApiError && [403, 404].includes(status.error.problem.status)) return <AccessUnavailable />;
  if (!status.data && status.error) {
    // W11-V3 (GET variant): the button reads this same attempt again; nothing is resent.
    const panel = retry?.transferId === transferId ? panelFromBody(retry.body, accountItems, []) : { destinationName: 'Beneficiario Billetera', destinationTail: '', sourceName: 'Cuenta de origen', sourceTail: '', amountMinor: null, concept: '', reference: '' };
    return <AppShell active="transfers"><VerifyView mode={status.isFetching ? 'verifying' : 'unknown'} action="query" cause={status.error instanceof ApiError ? 'answer' : 'interrupted'} panel={panel} onAction={() => void status.refetch()} /></AppShell>;
  }
  const transfer = status.data;
  if (!transfer) return null;
  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (submitLock.current) return; submitLock.current = true; setBusy(true); setNotice(''); const parsed = transferConfirmRequestSchema.safeParse({ code });
    if (!parsed.success) { setNotice('Ingresa el código de 6 dígitos recibido.'); submitLock.current = false; setBusy(false); return; }
    const previous = confirmationAttempts.get(transferId);
    const attempt = previous?.code === code ? previous : { code, key: createKey() };
    confirmationAttempts.set(transferId, attempt);
    try { const result = await requestTransfer<Transfer>(`/transfers/${transferId}/confirm`, attempt.key, { method: 'POST', body: JSON.stringify(parsed.data) }); confirmationAttempts.delete(transferId); statusClientUpdate(result); }
    catch (cause) {
      // W10-F1 (DEP-2): status + literal detail. Balance/limit keep the previous W13 rule and record handling.
      const kind = classifyConfirmFailure(cause instanceof ApiError ? cause.problem : null);
      if (kind === 'insufficient_balance' || kind === 'daily_limit') {
        clearTransferDraft(currentUserId); confirmationAttempts.delete(transferId);
        // W13-V2/V4 (F-W13-3): balance and limits read after the rejection (GET only).
        const [refreshed, freshPolicy] = await Promise.all([accounts.refetch(), policy.refetch()]);
        const accountsNow = refreshed.status === 'success' ? refreshed.data.items : undefined;
        setRejection({ kind, amountMinor: transfer.amountMinor, sourceAccount: accountsNow?.find((account) => account.id === transfer.sourceAccountId), policy: freshPolicy.status === 'success' ? freshPolicy.data : undefined });
      } else if (kind === 'wrong_code') { setFailure('wrong_code'); setSelectCode(true); }
      else if (kind === 'attempts_exhausted') { setFailure('attempts_exhausted'); void accounts.refetch(); }
      else if (kind === 'expired' || kind === 'conflict') {
        // Read-only GET: the server's state decides (completed → W12, expired or cancelled → V9).
        const fresh = await status.refetch();
        if (!fresh.data || fresh.data.status === 'awaiting_confirmation') setNotice(kind === 'expired' ? 'El código expiró. No pudimos confirmar todavía el estado del intento.' : errorText(cause));
      } else setNotice('No se confirmó la respuesta. Puedes reintentar el mismo código.');
    }
    finally { submitLock.current = false; setBusy(false); }
  }
  function statusClientUpdate(next: Transfer) { queryClient.setQueryData(['transfer', next.id], next); navigate(`/transfers/${next.id}/status`, { replace: true, state: { transfer: next } }); }
  async function retryCreate() {
    if (!retry) { void status.refetch(); return; }
    setBusy(true); setNotice('');
    try { const result = await requestTransfer<Transfer>('/transfers', retry.key, { method: 'POST', body: JSON.stringify(retry.body) }); saveTransferDraft(currentUserId, { ...retry, transferId: result.id }); void status.refetch(); }
    catch (cause) { setNotice(errorText(cause)); }
    finally { setBusy(false); }
  }
  if (rejection) return <AppShell active="transfers"><RejectionView rejection={rejection} onModify={() => navigate('/transfers/new', { state: { prefill: prefillFrom(transfer) } })} /></AppShell>;
  const refreshFailed = status.error ? 'No pudimos actualizar el estado. El intento sigue disponible para consulta.' : '';
  if (transfer.status === 'awaiting_confirmation' || transfer.status === 'expired' || transfer.status === 'cancelled') {
    return <AppShell active="transfers"><CodeView transfer={transfer} accounts={accountItems} policy={policy.data} code={code} busy={busy} failure={failure} notice={notice || refreshFailed || undefined}
      onCode={(value) => { setCode(sanitizeCode(value)); if (failure === 'wrong_code') setFailure(null); }} seconds={seconds}
      terminal={transfer.status === 'expired' ? 'expired' : transfer.status === 'cancelled' ? 'cancelled' : null} inputRef={otpInput} onSubmit={(event) => void confirm(event)} /></AppShell>;
  }
  if (transfer.status === 'completed') {
    return <AppShell active="transfers"><ReceiptView transfer={transfer} accounts={accountItems} policy={policy.data} notice={refreshFailed ? <Notice tone="info">{refreshFailed}</Notice> : undefined} /></AppShell>;
  }
  if (transfer.status === 'processing') {
    // Unreachable against 0.3.0 (A-10). Same actions as before: read the attempt, or resend the same record with its key.
    const action = retry ? 'resend' as const : 'query' as const;
    return <AppShell active="transfers"><VerifyView mode={busy ? 'verifying' : 'unknown'} action={action} cause="answer" panel={panelFromTransfer(transfer, accountItems)} notice={notice || refreshFailed || undefined}
      onAction={() => void (retry ? retryCreate() : status.refetch())} /></AppShell>;
  }
  return <AppShell active="transfers"><StatePanel title="Transferencia rechazada">El intento fue rechazado. No se realizó ningún débito.</StatePanel></AppShell>;
}
