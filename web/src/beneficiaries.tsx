import { useEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, request } from './api.js';
import { AccessUnavailable, ActionBar, AppShell, FormErrorSummary, StatePanel, initialsOf, PageHeader, type ErrorSummaryItem } from './components.js';
import { Icon } from './icons.js';
import { useSession } from './session.js';
import {
  BENEFICIARY_FIELDS, BENEFICIARY_MESSAGES, beneficiarySaveFailure, clabeDigits, filterBeneficiaries, maskedTail, validateBeneficiary,
  type Beneficiary, type BeneficiaryErrors, type BeneficiaryField, type BeneficiaryInput, type BeneficiaryValues,
} from './beneficiary-form.js';

function loadErrorMessage(error: unknown) {
  if (error instanceof ApiError) return error.problem.detail || error.problem.title;
  return error instanceof Error ? error.message : 'No fue posible completar la solicitud. Inténtalo de nuevo.';
}

/** W06 · references `w06_directorio_de_beneficiarios_1` (list) and `w06_sin_beneficiarios` (empty). */
export function BeneficiariesPage() {
  const { session, end, hydrated } = useSession();
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const location = useLocation();
  const createdAlias = (location.state as { created?: string } | null)?.created;
  const beneficiaries = useQuery({
    queryKey: ['beneficiaries'],
    queryFn: () => request<{ items: Beneficiary[] }>('/beneficiaries'),
  });

  if (!hydrated) return <AppShell active="beneficiaries"><StatePanel tone="loading" title="Cargando tu sesión">Estamos verificando tu acceso.</StatePanel></AppShell>;
  if (!session) return <Navigate to="/login" replace state={{ from: '/beneficiaries' }} />;
  if (beneficiaries.error instanceof ApiError && beneficiaries.error.problem.status === 401) {
    end(true); return <Navigate to="/session-expired" replace />;
  }
  if (beneficiaries.error instanceof ApiError && beneficiaries.error.problem.status === 403) return <AccessUnavailable />;

  const items = beneficiaries.data?.items ?? [];
  const empty = beneficiaries.isSuccess && items.length === 0;
  const filtered = filterBeneficiaries(items, search);
  const searching = search.trim() !== '';
  const clearSearch = () => { setSearch(''); searchRef.current?.focus(); };
  const addLabel = 'Agregar beneficiario';

  let body: ReactNode;
  if (beneficiaries.isPending) {
    body = <section className="bn-grid" aria-label="Cargando beneficiarios" aria-busy="true"><div className="bn-card bn-skeleton" /><div className="bn-card bn-skeleton" /></section>;
  } else if (beneficiaries.error) {
    body = <section className="bn-empty bn-load-error" aria-labelledby="bn-error-title">
      <span className="bn-empty-icon is-error"><Icon name="errorOutlined" size={32} /></span>
      <h2 id="bn-error-title" className="t-headline-md">No pudimos cargar tus beneficiarios</h2>
      <p className="t-body-md" role="alert">{loadErrorMessage(beneficiaries.error)}</p>
      <button type="button" className="btn btn-primary" onClick={() => void beneficiaries.refetch()}><Icon name="restartAlt" size={18} /><span>Intentar de nuevo</span></button>
    </section>;
  } else if (empty) {
    body = <section className="bn-empty" aria-labelledby="bn-empty-title">
      <span className="bn-empty-icon"><Icon name="groupOutlined" size={32} /></span>
      <h2 id="bn-empty-title" className="t-headline-md">Aún no tienes beneficiarios registrados</h2>
      <p className="t-body-md">Registra a tus contactos con cuenta en Billetera MXN para enviarles dinero y tenerlos siempre a la mano.</p>
      <Link className="btn btn-primary bn-empty-cta" to="/beneficiaries/new"><Icon name="personAddOutlined" /><span>{addLabel}</span></Link>
    </section>;
  } else if (filtered.length === 0) {
    body = <section className="bn-empty bn-no-results" aria-labelledby="bn-no-results-title">
      <span className="bn-empty-icon"><Icon name="manageSearch" size={32} /></span>
      <h2 id="bn-no-results-title" className="t-headline-md">No encontramos beneficiarios con esa búsqueda</h2>
      <p className="t-body-md">Prueba con otro nombre, alias o los últimos 4 dígitos de la cuenta.</p>
      <button type="button" className="btn btn-secondary" onClick={clearSearch}><Icon name="restartAlt" size={18} /><span>Limpiar búsqueda</span></button>
    </section>;
  } else {
    body = <section className="bn-grid" aria-label="Tus beneficiarios">
      {filtered.map((item) => <article className="bn-card" key={item.id}>
        <div className="bn-card-head">
          <span className="bn-avatar" aria-hidden="true">{initialsOf(item.name)}</span>
          <div className="bn-card-title">
            <h2 className="t-headline-md">{item.name}</h2>
            <span className="chip chip-neutral bn-alias" title={`Alias: ${item.alias}`}>Alias: {item.alias}</span>
          </div>
        </div>
        <div className="bn-account">
          <p className="t-body-sm">Cuenta destino Billetera MXN</p>
          <p className="t-code-data bn-clabe" data-clabe>•••• {maskedTail(item.clabeMasked)}</p>
        </div>
        <Link className="btn bn-transfer" to={`/transfers/new?beneficiaryId=${encodeURIComponent(item.id)}`} aria-label={`Transferir a ${item.name}`}><span>Transferir</span><Icon name="arrowForward" size={18} /></Link>
      </article>)}
    </section>;
  }

  return <AppShell active="beneficiaries"><div className="bn-page">
    <PageHeader className="bn-header" title="Mis beneficiarios" subtitle="Envía dinero a cuentas registradas en Billetera MXN" />
    {createdAlias && <div className="bn-notice" role="status"><Icon name="checkCircleOutlined" /><p className="t-body-md-medium">Beneficiario “{createdAlias}” agregado.</p></div>}
    {/* D-UX-4: the empty state has a single add CTA (inside its card) and no disabled search bar. */}
    {!empty && <div className="bn-toolbar">
      <div className="bn-search">
        <label className="sr-only" htmlFor="beneficiary-search">Buscar beneficiarios</label>
        <span className="bn-search-field"><Icon name="search" className="bn-search-icon" />
          <input ref={searchRef} id="beneficiary-search" className="t-body-md" type="search" autoComplete="off" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="p. ej. nombre, alias o terminación" disabled={beneficiaries.isPending} aria-controls="bn-results" />
        </span>
      </div>
      <Link className="btn btn-primary bn-add" to="/beneficiaries/new"><Icon name="add" size={18} /><span>{addLabel}</span></Link>
    </div>}
    <div id="bn-results">{body}</div>
    <p className="sr-only" role="status">{searching && beneficiaries.isSuccess ? `${filtered.length} de ${items.length} beneficiarios` : ''}</p>
  </div></AppShell>;
}

