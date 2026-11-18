// W04 · Historial (`w04_historial_con_movimientos`, `w04_cargando`, `w04_sin_movimientos`, `w04_sin_resultados`,
// `w04_error_al_cargar_m_s`) and W05 · Comprobante desde el historial (`w05_comprobante_de_transferencia`).
import { Fragment, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { ProductComponents } from '@fintech-wallet/shared';
import { ApiError, request, type Account } from './api.js';
import { AccessUnavailable, AppShell, clabeTail, PageHeader } from './components.js';
import { Icon } from './icons.js';
import { useSession } from './session.js';
import { useTransferPolicy } from './policy.js';
import { Amount, StatusChip } from './home.js';
import { orderAccounts } from './account-order.js';
import { browserTimeZone, businessRange, longDateTime, shortDateTime, splitMxn } from './format.js';

type Movement = ProductComponents['schemas']['Movement'];
type MovementPage = ProductComponents['schemas']['MovementPage'];
type Transfer = ProductComponents['schemas']['Transfer'];
export type Filters = { from: string; to: string; type: '' | 'debit' | 'credit' };
const NO_FILTERS: Filters = { from: '', to: '', type: '' };

/**
 * GET /accounts/{id}/movements query. Date filters are business days `[00:00, 24:00)` in `timeZone` (D-4):
 * the policy's `businessTimeZone` once loaded, the browser zone before that.
 */
export function movementQuery(accountId: string, filters: Filters, cursor?: string, timeZone: string = browserTimeZone()) {
  const params = new URLSearchParams();
  const range = businessRange(filters.from, filters.to, timeZone);
  if (range.from) params.set('from', range.from);
  if (range.to) params.set('to', range.to);
  if (filters.type) params.set('type', filters.type);
  if (cursor) params.set('cursor', cursor);
  params.set('limit', '20');
  return `/accounts/${encodeURIComponent(accountId)}/movements?${params.toString()}`;
}

const masked = (clabeMasked: string | undefined) => { const tail = clabeTail(clabeMasked); return tail ? `•••• ${tail}` : ''; };
/** D-10: debits and credits from another own account open W05; credits from third parties never call GET /transfers. */
const ownMovement = (item: Movement) => item.type === 'debit' || Boolean(item.counterparty?.ownAccountId);

function problemText(error: unknown) {
  if (error instanceof ApiError) return error.problem.detail || error.problem.title;
  return error instanceof Error ? error.message : 'No fue posible completar la solicitud.';
}

function AccountSelector({ accountId, accounts }: { accountId: string; accounts: Account[] | undefined }) {
  const navigate = useNavigate();
  return <div className="hist-account">
    <span className="hist-account-icon" aria-hidden="true"><Icon name="walletOutlined" size={20} /></span>
    <span className="hist-account-field">
      <label className="t-label-caps" htmlFor="hist-account">Cuenta</label>
      {accounts
        ? <select id="hist-account" className="t-body-md-medium" value={accountId} onChange={(event) => navigate(`/accounts/${encodeURIComponent(event.target.value)}/movements`)}>
          {orderAccounts(accounts).map((account) => <option key={account.id} value={account.id}>{account.name} ({masked(account.clabeMasked)})</option>)}
        </select>
        : <select id="hist-account" className="t-body-md-medium" disabled><option>Cargando cuentas…</option></select>}
    </span>
    <Icon name="unfoldMore" size={18} className="hist-account-chevron" />
  </div>;
}

const TYPES: Array<{ value: Filters['type']; label: string }> = [{ value: '', label: 'Todos' }, { value: 'credit', label: 'Entradas' }, { value: 'debit', label: 'Salidas' }];

function FilterBar({ filters, onChange, showDates }: { filters: Filters; onChange: (next: Filters) => void; showDates: boolean }) {
  const active = Boolean(filters.from || filters.to || filters.type);
  const allButton = useRef<HTMLButtonElement>(null);
  // HI-03: «Limpiar filtros» exists only with an active filter; using it returns the focus to «Todos».
  const clear = () => { onChange(NO_FILTERS); allButton.current?.focus(); };
  return <div className="hist-filters" role="group" aria-label="Filtros de movimientos">
    <div className="hist-filters-main">
      <div className="hist-segment" role="group" aria-label="Tipo de movimiento">
        {TYPES.map((option) => <button key={option.label} ref={option.value === '' ? allButton : undefined} type="button" className="t-body-sm-medium" aria-pressed={filters.type === option.value} onClick={() => onChange({ ...filters, type: option.value })}>{option.label}</button>)}
      </div>
      {showDates && <div className="hist-dates">
        <label className="hist-date"><span className="t-body-sm-medium">Desde</span><span className="hist-date-input"><Icon name="calendarOutlined" size={16} /><input className="t-code-data" type="date" value={filters.from} max={filters.to || undefined} onChange={(event) => onChange({ ...filters, from: event.target.value })} /></span></label>
        <label className="hist-date"><span className="t-body-sm-medium">Hasta</span><span className="hist-date-input"><Icon name="calendarOutlined" size={16} /><input className="t-code-data" type="date" value={filters.to} min={filters.from || undefined} onChange={(event) => onChange({ ...filters, to: event.target.value })} /></span></label>
      </div>}
    </div>
    {active && <button type="button" className="hist-clear t-body-sm-medium" onClick={clear}><Icon name="restartAlt" size={16} /><span>Limpiar filtros</span></button>}
  </div>;
}

function HistoryRow({ item, accountId, timeZone, expanded, onToggle }: { item: Movement; accountId: string; timeZone?: string; expanded: boolean; onToggle: () => void }) {
  const debit = item.type === 'debit';
  const when = shortDateTime(item.occurredAt, timeZone);
  const party = item.counterparty;
  const name = party?.name ?? 'Transferencia interna';
  const tail = masked(party?.clabeMasked);
  const amount = splitMxn(item.amountMinor, debit ? '−' : '+');
  const panelId = `hist-detail-${item.id}`;
  const own = ownMovement(item);
  return <Fragment>
    <tr className="hist-row">
      <td className="hist-when"><span className="t-body-md-medium">{when.date}</span><span className="t-code-data hist-muted">{when.time}</span></td>
      <td className="hist-party">
        <span className={`hist-party-icon${debit ? '' : ' is-credit'}`}><Icon name={debit ? 'arrowUpward' : 'arrowDownward'} size={18} /><span className="sr-only">{debit ? 'Cargo' : 'Abono'}</span></span>
        <span className="hist-party-text"><span className="t-body-md-medium hist-truncate" title={name}>{name}</span>{tail && <span className="t-code-data hist-muted" data-clabe>{tail}</span>}<span className="t-code-data hist-muted hist-party-when">{when.date} · {when.time}</span></span>
      </td>
      <td className="hist-concept"><span className="hist-mobile-label">Concepto</span><span className="t-body-md hist-wrap">{item.concept}</span><span className="t-body-sm hist-muted">Ref. {item.reference}</span></td>
      <td className="hist-status"><StatusChip status={item.status} /></td>
      <td className={`hist-amount${debit ? '' : ' is-credit'}`}><span className="hist-mobile-label">Importe</span><span className="t-headline-sm" data-amount>{amount.sign}{amount.number} <span className="t-body-sm hist-suffix">{amount.suffix}</span></span></td>
      <td className="hist-action">
        {!item.transferId ? null
          : own
            ? <Link className="hist-detail t-body-md-medium" to={`/transfers/${encodeURIComponent(item.transferId)}/movement-receipt`} state={{ accountId }}><span>Ver detalle</span><Icon name="chevronRight" size={16} /></Link>
            : <button type="button" className="hist-detail t-body-md-medium" aria-expanded={expanded} aria-controls={panelId} onClick={onToggle}><span>Ver detalle</span><Icon name={expanded ? 'expandMore' : 'chevronRight'} size={16} /></button>}
      </td>
    </tr>
    {!own && item.transferId && <tr className="hist-inline" id={panelId} hidden={!expanded}>
      <td colSpan={6}>
        <dl className="hist-inline-list t-body-sm">
          <div><dt>Contraparte</dt><dd>{name}{tail ? <> · <span data-clabe>{tail}</span></> : null}</dd></div>
          <div><dt>Importe</dt><dd data-amount>{amount.sign}{amount.number} {amount.suffix}</dd></div>
          <div><dt>Concepto</dt><dd>{item.concept}</dd></div>
          <div><dt>Referencia</dt><dd className="tabular">{item.reference}</dd></div>
          <div><dt>Fecha y hora</dt><dd>{longDateTime(item.occurredAt, timeZone)}</dd></div>
        </dl>
      </td>
    </tr>}
  </Fragment>;
}

function HistoryHead() {
  return <thead><tr className="t-label-caps"><th scope="col">Fecha y hora</th><th scope="col">Contraparte y detalle</th><th scope="col">Concepto</th><th scope="col">Estado</th><th scope="col" className="hist-right">Importe</th><th scope="col" className="hist-right">Acción</th></tr></thead>;
}

/** W04-V5 · first load: table skeleton and a status line (HI-05: no overlay, no blur). */
function HistoryLoading() {
  return <div className="hist-card hist-loading" aria-busy="true">
    <p className="hist-loading-line t-body-md-medium" role="status"><Icon name="spinner" size={18} className="spin" /><span>Obteniendo movimientos recientes…</span></p>
    <table className="hist-table" aria-hidden="true"><HistoryHead /><tbody>{[0, 1, 2, 3].map((row) => <tr key={row} className="hist-skeleton-row">
      <td><span className="hist-bone w-20" /><span className="hist-bone sm w-14" /></td>
      <td><span className="hist-bone-party"><span className="hist-bone-circle" /><span className="hist-bone-stack"><span className="hist-bone w-28" /><span className="hist-bone sm w-16" /></span></span></td>
      <td><span className="hist-bone w-24" /></td><td><span className="hist-bone w-20" /></td><td><span className="hist-bone w-20 right" /></td><td><span className="hist-bone w-16 right" /></td>
    </tr>)}</tbody></table>
  </div>;
}

function MovementsView({ accountId }: { accountId: string }) {
  const { session, hydrated, end } = useSession();
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [expanded, setExpanded] = useState<string | null>(null);
  const policy = useTransferPolicy();
  const zone = policy.data?.businessTimeZone ?? browserTimeZone();
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: () => request<{ items: Account[] }>('/accounts'), enabled: Boolean(session) });
  const firstPage = movementQuery(accountId, filters, undefined, zone);
  // D-9: pages accumulate; a new filter set is a new key, so accumulation restarts from page 1.
  const history = useInfiniteQuery({
    queryKey: ['movements', accountId, firstPage],
    queryFn: ({ pageParam }) => request<MovementPage>(movementQuery(accountId, filters, pageParam, zone)),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    // A filter set left behind is dropped, so coming back to it restarts from page 1 (no stale accumulation).
    gcTime: 0,
    enabled: Boolean(accountId && session),
  });
  const seen = new Set<string>();
  const rows = (history.data?.pages ?? []).flatMap((page) => page.items).filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)));
  // HI-04: «Cargar más» keeps the focus and the result is announced once («Se cargaron N movimientos más»).
  const countBefore = useRef<number | null>(null);
  const countLine = useRef<HTMLParagraphElement>(null);
  const [loadedMore, setLoadedMore] = useState('');
  useEffect(() => {
    if (countBefore.current === null || history.isFetchingNextPage) return;
    const added = rows.length - countBefore.current;
    countBefore.current = null;
    setLoadedMore(added > 0 ? `Se cargaron ${added} movimientos más.` : '');
    if (!history.hasNextPage && document.activeElement === document.body) countLine.current?.focus();
  }, [history.isFetchingNextPage, history.hasNextPage, rows.length]);
  const loadMore = () => {
    if (history.isFetchingNextPage) return;
    countBefore.current = rows.length; setLoadedMore('');
    void history.fetchNextPage();
  };
  if (!hydrated) return <AppShell active="movements"><div className="hist"><HistoryLoading /></div></AppShell>;
  if (!session) return <Navigate to="/login" replace state={{ from: `/accounts/${accountId}/movements` }} />;
  if (history.error instanceof ApiError && history.error.problem.status === 401) { end(true); return <Navigate to="/session-expired" replace />; }
  // D-11: 403, and 404 for an account id, show the W14 access card (no hint about whether it exists).
  if (history.error instanceof ApiError && [403, 404].includes(history.error.problem.status) && !history.data) return <AccessUnavailable />;
  const hasFilters = Boolean(filters.from || filters.to || filters.type);
  const emptyNoFilters = history.data !== undefined && rows.length === 0 && !hasFilters;
  const change = (next: Filters) => { setExpanded(null); setLoadedMore(''); setFilters(next); };
  return <AppShell active="movements"><section className="hist">
    <div className="page-header-row hist-header"><PageHeader title="Historial de movimientos" /><AccountSelector accountId={accountId} accounts={accounts.data?.items} /></div>
    <FilterBar filters={filters} onChange={change} showDates={!emptyNoFilters} />
    {history.isPending ? <HistoryLoading />
      : history.data === undefined ? <div className="hist-error" role="alert">
        <span className="hist-error-icon" aria-hidden="true"><Icon name="syncProblem" size={22} /></span>
        <div className="hist-error-text"><span className="t-body-md-medium">No pudimos cargar los movimientos.</span><span className="t-body-sm">{problemText(history.error)}</span></div>
        <button type="button" className="btn btn-primary" disabled={history.isFetching} onClick={() => void history.refetch()}><Icon name="restart" size={18} /><span>Intentar de nuevo</span></button>
      </div>
      : rows.length === 0 ? (hasFilters
        ? <div className="hist-card hist-empty is-filtered">
          <span className="hist-empty-tile" aria-hidden="true"><Icon name="manageSearch" size={40} /><span className="hist-empty-badge"><Icon name="priorityHigh" size={12} /></span></span>
          <h2 className="t-headline-md">No encontramos movimientos con los filtros seleccionados</h2>
          <p className="t-body-md">Prueba ajustando el rango de fechas o el tipo de operación.</p>
          <button type="button" className="btn hist-reset" onClick={() => change(NO_FILTERS)}><Icon name="restartAlt" size={18} /><span>Restablecer búsqueda</span></button>
        </div>
        : <div className="hist-card hist-empty">
          <span className="hist-empty-circle" aria-hidden="true"><Icon name="receiptLongOutlined" size={30} /></span>
          <h2 className="t-headline-md">Aún no tienes movimientos</h2>
          <p className="t-body-md">Las transacciones que realices o recibas en esta cuenta aparecerán en este historial.</p>
        </div>)
      : <>
        <div className="hist-card">
          <table className="hist-table">
            <caption className="sr-only">Movimientos de la cuenta, del más reciente al más antiguo</caption>
            <HistoryHead />
            <tbody>{rows.map((item) => <HistoryRow key={item.id} item={item} accountId={accountId} timeZone={zone} expanded={expanded === item.id} onToggle={() => setExpanded((current) => current === item.id ? null : item.id)} />)}</tbody>
          </table>
          {history.isFetchNextPageError && <div className="hist-more-error" role="alert">
            <span className="hist-error-icon" aria-hidden="true"><Icon name="syncProblem" size={22} /></span>
            <div className="hist-error-text"><span className="t-body-md-medium">No pudimos cargar más movimientos.</span><span className="t-body-sm">Tus transacciones visibles se conservan.</span></div>
            <button type="button" className="btn btn-primary" aria-disabled={history.isFetchingNextPage || undefined} onClick={loadMore}><Icon name="restart" size={18} /><span>Reintentar</span></button>
          </div>}
          <div className="hist-footer">
            <p className="t-body-sm hist-count" id="hist-count" ref={countLine} tabIndex={-1} role="status"><span className="sr-only">{loadedMore} </span>Mostrando {rows.length} movimientos</p>
            {!history.isFetchNextPageError && history.hasNextPage && <>
              <button type="button" className="btn btn-secondary hist-more-button" aria-disabled={history.isFetchingNextPage || undefined} aria-describedby="hist-more-status" onClick={loadMore}>
                <Icon name={history.isFetchingNextPage ? 'spinner' : 'sync'} size={18} className={history.isFetchingNextPage ? 'spin' : undefined} /><span>{history.isFetchingNextPage ? 'Cargando más…' : 'Cargar más movimientos'}</span>
              </button>
              <span id="hist-more-status" className="sr-only" role="status">{history.isFetchingNextPage ? 'Cargando más movimientos…' : ''}</span>
            </>}
          </div>
        </div>
      </>}
  </section></AppShell>;
}

