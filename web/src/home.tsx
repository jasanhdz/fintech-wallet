import { useState } from 'react';
// W03 · Inicio, cuentas, saldo, actividad y aviso de operación pendiente.
// References: `w03_inicio_y_cuentas_corregido` (con saldo), `w03_inicio_sin_saldo` (cuenta nueva) and, only for
// the notice, `w03_operaci_n_pendiente_de_verificaci_n`. Real data only: GET /accounts, GET /accounts/{first}/
// movements?limit=3 and GET /transfer-policy. The notice reads the same-tab record read-only and sends nothing.
import { Link, Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ProductComponents } from '@fintech-wallet/shared';
import { formatMxnFromMinor } from '@fintech-wallet/shared';
import { ApiError, request, type Account } from './api.js';
import { AccessUnavailable, AppShell, clabeTail, PageHeader } from './components.js';
import { Icon } from './icons.js';
import { useSession } from './session.js';
import { useTransferPolicy } from './policy.js';
import { readActiveTransferContext } from './transfer-attempt.js';
import { orderAccounts } from './account-order.js';
import { longBusinessDate, longDate, longDateTime, signedMxn, splitMxn } from './format.js';

type Movement = ProductComponents['schemas']['Movement'];
type MovementPage = ProductComponents['schemas']['MovementPage'];

export function recentMovementsPath(accountId: string) {
  return `/accounts/${encodeURIComponent(accountId)}/movements?limit=3`;
}

export function sumAvailableBalanceMinor(accounts: Account[]) {
  return accounts.reduce((total, account) => total + BigInt(account.availableBalanceMinor), 0n);
}

const movementStatus: Record<Movement['status'], { label: string; tone: 'success' | 'pending' | 'error' }> = {
  completed: { label: 'Completada', tone: 'success' },
  processing: { label: 'En proceso', tone: 'pending' },
  rejected: { label: 'Rechazada', tone: 'error' },
};

export function StatusChip({ status }: { status: Movement['status'] }) {
  const { label, tone } = movementStatus[status];
  return <span className={`chip chip-${tone} chip-dot`}><span className="chip-dot-mark" aria-hidden="true" />{label}</span>;
}

/** Amount with the single «MXN» suffix painted one typographic step smaller (D-3). */
export function Amount({ minor, className, suffixClassName }: { minor: string; className: string; suffixClassName: string }) {
  const parts = splitMxn(minor);
  // The separating space lives inside the suffix so the gap follows the suffix size, as in the references.
  return <span className={className} data-amount>{parts.number}<span className={suffixClassName}>{' '}{parts.suffix}</span></span>;
}

const masked = (clabeMasked: string | undefined) => {
  const tail = clabeTail(clabeMasked);
  return tail ? `•••• ${tail}` : '';
};

function Skeleton() {
  return <section className="home-accounts" aria-label="Cargando cuentas" aria-busy="true">
    <p className="sr-only" role="status">Cargando tus cuentas…</p>
    <div className="home-skeleton" aria-hidden="true" /><div className="home-skeleton" aria-hidden="true" />
  </section>;
}

function ErrorPanel({ title, children, onRetry }: { title: string; children: string; onRetry: () => void }) {
  return <section className="home-error" role="alert">
    <span className="home-error-icon" aria-hidden="true"><Icon name="error" size={20} /></span>
    <div><h2 className="t-headline-sm">{title}</h2><p className="t-body-md">{children}</p></div>
    <button type="button" className="btn btn-secondary" onClick={onRetry}><Icon name="restart" size={18} /><span>Intentar de nuevo</span></button>
  </section>;
}

function problemText(error: unknown) {
  if (error instanceof ApiError) return error.problem.detail || error.problem.title;
  return error instanceof Error ? error.message : 'No fue posible completar la solicitud.';
}

/**
 * W03-V6/F1 · pending notice against the CURRENT recovery behaviour (SPEC §7.3.2, H-W1): both actions only
 * navigate to /transfers/new, whose existing mount logic does GET /transfers/{id} (record with transfer id) or
 * repeats the same POST with the same key (record without it). The notice itself issues no request.
 */
