import { useMemo, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { beneficiaryInputSchema } from '@fintech-wallet/shared';
import { ApiError, request, type Problem } from './api.js';
import { AppShell, Notice, StatePanel } from './components.js';
import { useSession } from './session.js';

type Beneficiary = {
  id: string;
  name: string;
  alias: string;
  clabeMasked: string;
  destinationAccountId: string;
  isFrequent?: boolean;
};

function errorMessage(error: unknown) {
  if (error instanceof ApiError) return error.problem.detail || error.problem.title;
  return error instanceof Error ? error.message : 'No fue posible completar la solicitud. Inténtalo de nuevo.';
}

function serverFieldErrors(error: unknown) {
  if (!(error instanceof ApiError)) return {};
  return Object.fromEntries(((error.problem as Problem).errors || []).map((item) => [item.pointer.split('/').at(-1) || '', item.detail]));
}

export function BeneficiariesPage() {
  const { session, end, hydrated } = useSession();
  const [search, setSearch] = useState('');
  const location = useLocation();
  const createdAlias = (location.state as { created?: string } | null)?.created;
  const beneficiaries = useQuery({
    queryKey: ['beneficiaries'],
    queryFn: () => request<{ items: Beneficiary[] }>('/beneficiaries'),
  });
  const filtered = useMemo(() => beneficiaries.data?.items.filter((item) =>
    `${item.name} ${item.alias} ${item.clabeMasked}`.toLocaleLowerCase().includes(search.toLocaleLowerCase().trim()),
  ) ?? [], [beneficiaries.data, search]);

  if (!hydrated) return <AppShell active="beneficiaries"><StatePanel title="Cargando tu sesión">Estamos verificando tu acceso.</StatePanel></AppShell>;
  if (!session) return <Navigate to="/login" replace state={{ from: '/beneficiaries' }} />;
  if (beneficiaries.error instanceof ApiError && beneficiaries.error.problem.status === 401) {
    end(); return <Navigate to="/session-expired" replace />;
  }
  if (beneficiaries.error instanceof ApiError && beneficiaries.error.problem.status === 403) return <AppShell active="beneficiaries"><StatePanel title="Acceso no autorizado">No tienes permiso para consultar estos beneficiarios.</StatePanel></AppShell>;

  return <AppShell active="beneficiaries"><div className="beneficiary-page">{createdAlias && <Notice tone="info">Beneficiario “{createdAlias}” agregado correctamente. La CLABE se muestra enmascarada.</Notice>}
    <div className="beneficiary-heading"><div><span className="eyebrow">DIRECTORIO</span><h1>Beneficiarios</h1><p>Administra tus beneficiarios de cuentas internas.</p></div><Link className="primary-button button-link" to="/beneficiaries/new">Agregar beneficiario <span aria-hidden="true">＋</span></Link></div>
    {beneficiaries.isPending ? <section className="beneficiary-list" aria-label="Cargando beneficiarios" aria-busy="true"><div className="beneficiary-skeleton" /><div className="beneficiary-skeleton" /></section>
      : beneficiaries.error ? <StatePanel title="No pudimos cargar tus beneficiarios" action={<button className="secondary-button" onClick={() => void beneficiaries.refetch()}>Intentar de nuevo</button>}>{errorMessage(beneficiaries.error)}</StatePanel>
        : beneficiaries.data.items.length === 0 ? <StatePanel title="Aún no tienes beneficiarios" action={<Link className="secondary-button button-link" to="/beneficiaries/new">Agregar beneficiario</Link>}>Cuando registres una cuenta interna, aparecerá aquí.</StatePanel>
          : <><label className="beneficiary-search-label" htmlFor="beneficiary-search">Buscar beneficiarios</label><input id="beneficiary-search" className="beneficiary-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nombre, alias o CLABE" />
            {filtered.length === 0 ? <StatePanel title="No encontramos resultados">Prueba con otro nombre, alias o CLABE enmascarada.</StatePanel> : <section className="beneficiary-list" aria-label="Tus beneficiarios">{filtered.map((item) => <article className="beneficiary-card" key={item.id}><span className="beneficiary-avatar" aria-hidden="true">{item.name.trim().slice(0, 1).toLocaleUpperCase()}</span><div className="beneficiary-details"><h2>{item.name}</h2><p>{item.alias}</p><span className="masked-clabe">CLABE · {item.clabeMasked}</span></div><span className="internal-badge">Cuenta interna</span></article>)}</section>}</>}
  </div></AppShell>;
}

export function NewBeneficiaryPage() {
  const { session, end, hydrated } = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'error' | 'info'; text: string }>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  if (!hydrated) return <AppShell active="beneficiaries"><StatePanel title="Cargando tu sesión">Estamos verificando tu acceso.</StatePanel></AppShell>;
  if (!session) return <Navigate to="/login" replace state={{ from: '/beneficiaries/new' }} />;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setNotice(undefined); setFieldErrors({});
    const form = new FormData(event.currentTarget);
    const rawClabe = String(form.get('clabe') ?? '').replace(/\s/g, '');
    const parsed = beneficiaryInputSchema.safeParse({ name: String(form.get('name') ?? '').trim(), alias: String(form.get('alias') ?? '').trim(), clabe: rawClabe });
    if (!parsed.success) {
      setFieldErrors(Object.fromEntries(parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message])));
      return;
    }
    setBusy(true);
    try {
      const created = await request<Beneficiary>('/beneficiaries', { method: 'POST', body: JSON.stringify(parsed.data) });
      await queryClient.invalidateQueries({ queryKey: ['beneficiaries'] });
      navigate('/beneficiaries', { replace: true, state: { created: created.alias } });
    } catch (error) {
      if (error instanceof ApiError && error.problem.status === 401) { end(); navigate('/session-expired', { replace: true }); return; }
      const status = error instanceof ApiError ? error.problem.status : undefined;
      const errors = serverFieldErrors(error);
      if (status === 409) setNotice({ tone: 'error', text: 'Esta CLABE ya está registrada en tus beneficiarios.' });
      else if (status === 404) setNotice({ tone: 'error', text: 'No encontramos una cuenta interna con esa CLABE. Solo puedes agregar cuentas de Billetera.' });
      else if (status === 400 || status === 422) {
        setFieldErrors(errors);
        setNotice({ tone: 'error', text: Object.keys(errors).length ? 'Revisa los campos indicados.' : errorMessage(error) });
      } else setNotice({ tone: 'error', text: 'No pudimos guardar el beneficiario. Tus datos siguen en el formulario; revisa tu conexión e inténtalo de nuevo.' });
    } finally { setBusy(false); }
  }

  return <AppShell active="beneficiaries"><div className="beneficiary-form-page"><Link className="back-link" to="/beneficiaries">← Volver a beneficiarios</Link><span className="eyebrow">NUEVO BENEFICIARIO</span><h1>Agregar beneficiario</h1><p className="beneficiary-intro">Registra una cuenta de Billetera para encontrarla fácilmente después.</p>
    <form className="beneficiary-form" onSubmit={submit} noValidate>
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      <div className="field"><label htmlFor="name">Nombre del beneficiario</label><input id="name" name="name" autoComplete="name" maxLength={120} required aria-invalid={Boolean(fieldErrors.name)} aria-describedby={fieldErrors.name ? 'name-error' : 'name-help'} />{fieldErrors.name ? <span className="field-error" id="name-error">{fieldErrors.name}</span> : <span className="helper-text" id="name-help">Hasta 120 caracteres.</span>}</div>
      <div className="field"><label htmlFor="alias">Alias</label><input id="alias" name="alias" autoComplete="off" maxLength={80} required aria-invalid={Boolean(fieldErrors.alias)} aria-describedby={fieldErrors.alias ? 'alias-error' : 'alias-help'} />{fieldErrors.alias ? <span className="field-error" id="alias-error">{fieldErrors.alias}</span> : <span className="helper-text" id="alias-help">Un nombre corto para reconocer la cuenta; hasta 80 caracteres.</span>}</div>
      <div className="field"><label htmlFor="clabe">CLABE interbancaria</label><input id="clabe" name="clabe" type="text" inputMode="numeric" autoComplete="off" maxLength={18} pattern="[0-9]{18}" required aria-invalid={Boolean(fieldErrors.clabe)} aria-describedby={fieldErrors.clabe ? 'clabe-error' : 'clabe-help'} />{fieldErrors.clabe ? <span className="field-error" id="clabe-error">{fieldErrors.clabe}</span> : <span className="helper-text" id="clabe-help">18 dígitos. Solo se agregan cuentas internas de Billetera.</span>}</div>
      <div className="privacy-note" role="note"><span aria-hidden="true">◉</span><p>La CLABE se validará con el servicio y se mostrará enmascarada en tu directorio.</p></div>
      <div className="beneficiary-form-actions"><Link className="secondary-button button-link" to="/beneficiaries">Cancelar</Link><button className="primary-button" disabled={busy}>{busy ? <><span className="button-spinner" aria-hidden="true" /> Guardando…</> : <>Guardar beneficiario <span aria-hidden="true">→</span></>}</button></div>
    </form>
  </div></AppShell>;
}