type Phase = 'idle' | 'invalid' | 'clabe-checksum' | 'saving' | 'duplicate' | 'not-found' | 'recoverable' | 'server-invalid' | 'forbidden';
type FocusTarget = 'summary' | BeneficiaryField | null;

const FIELD_COPY: Record<BeneficiaryField, { label: string; meta: string; placeholder?: string; help?: string }> = {
  name: { label: 'Nombre completo o razón social', meta: 'Obligatorio', placeholder: 'p. ej. Nombre y apellidos', help: 'Ingresa el nombre tal como está registrado en la cuenta destino.' },
  alias: { label: 'Alias o nombre corto', meta: 'Para identificarlo fácil', placeholder: 'p. ej. Nombre corto' },
  clabe: { label: 'CLABE de 18 dígitos', meta: '', help: '18 dígitos numéricos' },
};

/** Error of one field for the current values (re-validation after the first submit, SPEC §5.5). */
function fieldError(values: BeneficiaryValues, field: BeneficiaryField) {
  const result = validateBeneficiary(values);
  return result.kind === 'valid' ? undefined : result.errors[field];
}

/**
 * W07 · alta de beneficiario (SPEC §5.5, D-UX-5). Validation runs on submit; afterwards each field is re-validated on
 * change and blur. Every outcome (client errors, 400/404/409/422, 5xx, saving) is reported by one summary placed right
 * before the actions; there is no page banner above the card.
 */