function PendingNotice() {
  const context = readActiveTransferContext();
  if (!context) return null;
  const { summary, hasTransferId } = context;
  const kind = summary.destinationType === 'own_account' ? 'Entre mis cuentas' : 'Beneficiario Billetera';
  return <section className="home-pending" aria-labelledby="home-pending-title">
    <div className="home-pending-body">
      <span className="home-pending-icon" aria-hidden="true"><Icon name="syncProblem" size={24} /></span>
      <div className="home-pending-text">
        <div className="home-pending-heading"><h2 id="home-pending-title" className="t-headline-sm">Estamos verificando el resultado de tu transferencia</h2><span className="chip chip-pending t-label-caps">En verificación</span></div>
        <p className="t-body-md-medium">Tienes una transferencia pendiente de verificación por <span data-amount>{formatMxnFromMinor(summary.amountMinor)}</span> ({kind}).</p>
        <p className="t-body-sm home-pending-note">Ocurrió una interrupción durante el proceso.{!hasTransferId && <> <span id="home-pending-repeat">Se repetirá la misma solicitud con su misma clave de operación.</span></>}</p>
      </div>
    </div>
    <Link className="btn btn-primary home-pending-cta" to="/transfers/new" aria-describedby={hasTransferId ? undefined : 'home-pending-repeat'}>
      <Icon name="factCheckOutlined" size={18} /><span>{hasTransferId ? 'Consultar estado' : 'Retomar verificación'}</span>
    </Link>
  </section>;
}

/** D-4: the date is the server's business day once the policy answers; the browser's date before that. */
function HomeHeader({ name, totalMinor, businessDate }: { name: string; totalMinor: string | null; businessDate?: string }) {
  return <div className="page-header-row home-header">
    <PageHeader className="home-greeting" eyebrow={<p className="t-label-caps home-eyebrow">Resumen financiero</p>} title={<>Hola, {name}</>}>
      <p className="t-body-md home-date"><Icon name="calendarOutlined" size={16} /><span>{(businessDate && longBusinessDate(businessDate)) || longDate(new Date())}</span></p>
    </PageHeader>
    {totalMinor !== null && <section className="home-total" aria-labelledby="home-total-label">
      <span className="home-total-tile" aria-hidden="true"><Icon name="walletOutlined" size={20} /></span>
      <div className="home-total-text">
        <h2 id="home-total-label" className="t-label-caps">Saldo consolidado</h2>
        <Amount minor={totalMinor} className="t-headline-md home-total-value" suffixClassName="t-body-sm-medium home-suffix" />
      </div>
    </section>}
  </div>;
}

function AccountCard({ account, index }: { account: Account; index: number }) {
  const first = index === 0;
  const tail = masked(account.clabeMasked);
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fail'>('idle');
  // The full CLABE is delivered by the API to its owner only; it is copied, never rendered.
  async function copyClabe() {
    try { await navigator.clipboard.writeText(account.clabe); setCopied('ok'); } catch { setCopied('fail'); }
  }
  return <article className={`home-account${first ? ' is-first' : ''}`} aria-label={account.name}>
    <div className="home-account-top">
      <span className={`home-account-chip t-body-sm-medium${first ? ' is-first' : ''}`}><span className="home-account-dot" aria-hidden="true" /><span className="home-account-name" title={account.name}>{account.name}</span></span>
      {tail && <span className="t-code-data home-account-clabe" data-clabe aria-label={`Cuenta terminación ${clabeTail(account.clabeMasked)}`}>{tail}</span>}
    </div>
    <button type="button" className="btn btn-text home-copy-clabe" onClick={() => void copyClabe()} aria-label={`Copiar CLABE de ${account.name}`}><Icon name="copy" size={16} /><span>Copiar CLABE</span></button>
    <p className="t-body-sm home-copy-status" role="status" aria-live="polite">{copied === 'ok' ? 'CLABE copiada. Pégala al agregar un beneficiario.' : copied === 'fail' ? 'No se pudo copiar. Inténtalo de nuevo.' : ''}</p>
    <div className="home-account-balance">
      <span className="t-label-caps">Saldo disponible</span>
      <p><Amount minor={account.availableBalanceMinor} className="t-display-currency home-balance-value" suffixClassName="t-headline-sm home-suffix" /></p>
    </div>
    <div className="home-account-actions">
      {first
        ? <Link className="btn btn-primary btn-block" to={`/transfers/new?source=${encodeURIComponent(account.id)}`}><Icon name="send" size={20} /><span>Transferir</span></Link>
        : <Link className="btn btn-secondary btn-block" to={`/transfers/new?type=own_account&source=${encodeURIComponent(account.id)}`}><Icon name="syncAlt" size={20} /><span>Mover entre mis cuentas</span></Link>}
    </div>
  </article>;
}

