import { useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { formatMxnFromMinor } from '@fintech-wallet/shared';
import { ApiError, request, type Account } from './api.js';
import { AppShell, StatePanel } from './components.js';
import { useSession } from './session.js';

type Movement = { id: string; transferId?: string; type: 'debit' | 'credit'; amountMinor: string; currency: 'MXN'; concept: string; reference: string; status: 'processing' | 'completed' | 'rejected'; occurredAt: string };
type MovementPage = { items: Movement[]; nextCursor?: string | null };
type Transfer = { id: string; status: string; sourceAccountId: string; destination: { id: string; name: string; alias?: string; kind?: Account['kind']; availableBalanceMinor?: string; clabeMasked?: string }; amountMinor: string; currency: string; concept: string; reference: string; receiptReference?: string | null; createdAt: string; completedAt?: string | null };
type Filters = { from: string; to: string; type: string };

export function movementQuery(accountId: string, filters: Filters, cursor?: string) {
  const params = new URLSearchParams();
  if (filters.from) params.set('from', new Date(`${filters.from}T00:00:00.000Z`).toISOString());
  if (filters.to) params.set('to', new Date(`${filters.to}T23:59:59.999Z`).toISOString());
  if (filters.type) params.set('type', filters.type);
  if (cursor) params.set('cursor', cursor);
  params.set('limit', '20');
  return `/accounts/${encodeURIComponent(accountId)}/movements?${params.toString()}`;
}

const statusLabel: Record<Movement['status'], string> = { processing: 'En proceso', completed: 'Completado', rejected: 'Rechazado' };

export function MovementsPage() {
  const { accountId = '' } = useParams();
  const { session, hydrated, end } = useSession();
  const [filters, setFilters] = useState<Filters>({ from: '', to: '', type: '' });
  const [cursor, setCursor] = useState<string | undefined>();
  const page = useQuery({ queryKey: ['movements', accountId, filters, cursor], queryFn: () => request<MovementPage>(movementQuery(accountId, filters, cursor)), enabled: Boolean(accountId) });
  if (!hydrated) return <AppShell><StatePanel title="Cargando tu sesión">Estamos verificando tu acceso.</StatePanel></AppShell>;
  if (!session) return <Navigate to="/login" replace state={{ from: `/accounts/${accountId}/movements` }} />;
  if (page.error instanceof ApiError && page.error.problem.status === 401) { end(true); return <Navigate to="/session-expired" replace />; }
  if (page.error instanceof ApiError && page.error.problem.status === 403) return <AppShell><StatePanel title="Acceso no autorizado">No tienes permiso para consultar estos movimientos.</StatePanel></AppShell>;
  function update(name: keyof Filters, value: string) { setFilters((old) => ({ ...old, [name]: value })); setCursor(undefined); }
  const hasRows = Boolean(page.data?.items.length);
  return <AppShell><section className="movement-page">
    <Link className="back-link" to="/accounts">← Volver a mis cuentas</Link>
    <span className="eyebrow">ACTIVIDAD DE LA CUENTA</span><h1>Movimientos</h1><p className="movement-intro">Consulta la actividad registrada en tu cuenta.</p>
    <form className="movement-filters" aria-label="Filtrar movimientos" onSubmit={(event) => event.preventDefault()}>
      <label>Desde<input type="date" value={filters.from} onChange={(event) => update('from', event.target.value)} /></label>
      <label>Hasta<input type="date" value={filters.to} onChange={(event) => update('to', event.target.value)} /></label>
      <label>Tipo<select value={filters.type} onChange={(event) => update('type', event.target.value)}><option value="">Todos</option><option value="debit">Cargo</option><option value="credit">Abono</option></select></label>
      <button className="secondary-button" type="button" onClick={() => { setFilters({ from: '', to: '', type: '' }); setCursor(undefined); }}>Limpiar filtros</button>
    </form>
    {hasRows && <button className="secondary-button" onClick={() => void page.refetch()}>Actualizar movimientos</button>}
    {page.isPending && !hasRows && <div className="movement-state" role="status" aria-live="polite">Cargando movimientos…</div>}
    {page.isError && <div className="movement-error" role="alert"><p>No pudimos cargar los movimientos. {page.error instanceof Error ? page.error.message : ''}</p><button className="secondary-button" onClick={() => void page.refetch()}>Intentar de nuevo</button></div>}
    {page.isFetching && hasRows && <p className="movement-refresh" role="status">Actualizando movimientos…</p>}
    {!page.isPending && !page.isError && page.data?.items.length === 0 && <StatePanel title="Sin movimientos">No hay movimientos para los filtros seleccionados.</StatePanel>}
    {hasRows && <><div className="movement-table-wrap" aria-busy={page.isFetching}><table className="movement-table"><caption className="sr-only">Movimientos de la cuenta, ordenados por fecha más reciente</caption><thead><tr><th scope="col">Movimiento</th><th scope="col">Fecha</th><th scope="col">Importe</th><th scope="col">Estado</th><th scope="col"><span className="sr-only">Detalle</span></th></tr></thead><tbody>{page.data!.items.map((item) => <tr key={item.id}><td data-label="Movimiento"><strong>{item.concept}</strong><span className="movement-reference">Referencia {item.reference} · {item.type === 'debit' ? 'Cargo' : 'Abono'}</span></td><td data-label="Fecha">{new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.occurredAt))}</td><td data-label="Importe" className={item.type === 'debit' ? 'amount-debit' : 'amount-credit'}>{item.type === 'debit' ? '−' : '+'}{formatMxnFromMinor(item.amountMinor)}</td><td data-label="Estado"><span className={`movement-status ${item.status}`}>{statusLabel[item.status]}</span></td><td data-label="Detalle">{item.transferId ? <Link to={`/transfers/${item.transferId}/movement-receipt`}>Ver detalle</Link> : <span className="movement-reference">Sin comprobante</span>}</td></tr>)}</tbody></table></div>
      <div className="movement-pagination"><span>Se muestran {page.data!.items.length} movimientos de esta página</span>{page.data!.nextCursor && <button className="secondary-button" disabled={page.isFetching} onClick={() => setCursor(page.data!.nextCursor ?? undefined)}>Cargar más movimientos</button>}</div></>}
  </section></AppShell>;
}