export function MovementsPage() {
  const { accountId = '' } = useParams();
  // A different account starts with fresh filters and accumulation.
  return <MovementsView key={accountId} accountId={accountId} />;
}

const transferState: Record<Transfer['status'], { title: string; chip: string; tone: 'success' | 'pending' | 'error' }> = {
  completed: { title: 'Transferencia completada', chip: 'Completada', tone: 'success' },
  awaiting_confirmation: { title: 'Transferencia pendiente de confirmación', chip: 'Pendiente', tone: 'pending' },
  processing: { title: 'Transferencia en proceso', chip: 'En proceso', tone: 'pending' },
  rejected: { title: 'Transferencia no realizada', chip: 'Rechazada', tone: 'error' },
  expired: { title: 'Transferencia no realizada', chip: 'Expirada', tone: 'error' },
  cancelled: { title: 'Transferencia no realizada', chip: 'Cancelada', tone: 'error' },
};

/** W05 · internal receipt of an own transfer opened from the history (GET /transfers/{transferId}). */
export function MovementReceiptPage() {
  const { transferId = '' } = useParams();
  const location = useLocation();
  const { session, hydrated, end } = useSession();
  const policy = useTransferPolicy();
  const transfer = useQuery({ queryKey: ['transfer', transferId], queryFn: () => request<Transfer>(`/transfers/${encodeURIComponent(transferId)}`), enabled: Boolean(transferId && session) });
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: () => request<{ items: Account[] }>('/accounts'), enabled: Boolean(session) });
  if (!hydrated) return <AppShell active="movements"><div className="mr-page"><div className="mr-card mr-state" role="status">Cargando tu sesión…</div></div></AppShell>;
  if (!session) return <Navigate to="/login" replace state={{ from: `/transfers/${transferId}/movement-receipt` }} />;
  if (transfer.error instanceof ApiError && transfer.error.problem.status === 401) { end(true); return <Navigate to="/session-expired" replace />; }
  if (transfer.error instanceof ApiError && [403, 404].includes(transfer.error.problem.status)) return <AccessUnavailable />;
  const data = transfer.data;
  const own = accounts.data?.items ?? [];
  const fromState = (location.state as { accountId?: string } | null)?.accountId;
  const backAccount = fromState && own.some((account) => account.id === fromState) ? fromState : data?.sourceAccountId;
  const backTo = backAccount ? `/accounts/${encodeURIComponent(backAccount)}/movements` : '/accounts';
  const folio = data ? data.receiptReference || data.id : '';
  const source = own.find((account) => account.id === data?.sourceAccountId);
  const destination = data?.destination;
  const destinationTail = masked(destination?.clabeMasked);
  const sourceTail = masked(source?.clabeMasked);
  const state = data ? transferState[data.status] : null;
  const timeZone = policy.data?.businessTimeZone;
  return <AppShell active="movements"><section className="mr-page">
    <header className="mr-header">
      <Link className="mr-back" to={backTo} aria-label="Volver a Movimientos"><Icon name="arrowBack" size={20} /></Link>
      <div className="mr-heading-text">
        <p className="mr-eyebrow"><span className="t-label-caps">Folio interno</span>{folio && <><span className="mr-dot" aria-hidden="true">•</span><span className="t-code-data mr-folio-inline">{folio}</span></>}</p>
        <h1 className="t-headline-md">Comprobante de transferencia</h1>
      </div>
    </header>
    {transfer.isPending ? <div className="mr-card mr-state" role="status" aria-busy="true"><Icon name="spinner" size={20} className="spin" /><span>Consultando el comprobante…</span></div>
      : !data || !state ? <div className="hist-error" role="alert">
        <span className="hist-error-icon" aria-hidden="true"><Icon name="error" size={22} /></span>
        <div className="hist-error-text"><span className="t-body-md-medium">No pudimos consultar el comprobante.</span><span className="t-body-sm">{problemText(transfer.error)}</span></div>
        <button type="button" className="btn btn-primary" disabled={transfer.isFetching} onClick={() => void transfer.refetch()}><Icon name="restart" size={18} /><span>Intentar de nuevo</span></button>
      </div>
      : <article className="mr-card" aria-labelledby="mr-status-title">
        <div className="mr-body">
          <div className="mr-status">
            <span className={`mr-status-tile is-${state.tone}`} aria-hidden="true"><Icon name={state.tone === 'success' ? 'checkCircleOutlined' : state.tone === 'pending' ? 'schedule' : 'error'} size={24} /></span>
            <div className="mr-status-text"><h2 id="mr-status-title" className="t-headline-sm">{state.title}</h2><p className="t-body-sm">Operación registrada en Billetera MXN</p></div>
            <span className={`chip chip-${state.tone} chip-dot mr-chip`}><span className="chip-dot-mark" aria-hidden="true" />{state.chip}</span>
          </div>
          <div className="mr-amount-panel">
            <div><span className="t-label-caps">Monto transferido</span><p><Amount minor={data.amountMinor} className="t-display-currency mr-amount-value" suffixClassName="t-headline-sm mr-suffix" /></p></div>
            <div className="mr-folio"><span className="t-label-caps">Folio interno</span><span className="t-code-data mr-folio-value">{folio}</span></div>
          </div>
          <div className="mr-parties-grid">
            <section className="mr-party" aria-labelledby="mr-source-title">
              <h3 id="mr-source-title" className="t-label-caps">Cuenta origen</h3>
              <div><p className="t-headline-sm mr-party-name">{source?.name ?? 'Cuenta propia'}</p><p className="t-body-sm mr-muted">Cuenta Billetera{sourceTail ? <> (<span data-clabe>{sourceTail}</span>)</> : null}</p></div>
            </section>
            <section className="mr-party" aria-labelledby="mr-destination-title">
              <h3 id="mr-destination-title" className="t-label-caps">Cuenta destino</h3>
              <div><p className="t-headline-sm mr-party-name">{destination?.name}</p><p className="t-body-sm mr-muted">Cuenta Billetera{destinationTail ? <> (<span data-clabe>{destinationTail}</span>)</> : null}</p></div>
              <p className="mr-party-row t-body-sm"><span className="mr-muted">Tipo de abono:</span><span className="mr-credit-kind">Transferencia interna</span></p>
            </section>
          </div>
          <section className="mr-detail" aria-labelledby="mr-detail-title">
            <div className="mr-detail-head"><h3 id="mr-detail-title" className="t-label-caps">Detalle de la operación</h3><span className="t-code-data mr-muted mr-folio-value">{folio}</span></div>
            <dl className="t-body-sm">
              <div><dt>Fecha y hora</dt><dd>{longDateTime(data.completedAt ?? data.createdAt, timeZone)}</dd></div>
              <div><dt>Concepto</dt><dd>{data.concept}</dd></div>
              <div><dt>Referencia numérica</dt><dd className="t-code-data">{data.reference}</dd></div>
            </dl>
          </section>
          <p className="t-body-sm mr-note">Constancia interna de Billetera MXN; no es un documento oficial.</p>
        </div>
        <footer className="mr-actions">
          <Link className="btn btn-outline" to={backTo}>Volver a Movimientos</Link>
          <Link className="btn btn-primary" to="/accounts">Ir a Inicio</Link>
        </footer>
      </article>}
  </section></AppShell>;
}