function ActivityRow({ item, timeZone }: { item: Movement; timeZone?: string }) {
  const debit = item.type === 'debit';
  const party = item.counterparty;
  const tail = masked(party?.clabeMasked);
  const when = longDateTime(item.occurredAt, timeZone);
  return <tr>
    <td className="home-activity-detail">
      <span className={`home-activity-icon${debit ? '' : ' is-credit'}`}><Icon name={debit ? 'arrowOutward' : 'arrowDownward'} size={18} /><span className="sr-only">{debit ? 'Cargo' : 'Abono'}</span></span>
      <span className="home-activity-party">
        <span className="t-body-md-medium home-truncate" title={party?.name ?? 'Transferencia interna'}>{party?.name ?? 'Transferencia interna'}</span>
        <span className="t-code-data home-muted">{tail ? <><span data-clabe>{tail}</span> · </> : null}{when}</span>
      </span>
    </td>
    <td className="home-activity-concept"><span className="home-mobile-label">Concepto</span><span className="t-body-md home-wrap">{item.concept}</span><span className="t-code-data home-muted">Ref: {item.reference}</span></td>
    <td className="home-activity-status"><StatusChip status={item.status} /></td>
    <td className={`home-activity-amount t-body-md-medium${debit ? '' : ' is-credit'}`}><span className="home-mobile-label">Monto</span><span data-amount>{signedMxn(item.type, item.amountMinor)}</span></td>
  </tr>;
}

function RecentActivity({ account, timeZone }: { account: Account; timeZone?: string }) {
  const recent = useQuery({ queryKey: ['recent-movements', account.id], queryFn: () => request<MovementPage>(recentMovementsPath(account.id)) });
  const history = `/accounts/${encodeURIComponent(account.id)}/movements`;
  const items = recent.data?.items.slice(0, 3) ?? [];
  return <section className="home-activity" aria-labelledby="home-activity-title">
    <div className="home-section-heading">
      <div className="home-section-title"><h2 id="home-activity-title" className="t-headline-md">Actividad Reciente</h2><span className="chip chip-neutral t-code-data">Últimos movimientos</span></div>
      <Link className="home-link t-body-sm-medium" to={history}><span>Ver historial completo</span><Icon name="arrowForward" size={16} /></Link>
    </div>
    <div className="home-activity-card" aria-busy={recent.isPending}>
      {recent.isPending ? <div className="home-activity-state" role="status"><Icon name="spinner" size={18} className="spin" /><span>Cargando movimientos…</span></div>
        : recent.isError ? <div className="home-activity-error" role="alert"><p className="t-body-md"><Icon name="error" size={18} /><span>No pudimos cargar la actividad reciente.</span></p><button type="button" className="btn btn-secondary" onClick={() => void recent.refetch()}><Icon name="restart" size={18} /><span>Intentar de nuevo</span></button></div>
        : items.length === 0 ? <div className="home-activity-state"><span>Aún no hay movimientos en esta cuenta.</span></div>
          : <table className="home-activity-table">
            <caption className="sr-only">Últimos movimientos de {account.name}</caption>
            <thead><tr className="t-label-caps"><th scope="col">Detalle / Beneficiario</th><th scope="col">Concepto &amp; Referencia</th><th scope="col">Estado</th><th scope="col">Monto</th></tr></thead>
            <tbody>{items.map((item) => <ActivityRow key={item.id} item={item} timeZone={timeZone} />)}</tbody>
          </table>}
      {items.length > 0 && <div className="home-activity-footer"><span className="t-body-sm">Mostrando los últimos {items.length} movimientos</span></div>}
    </div>
  </section>;
}