export function NewBeneficiaryPage() {
  const { session, end, hydrated } = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<BeneficiaryValues>({ name: '', alias: '', clabe: '' });
  const [errors, setErrors] = useState<BeneficiaryErrors>({});
  const [phase, setPhase] = useState<Phase>('idle');
  const [detail, setDetail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const lastBody = useRef<BeneficiaryInput | null>(null);
  const inFlight = useRef(false);
  const focusNext = useRef<FocusTarget>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const refs: Record<BeneficiaryField, RefObject<HTMLInputElement | null>> = { name: useRef<HTMLInputElement>(null), alias: useRef<HTMLInputElement>(null), clabe: useRef<HTMLInputElement>(null) };

  useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    (target === 'summary' ? summaryRef.current : refs[target].current)?.focus();
  });

  if (!hydrated) return <AppShell active="beneficiaries"><StatePanel tone="loading" title="Cargando tu sesión">Estamos verificando tu acceso.</StatePanel></AppShell>;
  if (!session) return <Navigate to="/login" replace state={{ from: '/beneficiaries/new' }} />;
  if (phase === 'forbidden') return <AccessUnavailable />;

  const saving = phase === 'saving';
  const locked = saving || phase === 'duplicate';

  function update(field: BeneficiaryField, raw: string) {
    const value = field === 'clabe' ? clabeDigits(raw) : raw;
    const next = { ...values, [field]: value };
    setValues(next);
    if (phase === 'invalid' || phase === 'clabe-checksum') {
      // After a submit with errors a field's message follows its value; untouched fields get no new errors.
      const remaining = { ...errors };
      if (remaining[field]) {
        const error = fieldError(next, field);
        if (error) remaining[field] = error; else delete remaining[field];
      }
      setErrors(remaining);
      if (Object.keys(remaining).length === 0) setPhase('idle');
    } else if (phase !== 'idle') { setPhase('idle'); setErrors({}); setDetail(''); }
  }

  function blur(field: BeneficiaryField) {
    if (!submitted || locked || (phase !== 'idle' && phase !== 'invalid' && phase !== 'clabe-checksum')) return;
    const error = fieldError(values, field);
    if ((error ?? '') === (errors[field] ?? '')) return;
    const next = { ...errors };
    if (error) next[field] = error; else delete next[field];
    setErrors(next);
    setPhase(Object.keys(next).length ? (next.clabe === BENEFICIARY_MESSAGES.clabeChecksum && Object.keys(next).length === 1 ? 'clabe-checksum' : 'invalid') : 'idle');
  }

  async function save(body: BeneficiaryInput) {
    if (inFlight.current) return;
    inFlight.current = true;
    lastBody.current = body;
    setErrors({}); setDetail(''); setPhase('saving');
    try {
      const created = await request<Beneficiary>('/beneficiaries', { method: 'POST', body: JSON.stringify(body) });
      await queryClient.invalidateQueries({ queryKey: ['beneficiaries'] });
      navigate('/beneficiaries', { replace: true, state: { created: created.alias } });
    } catch (error) {
      const failure = beneficiarySaveFailure(error);
      if (failure.kind === 'session') { end(true); navigate('/session-expired', { replace: true }); return; }
      if (failure.kind === 'clabe-checksum') { setErrors(failure.errors); setPhase('clabe-checksum'); focusNext.current = 'clabe'; return; }
      if (failure.kind === 'invalid') {
        setErrors(failure.errors);
        if (failure.detail) { setDetail(failure.detail); setPhase('server-invalid'); focusNext.current = 'summary'; }
        else { setPhase('invalid'); focusNext.current = BENEFICIARY_FIELDS.find((field) => failure.errors[field]) ?? 'summary'; }
        return;
      }
      setPhase(failure.kind);
      // FM-04: a server answer about the CLABE (404/409) focuses the CLABE; 5xx/network focuses the summary.
      focusNext.current = failure.kind === 'duplicate' || failure.kind === 'not-found' ? 'clabe' : 'summary';
    } finally { inFlight.current = false; }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || phase === 'duplicate') return;
    setSubmitted(true);
    // W07-F1: «Reintentar guardar» resends exactly the values of the failed attempt (any edit returns to idle).
    if (phase === 'recoverable' && lastBody.current) { void save(lastBody.current); return; }
    const result = validateBeneficiary(values);
    if (result.kind !== 'valid') {
      setErrors(result.errors); setDetail(''); setPhase(result.kind);
      const first = BENEFICIARY_FIELDS.find((field) => result.errors[field]);
      if (first) refs[first].current?.focus();
      return;
    }
    void save(result.body);
  }

  function modify() {
    setPhase('idle'); setErrors({});
    focusNext.current = 'clabe';
  }

  const invalidItems: ErrorSummaryItem[] = BENEFICIARY_FIELDS.filter((name) => errors[name]).map((name) => ({ field: name, label: FIELD_COPY[name].label, message: errors[name]! }));
  const errorCount = invalidItems.length;
  const summary = phase === 'invalid' || phase === 'server-invalid'
    ? <FormErrorSummary id="bn-summary" focusRef={summaryRef} items={invalidItems}
      title={errorCount > 0 ? `Revisa ${errorCount === 1 ? 'el campo señalado' : `los ${errorCount} campos señalados`} antes de continuar` : 'Revisa los campos señalados antes de continuar'}>
      {phase === 'server-invalid' ? detail : 'La información proporcionada contiene datos faltantes o inconsistentes con el formato del sistema.'}
    </FormErrorSummary>
    : phase === 'clabe-checksum'
      ? <FormErrorSummary id="bn-summary" focusRef={summaryRef} items={invalidItems} title="Verifica la información capturada">Se detectó una inconsistencia en la CLABE proporcionada. Corrige el campo señalado antes de continuar.</FormErrorSummary>
      : phase === 'duplicate'
        ? <FormErrorSummary id="bn-summary" focusRef={summaryRef} tone="warning" title="Beneficiario duplicado">Ya tienes registrado un beneficiario con esta misma CLABE.</FormErrorSummary>
        : phase === 'not-found'
          ? <FormErrorSummary id="bn-summary" focusRef={summaryRef} title="Destino no disponible en la plataforma">Esta cuenta no pertenece a Billetera MXN. Revisa la CLABE de 18 dígitos e intenta nuevamente.</FormErrorSummary>
          : phase === 'recoverable'
            ? <FormErrorSummary id="bn-summary" focusRef={summaryRef} title="No pudimos guardar al beneficiario en este momento">Ocurrió un problema de conexión temporal. Conservamos la información ingresada para que puedas reintentar.</FormErrorSummary>
            : null;

  /** Right-hand meta of a field label: neutral hints only (no «valid» states, SPEC §5.5). */
  function meta(field: BeneficiaryField) {
    const id = `${field}-meta`;
    if (field === 'clabe') {
      if (phase === 'duplicate') return <span className="t-body-sm-medium bn-meta is-error" id={id}>Cuenta ya registrada</span>;
      if (phase === 'not-found') return <span className="t-body-sm-medium bn-meta is-error" id={id}>No encontrada</span>;
      return <span className={`t-code-data bn-meta${errors.clabe ? ' is-error' : ''}`} id={id}>{values.clabe.length} / 18</span>;
    }
    return <span className={`t-body-sm bn-meta${errors[field] ? ' is-error' : ''}`} id={id}>{FIELD_COPY[field].meta}</span>;
  }

  function field(name: BeneficiaryField) {
    const copy = FIELD_COPY[name];
    const error = errors[name];
    const duplicateClabe = phase === 'duplicate' && name === 'clabe';
    const unavailableClabe = phase === 'not-found' && name === 'clabe';
    const invalid = Boolean(error) || duplicateClabe || unavailableClabe;
    const describedBy = [
      error ? `${name}-error` : '',
      duplicateClabe ? 'clabe-duplicate' : '',
      unavailableClabe ? 'clabe-unavailable' : '',
      name === 'clabe' ? 'clabe-meta' : '',
      !error && !duplicateClabe && !unavailableClabe && copy.help ? `${name}-help` : '',
    ].filter(Boolean).join(' ') || undefined;
    return <div className={`bn-field${invalid ? ' is-invalid' : ''}`}>
      <div className="bn-field-top">
        <label className={`t-body-sm-medium${invalid ? ' is-error' : ''}`} htmlFor={name}>{copy.label}</label>
        {meta(name)}
      </div>
      <span className="bn-input">
        <input ref={refs[name]} id={name} name={name} type="text" className={name === 'clabe' ? 't-body-md bn-input-clabe' : 't-body-md'} value={values[name]} onChange={(event) => update(name, event.target.value)} onBlur={() => blur(name)} placeholder={copy.placeholder} autoComplete="off" spellCheck={false}
          maxLength={name === 'name' ? 120 : name === 'alias' ? 80 : 18} inputMode={name === 'clabe' ? 'numeric' : undefined} required aria-required="true"
          readOnly={locked} aria-invalid={invalid ? true : undefined} aria-describedby={describedBy} />
        {invalid && <Icon name={duplicateClabe ? 'warning' : 'error'} className="bn-input-icon is-error" />}
      </span>
      {error && <p className="bn-field-error t-body-sm" id={`${name}-error`}><Icon name="error" size={16} /><span>{error}</span></p>}
      {duplicateClabe && <p className="bn-field-error t-body-sm" id="clabe-duplicate"><Icon name="error" size={16} /><span>Esta CLABE ya pertenece a un contacto existente en tu directorio. No es necesario registrarla nuevamente.</span></p>}
      {unavailableClabe && <p className="bn-field-error t-body-sm" id="clabe-unavailable"><Icon name="error" size={16} /><span>Esta cuenta no pertenece a Billetera MXN.</span></p>}
      {!error && !duplicateClabe && !unavailableClabe && copy.help && <p className="t-body-sm bn-help-text" id={`${name}-help`}>{copy.help}</p>}
    </div>;
  }

  // Distinct keys: «Modificar datos» must not be reused as the submit button of the idle actions during the same click.
  const actions = phase === 'duplicate'
    ? <div className="form-footer" key="duplicate-actions">
      <button type="button" className="btn btn-secondary" onClick={modify}><Icon name="edit" /><span>Modificar datos</span></button>
      <ActionBar><Link className="btn btn-primary" to="/beneficiaries"><Icon name="folderShared" /><span>Ver en directorio</span></Link></ActionBar>
    </div>
    : <div className="form-footer" key="form-actions">
      {saving
        ? <button type="button" className="btn btn-outline" disabled aria-describedby="bn-saving-text">Cancelar</button>
        : <Link className="btn btn-outline" to="/beneficiaries">Cancelar</Link>}
      <ActionBar>
        <button type="submit" className="btn btn-primary" disabled={saving} aria-describedby={saving ? 'bn-saving-text' : undefined}>
          {saving ? <><Icon name="spinner" size={18} className="spin" /><span>Guardando beneficiario…</span></>
            : phase === 'recoverable' ? <><Icon name="sync" size={18} /><span>Reintentar guardar</span></>
              : <><Icon name="personAddOutlined" size={18} /><span>Guardar beneficiario</span></>}
        </button>
      </ActionBar>
    </div>;

  return <AppShell active="beneficiaries"><div className="bn-form-page">
    <PageHeader className="bn-form-header" eyebrow={<nav className="bn-breadcrumb t-body-sm" aria-label="Ruta de navegación">
      <Link to="/beneficiaries"><Icon name="arrowBack" size={16} /><span>Beneficiarios</span></Link>
      <span className="bn-breadcrumb-sep" aria-hidden="true">/</span>
      <span className="t-body-sm-medium bn-breadcrumb-current" aria-current="page">Nuevo registro</span>
    </nav>} title="Agregar nuevo beneficiario" subtitle="Registra una cuenta de Billetera MXN para transferir fondos." />
    <div className="bn-form-layout">
      <section className="bn-form-card" aria-label="Datos del beneficiario">
        <p className="bn-info t-body-sm"><Icon name="infoOutlined" size={18} className="bn-info-icon" /><span>Solo se admiten cuentas de Billetera MXN.</span></p>
        <form className="bn-form" onSubmit={submit} noValidate aria-busy={saving}>
          {field('name')}
          {field('alias')}
          {field('clabe')}
          <div className="bn-status-region" role="status">{saving && <div className="form-summary is-progress">
            <span className="form-summary-icon" aria-hidden="true"><Icon name="spinner" size={20} className="spin" /></span>
            <div className="form-summary-body"><p className="t-body-md-medium form-summary-title">Guardando beneficiario…</p><p className="t-body-sm form-summary-text" id="bn-saving-text">Registrando y validando datos en Billetera MXN. Por favor no cierres esta ventana.</p></div>
          </div>}</div>
          {summary}
          {actions}
        </form>
      </section>
      <aside className="bn-help" aria-labelledby="bn-help-title">
        <Icon name="helpOutlined" className="bn-help-icon" />
        <div>
          <h2 className="t-body-sm-medium" id="bn-help-title">¿Cómo es la CLABE interna?</h2>
          <ul className="t-body-sm bn-help-list">
            <li>Son <strong>18 dígitos</strong>, solo números: sin espacios ni guiones.</li>
            <li>3 de banco + 3 de plaza + 11 de cuenta + 1 dígito verificador. Las de Billetera MXN empiezan con <strong>646</strong>.</li>
            <li>Tiene que ser la CLABE de una cuenta que ya exista en Billetera MXN; si no, no se podrá registrar.</li>
          </ul>
          <p className="t-body-sm bn-help-tip"><strong>Para probar la demo:</strong> en Inicio toca «Copiar CLABE» en una de tus cuentas y pégala aquí. Así registras una cuenta propia como beneficiario.</p>
        </div>
      </aside>
    </div>
  </div></AppShell>;
}
