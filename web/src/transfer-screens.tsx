// WF-T5 presentational views: W10 código de confirmación (`w10_c_digo_completo` structure and its state family),
// W11 enviando / verificando resultado / resultado desconocido (`w11_enviando`, `w11_verificando_resultado`) and W12
// comprobante (the two approved W12 references: beneficiary and own accounts). They render what the pages
// already hold: no requests, no storage, no idempotency keys or ids on screen.
import { useState, type FormEvent, type ReactNode, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import { formatMxnFromMinor, type ProductComponents } from '@fintech-wallet/shared';
import type { Account } from './api.js';
import { ActionBar, clabeTail } from './components.js';
import { longDateTime, shortDateTime } from './format.js';
import { Amount, sumAvailableBalanceMinor } from './home.js';
import { Icon } from './icons.js';
import type { TransferPolicy } from './policy.js';
import { VERIFY_COPY, countdownLabel, countdownUrgent, folioOf, incompleteLabel, signedChip, type VerifyAction } from './transfer-outcome.js';

export type Transfer = ProductComponents['schemas']['Transfer'];
type Beneficiary = ProductComponents['schemas']['Beneficiary'];

const mxn = (minor: string) => formatMxnFromMinor(minor);
const tailText = (clabeMasked: string | undefined) => clabeTail(clabeMasked) || '••••';

/** Data panel shared by W11 (from the same-tab record or a transfer): names resolved by id, never keys or ids. */
export type AttemptPanel = { destinationName: string; destinationTail: string; sourceName: string; sourceTail: string; amountMinor: string | null; concept: string; reference: string };

/** W11-F2: resolves the record's ids against `GET /accounts` and `GET /beneficiaries`; unknown → generic names. */
export function panelFromBody(body: Readonly<Record<string, string | undefined>>, accounts: readonly Account[], beneficiaries: readonly Beneficiary[]): AttemptPanel {
  const own = body.destinationType === 'own_account';
  const source = accounts.find((account) => account.id === body.sourceAccountId);
  const beneficiary = own ? undefined : beneficiaries.find((item) => item.id === body.beneficiaryId);
  const destinationAccount = own ? accounts.find((account) => account.id === body.destinationAccountId) : undefined;
  return {
    destinationName: own ? destinationAccount?.name ?? 'Cuenta propia' : beneficiary?.name ?? 'Beneficiario Billetera',
    destinationTail: clabeTail(own ? destinationAccount?.clabeMasked : beneficiary?.clabeMasked),
    sourceName: source?.name ?? 'Cuenta de origen',
    sourceTail: clabeTail(source?.clabeMasked),
    amountMinor: body.amountMinor && /^[1-9][0-9]*$/.test(body.amountMinor) ? body.amountMinor : null,
    concept: body.concept ?? '',
    reference: body.reference ?? '',
  };
}

export function panelFromTransfer(transfer: Transfer, accounts: readonly Account[]): AttemptPanel {
  const source = accounts.find((account) => account.id === transfer.sourceAccountId);
  return {
    destinationName: transfer.destination.name, destinationTail: clabeTail(transfer.destination.clabeMasked),
    sourceName: source?.name ?? 'Cuenta de origen', sourceTail: clabeTail(source?.clabeMasked),
    amountMinor: transfer.amountMinor, concept: transfer.concept, reference: transfer.reference,
  };
}

function SpinnerRing({ className }: { className: string }) {
  return <svg className={className} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
    <circle className="ring-track" cx="32" cy="32" r="26" fill="none" strokeWidth="3" />
    <circle className="ring-arc" cx="32" cy="32" r="26" fill="none" strokeWidth="3" strokeDasharray="163" strokeDashoffset="60" strokeLinecap="round" />
  </svg>;
}

// ───────────────────────────── W11-V1 · Enviando ─────────────────────────────
export function SendingView({ panel }: { panel: AttemptPanel }) {
  return <div className="sd-page">
    <header className="sd-header">
      <span className="sd-chip t-label-caps"><span className="sd-chip-dot" aria-hidden="true" />Enviando</span>
      <h1 className="t-headline-lg" tabIndex={-1}>Enviando transferencia</h1>
      <p className="t-body-md tf-muted">Por favor no cierres ni recargues esta ventana mientras se procesa la solicitud.</p>
    </header>
    <section className="sd-card" aria-label="Datos del envío">
      <div className="sd-hero">
        <span className="sd-ring"><SpinnerRing className="sd-ring-svg spin" /><Icon name="swap" size={24} /></span>
        <div className="sd-amount"><span className="t-label-caps tf-muted">Monto a transferir</span>
          {panel.amountMinor ? <Amount minor={panel.amountMinor} className="t-display-currency sd-amount-value" suffixClassName="t-body-md-medium tf-muted sd-amount-suffix" /> : <span className="t-display-currency">—</span>}</div>
      </div>
      <dl className="sd-panel">
        <div><dt className="t-body-sm tf-muted">Destinatario</dt><dd><span className="t-body-md-medium sd-ellipsis" title={panel.destinationName}>{panel.destinationName}</span>{panel.destinationTail && <span className="sd-tail t-code-data" data-clabe>•• {panel.destinationTail}</span>}</dd></div>
        <div><dt className="t-body-sm tf-muted">Cuenta de origen</dt><dd><span className="t-body-md-medium sd-ellipsis" title={panel.sourceName}>{panel.sourceName}</span>{panel.sourceTail && <span className="sd-tail t-code-data" data-clabe>•• {panel.sourceTail}</span>}</dd></div>
        <div><dt className="t-body-sm tf-muted">Concepto</dt><dd><span className="t-body-md-medium sd-ellipsis" title={panel.concept}>{panel.concept || '—'}</span></dd></div>
        <div><dt className="t-body-sm tf-muted">Referencia</dt><dd><span className="t-code-data">{panel.reference || '—'}</span></dd></div>
      </dl>
      {/* UX-T0: a role=status child removes the button's accessible name in Chromium; the live region sits beside it. */}
      <button type="button" className="btn btn-block sd-busy" disabled><Icon name="spinner" size={16} className="spin" /><span>Enviando transferencia…</span></button>
      <p className="sr-only" id="sd-progress" role="status">Enviando transferencia…</p>
    </section>
  </div>;
}

// ───────────────────────── W11-V2 / V3 · Verificando / Resultado desconocido ─────────────────────────
export type VerifyCause = 'pending' | 'interrupted' | 'answer';

export function VerifyView({ mode, action, cause, panel, notice, onAction }: {
  mode: 'verifying' | 'unknown'; action: VerifyAction; cause: VerifyCause; panel: AttemptPanel; notice?: string; onAction?: () => void;
}) {
  const copy = VERIFY_COPY[action];
  const verifying = mode === 'verifying';
  const title = verifying ? 'Estamos verificando si tu transferencia se completó' : 'No pudimos confirmar el resultado';
  const text = verifying
    ? cause === 'pending' ? 'Hay un envío de esta pestaña sin resultado confirmado. Estamos consultando el resultado de tu operación.' : 'Ocurrió una interrupción momentánea de conexión. Estamos consultando el resultado de tu operación.'
    : cause === 'answer' ? 'Recibimos una respuesta que no confirma el resultado. No envíes una transferencia nueva: verifica este mismo intento.' : 'La conexión se interrumpió antes de recibir respuesta. No envíes una transferencia nueva: verifica este mismo intento.';
  return <div className="vr-page">
    <section className={`vr-card${verifying ? '' : ' is-unknown'}`} aria-labelledby="vr-title">
      <span className="vr-chip t-label-caps"><span className="vr-chip-dot" aria-hidden="true" />{verifying ? 'Verificando resultado' : 'Resultado desconocido'}</span>
      <div className="vr-hero">
        <span className="vr-icon">{verifying ? <><SpinnerRing className="vr-ring spin" /><Icon name="sync" size={32} /></> : <Icon name="syncProblem" size={32} />}</span>
        <div className="vr-heading">
          <h1 className="t-headline-md" id="vr-title" tabIndex={-1}>{title}</h1>
          <p className="t-body-md tf-muted" id="vr-text" role={verifying ? 'status' : undefined}>{text}</p>
        </div>
      </div>
      <dl className="vr-panel">
        <div><dt className="t-body-md tf-muted">Destinatario</dt><dd className="t-body-md-medium vr-value" title={panel.destinationName}>{panel.destinationName}{panel.destinationTail && <span data-clabe> (terminación {panel.destinationTail})</span>}</dd></div>
        <div><dt className="t-body-md tf-muted">Cuenta de origen</dt><dd className="t-body-md-medium vr-value" title={panel.sourceName}>{panel.sourceName}{panel.sourceTail && <span data-clabe> (•• {panel.sourceTail})</span>}</dd></div>
        <div><dt className="t-body-md tf-muted">Monto</dt><dd className="t-headline-sm vr-amount" data-amount>{panel.amountMinor ? mxn(panel.amountMinor) : '—'}</dd></div>
        <div><dt className="t-body-md tf-muted">Referencia</dt><dd className="t-code-data vr-reference">{panel.reference || '—'}</dd></div>
      </dl>
      <p className="vr-note t-body-sm"><Icon name="shieldOutlined" size={20} /><span>{verifying ? copy.busyNote : copy.note}</span></p>
      {notice && <p className="vr-notice t-body-sm" role="alert"><Icon name="infoOutlined" size={18} /><span>{notice}</span></p>}
      <div className="vr-actions">
        {verifying
          ? <button type="button" className="btn btn-primary btn-block vr-button" disabled aria-describedby="vr-text"><Icon name="spinner" size={20} className="spin" /><span>{action === 'resend' ? copy.busy : 'Consultando…'}</span></button>
          : <button type="button" className="btn btn-primary btn-block vr-button" onClick={onAction}><Icon name="restart" size={20} /><span>{copy.button}</span></button>}
        <Link className="vr-home t-body-sm" to="/accounts">Volver al Inicio <span className="vr-home-note">(conservarás un aviso visible para retomar la verificación)</span></Link>
      </div>
    </section>
  </div>;
}

// ───────────────────────────── W10 · Código de confirmación ─────────────────────────────
export type CodeFailure = 'wrong_code' | 'attempts_exhausted' | null;

export function CodeView({ transfer, accounts, policy, code, onCode, busy, failure, notice, seconds, terminal, inputRef, onSubmit }: {
  transfer: Transfer; accounts: readonly Account[]; policy?: TransferPolicy; code: string; onCode: (value: string) => void; busy: boolean;
  failure: CodeFailure; notice?: string; seconds: number | null; terminal: 'expired' | 'cancelled' | null;
  inputRef: RefObject<HTMLInputElement | null>; onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const [focused, setFocused] = useState(false);
  const source = accounts.find((account) => account.id === transfer.sourceAccountId);
  const destinationTail = tailText(transfer.destination.clabeMasked);
  const exhausted = failure === 'attempts_exhausted';
  const wrong = failure === 'wrong_code';
  const locked = exhausted || terminal !== null;
  const complete = code.length === 6;
  const timeZone = policy?.businessTimeZone;
  const shownSeconds = terminal === 'expired' ? 0 : seconds;
  const urgent = shownSeconds !== null && countdownUrgent(shownSeconds);
  const reasonId = 'cf-length';
  // D-UX-8: one line under the boxes carries both the length hint and the reason the button is disabled.
  const reason = busy || locked ? null : !complete ? (code.length > 0 ? `${incompleteLabel(code.length)}. Al completar los 6 dígitos se habilitará la autorización.` : 'Al completar los 6 dígitos se habilitará la autorización.') : null;
  const disabled = busy || locked || !complete;
  const buttonLabel = complete && !locked ? `Autorizar transferencia de ${mxn(transfer.amountMinor)}` : 'Autorizar transferencia';
  // D-UX-8: a single indicator of the code state.
  const chip = locked ? exhausted
      ? <span className="cf-locked t-body-sm-medium"><Icon name="lockOutlined" size={16} />Bloqueado</span>
      : <span className="chip chip-error t-label-caps cf-state-chip">{terminal === 'expired' ? 'Código expirado' : 'Intento cancelado'}</span>
    : wrong ? <span className="chip chip-error t-label-caps cf-state-chip">Código incorrecto</span>
      : complete ? <span className="chip chip-success t-label-caps cf-state-chip">Código completo</span>
        : <span className="chip chip-neutral t-label-caps cf-state-chip">{code.length}/6 dígitos</span>;
  // The timer itself is not a live region; this status announces only two moments (A11Y-09).
  const timerAnnouncement = terminal === 'expired' || shownSeconds === 0 ? 'El código expiró.' : urgent ? 'Queda menos de un minuto.' : '';
  const header = (titleTag: 'h1' | 'h2') => {
    const Title = titleTag;
    return <div className="cf-head">
      <div className="cf-head-main">
        <span className="cf-tile"><Icon name="lockClockOutlined" size={28} /></span>
        <div className="cf-head-text">
          <Title className="t-headline-md cf-title" id="cf-title" tabIndex={-1}>Código de confirmación</Title>
          {transfer.demoOnlyCode && <span className="chip chip-neutral cf-demo-chip">Demo</span>}
        </div>
      </div>
      {shownSeconds !== null && !exhausted && <div className="cf-timer"><span className="t-label-caps tf-muted">Expira en</span>
        <span className={`cf-timer-chip t-code-data${urgent ? ' is-urgent' : ''}`}><Icon name="timer" size={16} /><span role="timer" aria-label={`Expira en ${countdownLabel(shownSeconds)} minutos`}>{countdownLabel(shownSeconds)} min</span></span>
        <span className="sr-only" role="status">{timerAnnouncement}</span></div>}
    </div>;
  };
  const boxes = <div className={`cf-boxes${wrong ? ' is-wrong' : ''}${locked ? ' is-locked' : ''}`}>
    <input ref={inputRef} id="cf-otp" className="cf-otp-input" value={code} onChange={(event) => onCode(event.target.value)}
      // UX-T0: maxLength would cut a pasted «13-57 92» before sanitising; keep only its digits (first six).
      onPaste={(event) => { const digits = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6); if (digits && !busy && !locked) { event.preventDefault(); onCode(digits); } }}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required readOnly={busy} disabled={locked}
      aria-label="Código de confirmación de 6 dígitos" aria-invalid={wrong || undefined} aria-describedby={[wrong ? 'cf-wrong' : '', 'cf-length'].filter(Boolean).join(' ')} />
    {Array.from({ length: 6 }, (_, index) => {
      const cursor = focused && !locked && !busy && index === code.length;
      return <span key={index} aria-hidden="true" className={`cf-box${code[index] ? ' is-filled' : ''}${cursor ? ' is-cursor' : ''}`}>{exhausted || (locked && !code[index]) ? <span className="cf-box-dot" /> : code[index] ?? ''}</span>;
    })}
  </div>;
  const lengthLine = <p className="cf-length t-body-sm" id="cf-length">
    {locked ? 'El código ya no puede ingresarse.' : reason}
  </p>;
  const submit = (className: string) => <button type="submit" form="cf-form" className={`btn btn-primary btn-block cf-submit ${className}`} disabled={disabled} aria-describedby={busy ? 'cf-verifying' : reason ? reasonId : undefined}>
    {busy ? <><Icon name="spinner" size={20} className="spin" /><span>Verificando…</span></> : <><Icon name="lockOutlined" size={20} /><span>{buttonLabel}</span></>}
  </button>;
  const home = (className: string) => <Link className={`btn btn-primary btn-block cf-home ${className}`} to="/accounts"><Icon name="home" size={20} /><span>Volver al inicio</span></Link>;
  // D-UX-8: a closed attempt has no «Autorizar…» button; «Volver al inicio» is its only primary action.
  const primary = (className: string) => locked ? home(className) : submit(className);
  const form = <form className="cf-form" id="cf-form" noValidate onSubmit={onSubmit}>
    <div className="cf-label-row"><span className="t-body-sm-medium cf-label">Código de 6 dígitos</span>{chip}</div>
    {boxes}
    <div className="cf-under">{lengthLine}{transfer.demoOnlyCode && !locked && <span className="cf-demo-code t-body-sm-medium">Código de demostración: <strong>{transfer.demoOnlyCode}</strong></span>}</div>
    {busy && <p className="cf-verifying t-body-sm" role="status" id="cf-verifying"><Icon name="spinner" size={16} className="spin" /><span>Validando código… Por favor no cierres ni recargues esta ventana.</span></p>}
    {notice && <p className="cf-notice t-body-sm" role="alert"><Icon name="infoOutlined" size={18} /><span>{notice}</span></p>}
    <span className="only-wide">{primary('')}</span>
  </form>;
  const actionBar = <div className="only-compact"><ActionBar>{primary('')}</ActionBar></div>;

  const statusChip = exhausted ? <span className="chip chip-neutral t-label-caps">No ejecutada</span>
    : terminal === 'expired' ? <span className="chip chip-error t-label-caps">Expirada</span>
      : terminal === 'cancelled' ? <span className="chip chip-neutral t-label-caps">Cancelada</span>
        : <span className="chip chip-pending t-label-caps">Pendiente de confirmación</span>;
  const summary = <aside className="cf-side" aria-labelledby="cf-summary-title">
    <section className="cf-card cf-summary">
      <div className="cf-summary-head"><h2 className="t-label-caps tf-muted" id="cf-summary-title">Resumen de orden</h2>{statusChip}</div>
      <div className="cf-amount-panel"><span className="t-body-sm tf-muted">Monto a transferir</span><Amount minor={transfer.amountMinor} className="t-headline-lg cf-amount" suffixClassName="t-body-sm-medium tf-muted cf-amount-suffix" /></div>
      <dl className="cf-rows">
        <div><dt className="t-body-sm tf-muted">Destinatario</dt><dd><span className="t-body-md-medium cf-ellipsis" title={transfer.destination.name}>{transfer.destination.name}</span><span className="t-code-data tf-muted" data-clabe>Cuenta •• {destinationTail}</span></dd></div>
        <div><dt className="t-body-sm tf-muted">Cuenta origen</dt><dd><span className="t-body-md-medium cf-ellipsis" title={source?.name}>{source?.name ?? 'Cuenta de origen'}</span><span className="t-body-sm tf-muted" data-clabe>•• {tailText(source?.clabeMasked)}</span></dd></div>
        <div><dt className="t-body-sm tf-muted">Concepto</dt><dd><span className="t-body-md-medium cf-ellipsis" title={transfer.concept}>{transfer.concept}</span></dd></div>
        <div><dt className="t-body-sm tf-muted">Referencia</dt><dd><span className="t-code-data">{transfer.reference}</span></dd></div>
        <div><dt className="t-body-sm tf-muted">Creada</dt><dd><span className="t-code-data tf-muted">{shortDateTime(transfer.createdAt, timeZone).time}</span></dd></div>
      </dl>
    </section>
    <section className="cf-card cf-tip" aria-labelledby="cf-tip-title"><Icon name="shieldOutlined" size={20} className="tf-muted" /><div><h2 className="t-body-sm-medium" id="cf-tip-title">Protege tu código</h2><p className="t-body-sm tf-muted">Nunca compartas este código con terceros.</p></div></section>
  </aside>;
  const crumbs = <p className="cf-crumbs t-body-sm"><span>Transferir</span><Icon name="chevronRight" size={14} className="cf-crumb-sep" /><span className="t-body-sm-medium cf-crumb-current">Confirmación</span></p>;

  if (exhausted) {
    return <div className="cf-page">
      {crumbs}
      <section className="cf-suspended" aria-labelledby="cf-suspended-title">
        <span className="cf-suspended-tile"><Icon name="gppBadOutlined" size={28} /></span>
        <div className="cf-suspended-body">
          <h1 className="t-headline-md" id="cf-suspended-title" tabIndex={-1}>Operación suspendida</h1>
          <p className="t-body-md tf-muted" role="alert">Se agotó el número de intentos permitidos para este código. La transferencia no se realizó.</p>
          <div className="cf-no-charge">
            <span className="cf-no-charge-text"><Icon name="checkCircleOutlined" size={22} className="cf-ok" /><span className="t-body-md-medium">No se realizó ningún cargo a tu cuenta</span></span>
            {source && <span className="cf-no-charge-balance"><span className="t-label-caps tf-muted">Saldo disponible actual:</span><Amount minor={source.availableBalanceMinor} className="t-body-md-medium cf-balance-box" suffixClassName="" /></span>}
          </div>
        </div>
      </section>
      <div className="cf-grid">
        <section className="cf-card cf-code-card" aria-labelledby="cf-locked-title">
          <div className="cf-locked-head"><p className="t-label-caps tf-muted">Código de confirmación</p><h2 className="t-headline-sm" id="cf-locked-title">Autorización bloqueada</h2><p className="t-body-sm tf-muted">El servidor ya no acepta códigos para este intento.</p></div>
          {form}
        </section>
        {summary}
      </div>
      {actionBar}
    </div>;
  }
  const alert = wrong
    ? <div className="cf-alert" role="alert" id="cf-wrong"><Icon name="error" size={22} className="cf-alert-icon" /><div><p className="t-body-md-medium cf-alert-title">Código incorrecto</p><p className="t-body-sm tf-muted">El código ingresado no coincide. Revisa e ingresa nuevamente.</p></div></div>
    : terminal === 'expired'
      ? <div className="cf-alert" role="alert"><Icon name="error" size={22} className="cf-alert-icon" /><div><p className="t-body-md-medium cf-alert-title">Código expirado</p><p className="t-body-sm tf-muted">El código de confirmación venció. Este intento se cerró sin cargo.</p></div></div>
      : terminal === 'cancelled'
        ? <div className="cf-alert" role="alert"><Icon name="error" size={22} className="cf-alert-icon" /><div><p className="t-body-md-medium cf-alert-title">Intento cancelado</p><p className="t-body-sm tf-muted">Este intento se canceló sin cargo.</p></div></div>
        : null;
  return <div className="cf-page">
    {crumbs}
    <div className="cf-grid">
      <section className="cf-card cf-code-card" aria-labelledby="cf-title">
        {header('h1')}
        {alert}
        <p className="t-body-md tf-muted cf-intro">Ingresa el código de 6 dígitos para autorizar la transferencia de <strong className="cf-strong" data-amount>{mxn(transfer.amountMinor)}</strong> a <strong className="cf-strong">{transfer.destination.name}</strong> <span data-clabe>(•• {destinationTail})</span>.</p>
        {form}
      </section>
      {summary}
    </div>
    {actionBar}
  </div>;
}

// ───────────────────────────── W12 · Comprobante ─────────────────────────────
export function ReceiptView({ transfer, accounts, policy, notice }: { transfer: Transfer; accounts: readonly Account[]; policy?: TransferPolicy; notice?: ReactNode }) {
  const [copied, setCopied] = useState<'' | 'ok' | 'fail'>('');
  const own = !('alias' in transfer.destination);
  const source = accounts.find((account) => account.id === transfer.sourceAccountId);
  const destinationAccount = own ? accounts.find((account) => account.id === transfer.destination.id) : undefined;
  const folio = folioOf(transfer);
  async function copy() {
    try { await navigator.clipboard.writeText(folio); setCopied('ok'); } catch { setCopied('fail'); }
  }
  const sourceName = source?.name ?? 'Cuenta de origen';
  return <div className="rc-page">
    <header className="rc-header">
      <span className="rc-check"><Icon name="checkCircle" size={36} /></span>
      <span className="chip chip-success t-label-caps rc-chip">Operación exitosa</span>
      <h1 className="t-headline-lg" tabIndex={-1}>¡Transferencia completada con éxito!</h1>
      {own && <p className="t-body-md tf-muted rc-subtitle">El traspaso entre tus cuentas ha sido aplicado.</p>}
      <Amount minor={transfer.amountMinor} className="t-display-currency rc-amount" suffixClassName="t-headline-sm tf-muted rc-amount-suffix" />
    </header>
    {notice}
    <section className="rc-card" aria-label="Comprobante de transferencia">
      <div className="rc-bar" aria-hidden="true" />
      <div className="rc-body">
        <div className="rc-head">
          <div className="rc-head-text"><p className="t-label-caps tf-muted">Comprobante de transferencia</p><h2 className="t-headline-sm">{own ? 'Traspaso entre cuentas propias' : 'Transferencia interna Billetera MXN'}</h2></div>
          <div className="rc-folio">
            <div className="rc-folio-text"><span className="t-label-caps tf-muted">Folio interno</span><span className="t-code-data rc-folio-value">{folio}</span></div>
            <button type="button" className="rc-copy" aria-label="Copiar folio" title="Copiar folio" onClick={() => void copy()}><Icon name="copyOutlined" size={18} /></button>
          </div>
        </div>
        <p className="sr-only" role="status">{copied === 'ok' ? 'Folio copiado' : copied === 'fail' ? 'No pudimos copiar el folio; selecciónalo para copiarlo.' : ''}</p>
        {copied && <p className={`rc-copied t-body-sm${copied === 'fail' ? ' is-fail' : ''}`} aria-hidden="true"><Icon name={copied === 'ok' ? 'check' : 'infoOutlined'} size={16} />{copied === 'ok' ? 'Folio copiado' : 'No pudimos copiar el folio; selecciónalo para copiarlo.'}</p>}
        <div className="rc-parties">
          <div className="rc-party"><span className="rc-party-tile"><Icon name="walletOutlined" size={20} /></span><div className="rc-party-text"><span className="t-label-caps tf-muted">Cuenta de origen</span><span className="t-headline-sm rc-ellipsis" title={sourceName}>{sourceName}</span><span className="t-body-sm tf-muted" data-clabe>Terminación •• {tailText(source?.clabeMasked)}</span></div></div>
          <div className="rc-party"><span className="rc-party-tile"><Icon name={own ? (destinationAccount?.kind === 'savings' ? 'savings' : 'walletOutlined') : 'personOutlined'} size={20} /></span><div className="rc-party-text"><span className="t-label-caps tf-muted">{own ? 'Cuenta de destino' : 'Destinatario'}</span><span className="t-headline-sm rc-ellipsis" title={transfer.destination.name}>{transfer.destination.name}</span><span className="t-body-sm tf-muted" data-clabe>{own ? 'Terminación' : 'Billetera MXN'} •• {tailText(transfer.destination.clabeMasked)}</span></div></div>
        </div>
        <dl className="rc-rows">
          <div><dt className="t-body-md tf-muted">Fecha y hora</dt><dd className="t-body-md-medium">{longDateTime(transfer.completedAt ?? transfer.createdAt, policy?.businessTimeZone)}</dd></div>
          <div className="is-zebra"><dt className="t-body-md tf-muted">Concepto</dt><dd className="t-body-md-medium rc-value">{transfer.concept}</dd></div>
          <div><dt className="t-body-md tf-muted">Referencia</dt><dd className="t-code-data">{transfer.reference}</dd></div>
        </dl>
        {own ? <div className="rc-balances">
          <p className="t-label-caps tf-muted rc-balances-title">Saldos disponibles actuales</p>
          <div className="rc-balance-grid">
            {[{ account: source, sign: '−' as const, chip: 'chip-error', fallback: sourceName }, { account: destinationAccount, sign: '+' as const, chip: 'chip-success', fallback: transfer.destination.name }].map(({ account, sign, chip, fallback }) => <div className="rc-balance-card" key={sign}>
              <div className="rc-balance-top"><span className="t-body-md rc-ellipsis" title={account?.name ?? fallback}>{account?.name ?? fallback} (•• {tailText(account?.clabeMasked)})</span><span className={`chip ${chip} t-code-data rc-delta`} data-amount>{signedChip(sign, transfer.amountMinor)}</span></div>
              <div className="rc-balance-bottom"><span className="t-label-caps tf-muted">Saldo actual</span>{account ? <Amount minor={account.availableBalanceMinor} className={`t-headline-md${sign === '+' ? ' rc-credit' : ''}`} suffixClassName="" /> : <span className="t-body-sm tf-muted">No disponible</span>}</div>
            </div>)}
          </div>
          {accounts.length > 0 && <div className="rc-total"><span className="rc-total-text"><Icon name="checkCircleOutlined" size={22} className="tf-primary-icon" /><span><span className="t-label-caps rc-total-label">Saldo total consolidado</span><span className="t-body-sm tf-muted">Suma de los saldos disponibles de tus cuentas</span></span></span><Amount minor={sumAvailableBalanceMinor([...accounts]).toString()} className="t-headline-md tf-primary-text" suffixClassName="" /></div>}
        </div>
          : <div className="rc-total"><span className="rc-total-text"><Icon name="checkCircleOutlined" size={22} className="tf-primary-icon" /><span><span className="t-label-caps rc-total-label">Saldo disponible actual</span><span className="t-body-sm tf-muted">{sourceName}</span></span></span>{source ? <Amount minor={source.availableBalanceMinor} className="t-headline-md tf-primary-text" suffixClassName="" /> : <span className="t-body-sm tf-muted">No disponible</span>}</div>}
      </div>
    </section>
    <div className="rc-actions">
      <Link className="btn btn-primary rc-action" to="/accounts"><Icon name="home" size={20} /><span>Volver al inicio</span></Link>
      <Link className="btn btn-outline rc-action" to={`/accounts/${encodeURIComponent(transfer.sourceAccountId)}/movements`}><Icon name="receiptLongOutlined" size={20} /><span>Ver movimientos</span></Link>
    </div>
  </div>;
}