/** W03-V5: every account at zero and no movements yet (new account). */
function EmptyHome({ accounts }: { accounts: Account[] }) {
  return <>
    <section className="home-welcome" aria-labelledby="home-welcome-title">
      <span className="home-welcome-icon" aria-hidden="true"><Icon name="infoOutlined" size={20} /></span>
      <div><h2 id="home-welcome-title" className="t-headline-sm">Tu cuenta está creada</h2><p className="t-body-md">Tu cuenta principal está lista para operar.</p></div>
    </section>
    <div className="home-empty-grid">
      <section className="home-empty-column" aria-labelledby="home-empty-accounts">
        <div className="home-column-heading"><h2 id="home-empty-accounts" className="t-headline-sm">Cuentas Disponibles</h2><span className="chip chip-neutral t-label-caps">{accounts.length} {accounts.length === 1 ? 'cuenta activa' : 'cuentas activas'}</span></div>
        <section className="home-empty-accounts" aria-label="Tus cuentas">
          {accounts.map((account) => <article className="home-empty-account" key={account.id} aria-label={account.name}>
            <div className="home-empty-account-top">
              <span className="home-empty-account-tile" aria-hidden="true"><Icon name="walletOutlined" size={24} /></span>
              <span className="home-empty-account-name"><span className="t-headline-sm home-truncate" title={account.name}>{account.name}</span>{masked(account.clabeMasked) && <span className="t-code-data home-muted" data-clabe>{masked(account.clabeMasked)}</span>}</span>
            </div>
            <div className="home-account-balance"><span className="t-label-caps">Saldo disponible</span><p><Amount minor={account.availableBalanceMinor} className="t-display-currency home-balance-value" suffixClassName="t-body-md home-suffix" /></p></div>
            <button type="button" className="btn btn-block btn-disabled-reason" disabled aria-describedby={`home-no-balance-${account.id}`}>
              <Icon name="block" size={18} /><span>Transferir <span id={`home-no-balance-${account.id}`}>(Disponible cuando la cuenta tenga saldo)</span></span>
            </button>
          </article>)}
        </section>
      </section>
      <section className="home-empty-column home-empty-activity" aria-labelledby="home-activity-title">
        <div className="home-column-heading"><h2 id="home-activity-title" className="t-headline-sm">Actividad Reciente</h2><span className="t-code-data home-muted">0 Registros</span></div>
        <div className="home-empty-state">
          <span className="home-empty-state-icon" aria-hidden="true"><Icon name="receiptLongOutlined" size={30} /></span>
          <h3 className="t-headline-md">Aún no tienes movimientos registrados</h3>
          <p className="t-body-md">Tus movimientos aparecerán aquí cuando realices operaciones</p>
        </div>
      </section>
    </div>
  </>;
}

export function AccountsPage() {
  const { session, end, hydrated } = useSession();
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: () => request<{ items: Account[] }>('/accounts'), enabled: Boolean(session) });
  const policy = useTransferPolicy();
  // ORD-02 (SPEC §4): principal (checking) first; its card is the featured one and its activity is shown.
  const items = orderAccounts(accounts.data?.items ?? []);
  const first = items[0];
  const allZero = items.length > 0 && items.every((account) => BigInt(account.availableBalanceMinor) === 0n);
  // Only needed to tell «sin saldo» (no movements) apart from an emptied account; same query key as RecentActivity.
  const recent = useQuery({ queryKey: ['recent-movements', first?.id], queryFn: () => request<MovementPage>(recentMovementsPath(first!.id)), enabled: Boolean(first) });
  if (!hydrated) return <AppShell><div className="home-skeleton-page" role="status" aria-busy="true"><span className="sr-only">Cargando tu sesión…</span><Skeleton /></div></AppShell>;
  if (!session) return <Navigate to="/login" replace state={{ from: '/accounts' }} />;
  if (accounts.error instanceof ApiError && accounts.error.problem.status === 401) { end(true); return <Navigate to="/session-expired" replace />; }
  // D-11: 403 shows the W14 access card without revealing anything about the resource.
  if (accounts.error instanceof ApiError && accounts.error.problem.status === 403) return <AccessUnavailable />;
  const timeZone = policy.data?.businessTimeZone;
  const total = accounts.data ? String(sumAvailableBalanceMinor(items)) : null;
  // «Sin saldo» only once the first account is known to have no movements (never claimed while loading/failing).
  const emptyHome = allZero && recent.isSuccess && recent.data.items.length === 0;
  return <AppShell><div className="home">
    <HomeHeader name={session.user.fullName} totalMinor={total} businessDate={policy.data?.businessDate} />
    <PendingNotice />
    {accounts.isPending ? <Skeleton />
      : accounts.isError ? <ErrorPanel title="No pudimos cargar tus cuentas" onRetry={() => void accounts.refetch()}>{problemText(accounts.error)}</ErrorPanel>
      : items.length === 0 ? <section className="home-activity-state" role="status"><span>Aún no hay cuentas. Cuando tengas una cuenta disponible, aparecerá aquí.</span></section>
      : emptyHome ? <EmptyHome accounts={items} />
      : <>
        <section className="home-accounts" aria-label="Tus cuentas">{items.map((account, index) => <AccountCard key={account.id} account={account} index={index} />)}</section>
        {first && <RecentActivity account={first} timeZone={timeZone} />}
      </>}
  </div></AppShell>;
}