export function MovementReceiptPage() {
  const { transferId = '' } = useParams();
  const { session, hydrated, end } = useSession();
  const transfer = useQuery({ queryKey: ['transfer', transferId], queryFn: () => request<Transfer>(`/transfers/${encodeURIComponent(transferId)}`), enabled: Boolean(transferId) });
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: () => request<{ items: Account[] }>('/accounts'), enabled: Boolean(session) });
  if (!hydrated) return <AppShell><StatePanel title="Cargando tu sesión">Estamos verificando tu acceso.</StatePanel></AppShell>;
  if (!session) return <Navigate to="/login" replace state={{ from: `/transfers/${transferId}/receipt` }} />;
  if (transfer.error instanceof ApiError && transfer.error.problem.status === 401) { end(true); return <Navigate to="/session-expired" replace />; }
  if (transfer.error instanceof ApiError && transfer.error.problem.status === 403) return <AppShell><StatePanel title="Acceso no autorizado">No tienes permiso para consultar este comprobante.</StatePanel></AppShell>;
  const sourceAccount = accounts.data?.items.find((account) => account.id === transfer.data?.sourceAccountId);
  return <AppShell><section className="movement-page"><Link className="back-link" to="/accounts">← Volver a mis cuentas</Link><span className="eyebrow">DETALLE DE MOVIMIENTO</span><h1>Comprobante interno</h1>
    {transfer.isPending ? <div className="movement-state" role="status">Consultando el detalle…</div> : transfer.isError ? <div className="movement-error" role="alert"><p>No pudimos consultar el detalle. {transfer.error instanceof Error ? transfer.error.message : ''}</p><button className="secondary-button" onClick={() => void transfer.refetch()}>Intentar de nuevo</button></div> : <><div className="receipt-card receipt-card-movement"><header className="receipt-heading"><span className="receipt-icon" aria-hidden="true">✓</span><div><span className="eyebrow">DETALLE DE OPERACIÓN</span><h2>Comprobante interno</h2><p>Billetera MXN · Transferencia interna</p></div></header><div className="receipt-amount"><span>Importe de la transferencia</span><strong data-sensitive>{formatMxnFromMinor(transfer.data.amountMinor)} <small>MXN</small></strong></div><div className="receipt-parties"><section><span>CUENTA DE ORIGEN</span><strong data-sensitive>{sourceAccount?.name ?? 'Cuenta de origen'}</strong><small>{sourceAccount ? sourceAccount.kind === 'savings' ? 'Cuenta de ahorro' : 'Cuenta principal' : 'Cuenta Billetera'}</small></section><section><span>DESTINATARIO</span><strong data-sensitive>{transfer.data.destination.name}</strong><small data-sensitive>{transfer.data.destination.alias ?? (transfer.data.destination.kind === 'savings' ? 'Cuenta de ahorro' : 'Cuenta Billetera')}</small></section></div>{transfer.data.destination.availableBalanceMinor !== undefined && <section className="receipt-post-state"><span>Saldo disponible de destino informado</span><strong data-sensitive>{formatMxnFromMinor(transfer.data.destination.availableBalanceMinor)} MXN</strong></section>}<dl className="receipt-details"><div><dt>Concepto</dt><dd data-sensitive>{transfer.data.concept}</dd></div><div><dt>Referencia</dt><dd data-sensitive>{transfer.data.reference}</dd></div><div><dt>Folio interno</dt><dd data-sensitive>{transfer.data.receiptReference || transfer.data.id}</dd></div><div><dt>Estado</dt><dd>{transfer.data.status === 'completed' ? 'Completada' : transfer.data.status === 'processing' ? 'En proceso' : 'Rechazada'}</dd></div><div><dt>Fecha de registro</dt><dd>{new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(transfer.data.createdAt))}</dd></div>{transfer.data.completedAt && <div><dt>Fecha de cierre</dt><dd>{new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(transfer.data.completedAt))}</dd></div>}</dl><p className="receipt-disclaimer">Constancia interna de una operación registrada en Billetera. No es un comprobante CEP ni un documento oficial.</p></div><button className="secondary-button" onClick={() => void transfer.refetch()}>Actualizar estado</button></>}
  </section></AppShell>;
}
