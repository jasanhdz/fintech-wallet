import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, AppState, KeyboardAvoidingView, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import type { ProductComponents } from '@fintech-wallet/shared';

type User = ProductComponents['schemas']['User'];
type Account = ProductComponents['schemas']['Account'];
type AuthResponse = ProductComponents['schemas']['AuthResponse'];
type Beneficiary = ProductComponents['schemas']['Beneficiary'];
type Transfer = ProductComponents['schemas']['Transfer'];
type TransferRequest = ProductComponents['schemas']['TransferCreateRequest'];
type Movement = ProductComponents['schemas']['Movement'];
const REFRESH_KEY = 'wallet.refresh-token';
const TRANSFER_RECOVERY_KEY = 'wallet.transfer-recovery';
const apiBase = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/$/, '');
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000, gcTime: 0 } } });

class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

async function request<T>(path: string, token?: string, init?: RequestInit): Promise<T> {
  if (!apiBase) throw new Error('Configura EXPO_PUBLIC_API_URL para conectar con la API.');
  let response: Response;
  try {
    response = await fetch(`${apiBase}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init?.headers },
    });
  } catch {
    throw new Error('No pudimos conectar. Revisa tu conexión e inténtalo de nuevo.');
  }
  if (!response.ok) {
    let message = response.status === 401 ? 'La sesión expiró. Inicia sesión de nuevo.' : 'Ocurrió un problema. Inténtalo de nuevo.';
    try {
      const problem = await response.json() as { detail?: string; title?: string };
      message = problem.detail || problem.title || message;
    } catch { /* keep safe fallback */ }
    throw new ApiError(response.status, message);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function formatBalance(minor: string): string {
  const value = BigInt(minor);
  const whole = value / 100n;
  const cents = String(value % 100n).padStart(2, '0');
  return `$${whole.toLocaleString('es-MX')}.${cents}`;
}

function Wallet() {
  const [session, setSession] = useState<{ accessToken: string; user: User } | null>(null);
  const [ready, setReady] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [choosingBeneficiary, setChoosingBeneficiary] = useState(false);
  const [beneficiarySearch, setBeneficiarySearch] = useState('');
  const [destination, setDestination] = useState<Beneficiary | null>(null);
  const [transferScreen, setTransferScreen] = useState<'details' | 'review' | 'otp' | 'status' | 'receipt' | 'rejected' | null>(null);
  const [amount, setAmount] = useState('');
  const [concept, setConcept] = useState('');
  const [reference, setReference] = useState('');
  const [transferError, setTransferError] = useState('');
  const [transferBusy, setTransferBusy] = useState(false);
  const [transfer, setTransfer] = useState<Transfer | null>(null);
  const [demoOnlyCode, setDemoOnlyCode] = useState('');
  const [createAttempt, setCreateAttempt] = useState<{ key: string; payload: TransferRequest } | null>(null);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [otp, setOtp] = useState('');
  const [confirmAttempt, setConfirmAttempt] = useState<{ key: string; payload: { code: string } } | null>(null);
  const [movementDetail, setMovementDetail] = useState<Transfer | null>(null);
  const [movementDetailId, setMovementDetailId] = useState('');
  const [movementDetailError, setMovementDetailError] = useState('');
  const [movementDetailBusy, setMovementDetailBusy] = useState(false);
  const [activeTab, setActiveTab] = useState<'home' | 'movements'>('home');
  const client = useQueryClient();

  const refreshSession = useCallback(async (refreshToken: string) => {
    const result = await request<AuthResponse>('/auth/refresh', undefined, {
      method: 'POST', body: JSON.stringify({ client: 'mobile', refreshToken }),
    });
    if (!result.refreshToken) throw new Error('La API no devolvió la sesión móvil renovada.');
    await SecureStore.setItemAsync(REFRESH_KEY, result.refreshToken);
    setSession({ accessToken: result.accessToken, user: result.user });
  }, []);

  const endSession = useCallback(async () => {
    try {
      const refreshToken = await SecureStore.getItemAsync(REFRESH_KEY);
      if (refreshToken) {
        let accessToken = session?.accessToken;
        if (accessToken) {
          try {
            await request<void>('/auth/logout', accessToken, {
              method: 'POST', body: JSON.stringify({ client: 'mobile', refreshToken }),
            });
            return;
          } catch (error) {
            if (!(error instanceof ApiError) || error.status !== 401) return;
          }
        }

        try {
          const refreshed = await request<AuthResponse>('/auth/refresh', undefined, {
            method: 'POST', body: JSON.stringify({ client: 'mobile', refreshToken }),
          });
          accessToken = refreshed.accessToken;
          await request<void>('/auth/logout', accessToken, {
            method: 'POST', body: JSON.stringify({ client: 'mobile', refreshToken: refreshed.refreshToken ?? refreshToken }),
          });
        } catch { /* Logout is best-effort; local secrets are always cleared below. */ }
      }
    } catch { /* SecureStore/network failures must not prevent local logout. */ }
    finally {
      try { await SecureStore.deleteItemAsync(REFRESH_KEY); } catch { /* clear in-memory state regardless */ }
      try { await SecureStore.deleteItemAsync(TRANSFER_RECOVERY_KEY); } catch { /* local logout must complete */ }
      setSession(null);
      setDestination(null);
      setTransfer(null);
      setCreateAttempt(null);
      setConfirmAttempt(null);
      setOtp('');
      setTransferScreen(null);
      setChoosingBeneficiary(false);
      setBeneficiarySearch('');
      setMovementDetail(null);
      setMovementDetailId('');
      setMovementDetailError('');
      setActiveTab('home');
      client.clear();
    }
  }, [client, session?.accessToken]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const token = await SecureStore.getItemAsync(REFRESH_KEY);
        if (token) await refreshSession(token);
      } catch {
        await SecureStore.deleteItemAsync(REFRESH_KEY);
      } finally { if (active) setReady(true); }
    })();
    return () => { active = false; };
  }, [refreshSession]);

  useEffect(() => {
    if (!session || !ready || recoveryReady) return;
    let active = true;
    void (async () => {
      try {
        const stored = await SecureStore.getItemAsync(TRANSFER_RECOVERY_KEY);
        if (!stored || !active) return;
        const attempt = JSON.parse(stored) as { key: string; payload: TransferRequest; transferId?: string };
        setCreateAttempt({ key: attempt.key, payload: attempt.payload });
        setTransferScreen('status');
        if (attempt.transferId) {
          const result = await request<Transfer>(`/transfers/${encodeURIComponent(attempt.transferId)}`, session.accessToken);
          if (!active) return;
          setTransfer(result);
          if (result.status === 'completed' || result.status === 'rejected') {
            setTransferScreen(result.status === 'completed' ? 'receipt' : 'rejected');
            await SecureStore.deleteItemAsync(TRANSFER_RECOVERY_KEY);
          } else {
            setTransferScreen('otp');
            setTransferBusy(true);
            // The demo OTP is intentionally recovered only in memory via the idempotent replay.
            try {
              const replay = await request<Transfer & { demoOnlyCode?: string }>('/transfers', session.accessToken, { method: 'POST', headers: { 'Idempotency-Key': attempt.key }, body: JSON.stringify(attempt.payload) });
              if (!active) return;
              setDemoOnlyCode(replay.demoOnlyCode ?? '');
            } finally { if (active) setTransferBusy(false); }
          }
        } else {
          await submitRecoveredCreate(attempt, session.accessToken);
        }
      } catch (error) {
        if (active) {
          setTransferError(error instanceof Error ? error.message : 'No se pudo recuperar la transferencia.');
          setTransferScreen('status');
        }
      }
      finally { if (active) setRecoveryReady(true); }
    })();
    return () => { active = false; };
  }, [session, ready, recoveryReady]);

  useEffect(() => {
    let previous = AppState.currentState;
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') {
        setHidden(true);
        previous = next;
        return;
      }
      if (previous !== 'active') {
        const token = session?.accessToken;
        if (token) void request<User>('/auth/me', token).catch(async (error: unknown) => {
          if (error instanceof ApiError && error.status === 401) {
            const refresh = await SecureStore.getItemAsync(REFRESH_KEY);
            if (refresh) await refreshSession(refresh).catch(endSession);
            else await endSession();
          }
        });
        setHidden(false);
      }
      previous = next;
    });
    return () => subscription.remove();
  }, [endSession, refreshSession, session?.accessToken]);

  const accountsQuery = useQuery({
    queryKey: ['accounts', session?.user.id],
    queryFn: async () => {
      try { return (await request<{ items: Account[] }>('/accounts', session?.accessToken)).items; }
      catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) throw error;
        const refreshToken = await SecureStore.getItemAsync(REFRESH_KEY);
        if (!refreshToken) { await endSession(); throw error; }
        try {
          const refreshed = await request<AuthResponse>('/auth/refresh', undefined, { method: 'POST', body: JSON.stringify({ client: 'mobile', refreshToken }) });
          if (!refreshed.refreshToken) throw new Error('La API no devolvió la sesión móvil renovada.');
          await SecureStore.setItemAsync(REFRESH_KEY, refreshed.refreshToken);
          setSession({ accessToken: refreshed.accessToken, user: refreshed.user });
          return (await request<{ items: Account[] }>('/accounts', refreshed.accessToken)).items;
        } catch (refreshError) {
          await endSession();
          throw refreshError;
        }
      }
    },
    enabled: Boolean(session && !hidden),
  });
  const accounts = accountsQuery.data ?? [];
  const selected = accounts.find((account) => account.id === selectedId) ?? accounts[0];
  const totalBalanceMinor = accounts.reduce((total, account) => total + BigInt(account.availableBalanceMinor), 0n).toString();
  const movementsQuery = useQuery({
    queryKey: ['movements', session?.user.id, selected?.id],
    queryFn: () => request<{ items: Movement[]; nextCursor?: string | null }>(`/accounts/${encodeURIComponent(selected!.id)}/movements?limit=20`, session?.accessToken),
    enabled: Boolean(session && selected && !hidden && !transferScreen && !movementDetail),
    retry: 0,
  });
  const loadMoreMovements = useCallback(async () => {
    const page = movementsQuery.data;
    if (!selected || !page?.nextCursor || movementsQuery.isFetching) return;
    try {
      const next = await request<{ items: Movement[]; nextCursor?: string | null }>(`/accounts/${encodeURIComponent(selected.id)}/movements?limit=20&cursor=${encodeURIComponent(page.nextCursor)}`, session?.accessToken);
      client.setQueryData(['movements', session?.user.id, selected.id], { items: [...page.items, ...next.items], nextCursor: next.nextCursor });
    } catch (error) {
      client.setQueryData(['movements', session?.user.id, selected.id], { ...page, loadMoreError: error instanceof Error ? error.message : 'No se pudo cargar más movimientos.' });
    }
  }, [client, movementsQuery.data, movementsQuery.isFetching, selected, session?.accessToken, session?.user.id]);
  async function openMovement(movement: Movement) {
    if (!session || !movement.transferId) return;
    setMovementDetailId(movement.transferId);
    setMovementDetailBusy(true); setMovementDetailError('');
    try { setMovementDetail(await request<Transfer>(`/transfers/${encodeURIComponent(movement.transferId)}`, session.accessToken)); }
    catch (error) { setMovementDetailError(error instanceof Error ? error.message : 'No se pudo cargar el comprobante.'); }
    finally { setMovementDetailBusy(false); }
  }
  const amountMinor = amountToMinor(amount);
  const transferPayload: TransferRequest | null = destination && selected && amountMinor && concept.trim() && reference
    ? { sourceAccountId: selected.id, destinationType: 'beneficiary', beneficiaryId: destination.id, amountMinor, concept: concept.trim(), reference }
    : null;

  async function submitCreate(retry = false) {
    if (!session || transferBusy) return;
    const attempt = retry && createAttempt ? createAttempt : transferPayload ? { key: newIdempotencyKey(), payload: transferPayload } : null;
    if (!attempt) return;
    if (!retry) {
      setCreateAttempt(attempt);
      await SecureStore.setItemAsync(TRANSFER_RECOVERY_KEY, JSON.stringify(attempt));
    }
    setTransferBusy(true); setTransferError(''); setTransferScreen('status');
    try {
      const result = await request<Transfer>('/transfers', session.accessToken, { method: 'POST', headers: { 'Idempotency-Key': attempt.key }, body: JSON.stringify(attempt.payload) });
      setDemoOnlyCode((result as Transfer & { demoOnlyCode?: string }).demoOnlyCode ?? '');
      const finalResult = result.status === 'completed' ? await request<Transfer>(`/transfers/${result.id}`, session.accessToken) : result;
      setTransfer(finalResult);
      if (finalResult.id) await SecureStore.setItemAsync(TRANSFER_RECOVERY_KEY, JSON.stringify({ ...attempt, transferId: finalResult.id }));
      if (finalResult.status === 'completed' || finalResult.status === 'rejected') await SecureStore.deleteItemAsync(TRANSFER_RECOVERY_KEY);
      setTransferScreen(finalResult.status === 'awaiting_confirmation' ? 'otp' : finalResult.status === 'rejected' ? 'rejected' : 'receipt');
    } catch (error) {
      setTransferError(error instanceof Error ? error.message : 'No se pudo confirmar el resultado.');
      setTransferScreen(error instanceof ApiError && error.status >= 400 && error.status < 500 ? 'rejected' : 'status');
    } finally { setTransferBusy(false); }
  }

  async function submitRecoveredCreate(attempt: { key: string; payload: TransferRequest }, accessToken: string) {
    setTransferScreen('status');
    setTransferBusy(true);
    try {
      const result = await request<Transfer>('/transfers', accessToken, { method: 'POST', headers: { 'Idempotency-Key': attempt.key }, body: JSON.stringify(attempt.payload) });
      if (!result.id) return;
      setDemoOnlyCode((result as Transfer & { demoOnlyCode?: string }).demoOnlyCode ?? '');
      await SecureStore.setItemAsync(TRANSFER_RECOVERY_KEY, JSON.stringify({ ...attempt, transferId: result.id }));
      const finalResult = result.status === 'completed' ? await request<Transfer>(`/transfers/${result.id}`, accessToken) : result;
      setTransfer(finalResult);
      if (finalResult.status === 'completed' || finalResult.status === 'rejected') await SecureStore.deleteItemAsync(TRANSFER_RECOVERY_KEY);
      setTransferScreen(finalResult.status === 'awaiting_confirmation' ? 'otp' : finalResult.status === 'rejected' ? 'rejected' : 'receipt');
    } catch (error) { setTransferError(error instanceof Error ? error.message : 'No se pudo recuperar la transferencia.'); setTransferScreen('status'); }
    finally { setTransferBusy(false); }
  }

  async function confirmOtp(retry = false) {
    if (!session || !transfer || transferBusy) return;
    const attempt = retry && confirmAttempt ? confirmAttempt : { key: newIdempotencyKey(), payload: { code: otp } };
    if (!retry) setConfirmAttempt(attempt);
    setTransferBusy(true); setTransferError('');
    try {
      const result = await request<Transfer>(`/transfers/${transfer.id}/confirm`, session.accessToken, { method: 'POST', headers: { 'Idempotency-Key': attempt.key }, body: JSON.stringify(attempt.payload) });
      const finalResult = result.status === 'completed' ? await request<Transfer>(`/transfers/${result.id}`, session.accessToken) : result;
      setTransfer(finalResult); setConfirmAttempt(null); setOtp('');
      if (finalResult.status === 'completed' || finalResult.status === 'rejected') await SecureStore.deleteItemAsync(TRANSFER_RECOVERY_KEY);
      setTransferScreen(finalResult.status === 'rejected' ? 'rejected' : finalResult.status === 'awaiting_confirmation' ? 'otp' : 'receipt');
    } catch (error) {
      setTransferError(error instanceof Error ? error.message : 'No se pudo confirmar el resultado.');
    } finally { setTransferBusy(false); }
  }

  async function checkTransferStatus() {
    if (!session || !transfer) return;
    setTransferBusy(true); setTransferError('');
    try {
      const result = await request<Transfer>(`/transfers/${transfer.id}`, session.accessToken);
      setTransfer(result);
      setTransferScreen(result.status === 'completed' ? 'receipt' : result.status === 'rejected' ? 'rejected' : 'otp');
    } catch (error) { setTransferError(error instanceof Error ? error.message : 'No se pudo consultar el estado.'); }
    finally { setTransferBusy(false); }
  }

  function resetTransfer() {
    void SecureStore.deleteItemAsync(TRANSFER_RECOVERY_KEY);
    setTransferScreen(null); setAmount(''); setConcept(''); setReference(''); setTransfer(null); setCreateAttempt(null); setConfirmAttempt(null); setOtp(''); setTransferError(''); setDemoOnlyCode('');
  }
  const beneficiariesQuery = useQuery({
    queryKey: ['beneficiaries', session?.user.id],
    queryFn: async () => {
      try { return (await request<{ items: Beneficiary[] }>('/beneficiaries', session?.accessToken)).items; }
      catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) throw error;
        const refreshToken = await SecureStore.getItemAsync(REFRESH_KEY);
        if (!refreshToken) { await endSession(); throw error; }
        try {
          const refreshed = await request<AuthResponse>('/auth/refresh', undefined, { method: 'POST', body: JSON.stringify({ client: 'mobile', refreshToken }) });
          if (!refreshed.refreshToken) throw new Error('La API no devolvió la sesión móvil renovada.');
          await SecureStore.setItemAsync(REFRESH_KEY, refreshed.refreshToken);
          setSession({ accessToken: refreshed.accessToken, user: refreshed.user });
          return (await request<{ items: Beneficiary[] }>('/beneficiaries', refreshed.accessToken)).items;
        } catch (refreshError) { await endSession(); throw refreshError; }
      }
    },
    enabled: Boolean(session && choosingBeneficiary && !hidden),
  });
  const beneficiaries = beneficiariesQuery.data ?? [];
  const normalizedSearch = beneficiarySearch.trim().toLocaleLowerCase('es-MX');
  const filteredBeneficiaries = beneficiaries.filter((beneficiary) =>
    [beneficiary.name, beneficiary.alias, beneficiary.clabeMasked].some((value) => value.toLocaleLowerCase('es-MX').includes(normalizedSearch)),
  );

  async function login() {
    setFormError('');
    if (!/^\S+@\S+\.\S+$/.test(email.trim()) || !password) {
      setFormError('Ingresa un correo válido y tu contraseña.');
      return;
    }
    setSubmitting(true);
    try {
      const result = await request<AuthResponse>('/auth/login', undefined, {
        method: 'POST', body: JSON.stringify({ email: email.trim(), password, client: 'mobile' }),
      });
      if (!result.refreshToken) throw new Error('La API no devolvió una sesión móvil válida.');
      await SecureStore.setItemAsync(REFRESH_KEY, result.refreshToken);
      setSession({ accessToken: result.accessToken, user: result.user });
      setPassword('');
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'No fue posible iniciar sesión.');
    } finally { setSubmitting(false); }
  }

  if (!ready) return <Centered><ActivityIndicator color={colors.primary} /><Text style={styles.muted}>Preparando sesión segura…</Text></Centered>;
  if (hidden) return <PrivacyScreen />;
  if (!session) return <LoginScreen email={email} password={password} setEmail={setEmail} setPassword={setPassword} passwordVisible={passwordVisible} setPasswordVisible={setPasswordVisible} error={formError} submitting={submitting} onSubmit={() => void login()} />;

  if (transferScreen) return <TransferFlow screen={transferScreen} amount={amount} setAmount={setAmount} concept={concept} setConcept={setConcept} reference={reference} setReference={setReference} otp={otp} setOtp={setOtp} destination={destination} source={selected} transfer={transfer} demoOnlyCode={demoOnlyCode} error={transferError} busy={transferBusy} createRetry={Boolean(createAttempt && transferScreen === 'status' && !transfer)} confirmRetry={Boolean(confirmAttempt)} onBack={() => setTransferScreen(transferScreen === 'review' ? 'details' : 'review')} onReview={() => { setTransferError(''); setTransferScreen('review'); }} onCreate={() => void submitCreate()} onRetryCreate={() => void submitCreate(true)} onConfirm={() => void confirmOtp()} onRetryConfirm={() => void confirmOtp(true)} onCheck={() => void checkTransferStatus()} onDone={resetTransfer} />;

  if (movementDetailBusy || movementDetailError) return <View style={styles.page}><View style={styles.flowContent}><Pressable accessibilityRole="button" accessibilityLabel="Volver a movimientos" style={styles.backButton} onPress={() => { setMovementDetailError(''); setMovementDetailBusy(false); setMovementDetailId(''); }}><Ionicons name="arrow-back" size={22} color={colors.primary}/><Text style={styles.link}>Movimientos</Text></Pressable>{movementDetailBusy ? <Centered><ActivityIndicator color={colors.primary}/><Text style={styles.muted}>Cargando comprobante…</Text></Centered> : <View style={styles.notice}><Text accessibilityRole="alert" style={styles.errorText}>{movementDetailError}</Text><Button title="Reintentar" onPress={() => { const item = movementsQuery.data?.items.find((movement) => movement.transferId === movementDetailId); if (item) void openMovement(item); }}/></View>}</View></View>;
  if (movementDetail) return <MovementReceipt transfer={movementDetail} onBack={() => { setMovementDetail(null); setMovementDetailId(''); setMovementDetailError(''); }} />;

  if (activeTab === 'movements') return <MovementListScreen account={selected} movements={movementsQuery.data?.items ?? []} pending={movementsQuery.isPending} error={movementsQuery.error instanceof Error ? movementsQuery.error.message : ''} hasMore={Boolean(movementsQuery.data?.nextCursor)} loadingMore={movementsQuery.isFetching} onRetry={() => void movementsQuery.refetch()} onLoadMore={() => void loadMoreMovements()} onOpen={openMovement} onSelectAccount={setSelectedId} accounts={accounts} onNavigate={setActiveTab} />;

  if (choosingBeneficiary) return <BeneficiaryPickerScreen queryPending={beneficiariesQuery.isPending} error={beneficiariesQuery.error instanceof Error ? beneficiariesQuery.error.message : ''} beneficiaries={filteredBeneficiaries} total={beneficiaries.length} search={beneficiarySearch} setSearch={setBeneficiarySearch} onRetry={() => void beneficiariesQuery.refetch()} onClose={() => setChoosingBeneficiary(false)} onChoose={(beneficiary) => { setDestination(beneficiary); setChoosingBeneficiary(false); }} />;

  return <View style={styles.page}>
    <StatusBar barStyle="dark-content" />
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.topbar}><View><Text style={styles.brand}>Billetera MXN</Text><Text style={styles.eyebrow}>INICIO</Text></View><View style={styles.avatar}><Text style={styles.avatarText}>{initials(session.user.fullName)}</Text></View></View>
      <View style={styles.greeting}><View><Text style={styles.title}>Hola, {session.user.fullName.split(' ')[0]}</Text><Text style={styles.muted}>Tus cuentas y saldos</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Cerrar sesión" style={styles.iconButton} onPress={() => void endSession()}><Ionicons name="log-out-outline" size={25} color={colors.text} /></Pressable></View>
       {destination ? <View style={styles.destinationCard}><View style={styles.destinationIcon}><Ionicons name="person-outline" size={22} color={colors.primary} /></View><View style={{ flex: 1 }}><Text style={styles.tag}>DESTINO SELECCIONADO</Text><Text style={styles.rowTitle}>{destination.name}</Text><Text style={styles.muted}>{destination.alias} · {destination.clabeMasked}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Cambiar beneficiario" onPress={() => setChoosingBeneficiary(true)}><Text style={styles.link}>Cambiar</Text></Pressable></View> : <Pressable accessibilityRole="button" accessibilityLabel="Elegir beneficiario" style={styles.transferEntry} onPress={() => { setChoosingBeneficiary(true); setBeneficiarySearch(''); }}><View style={styles.accountIcon}><Ionicons name="send-outline" size={22} color={colors.primary} /></View><View style={{ flex: 1 }}><Text style={styles.rowTitle}>Elegir beneficiario</Text><Text style={styles.muted}>Selecciona un destino registrado en web</Text></View><Ionicons name="chevron-forward" size={22} color={colors.primary} /></Pressable>}
       {destination && !choosingBeneficiary && <Button title="Continuar con transferencia" disabled={!selected} onPress={() => { setTransferScreen('details'); setTransferError(''); }} />}
      {choosingBeneficiary && <View style={styles.beneficiarySection}>
        <View style={styles.beneficiaryHeader}><View><Text style={styles.sectionTitle}>Elige a quién enviar</Text><Text style={styles.muted}>Beneficiarios guardados desde la web</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Cerrar selección" onPress={() => setChoosingBeneficiary(false)}><Ionicons name="close" size={24} color={colors.muted} /></Pressable></View>
        <View style={styles.searchWrap}><Ionicons name="search" size={20} color={colors.muted} /><TextInput accessibilityLabel="Buscar beneficiario" value={beneficiarySearch} onChangeText={setBeneficiarySearch} placeholder="Nombre, alias o CLABE" placeholderTextColor={colors.placeholder} autoCapitalize="none" style={styles.input} /></View>
        {beneficiariesQuery.isPending ? <Centered><ActivityIndicator color={colors.primary} /><Text style={styles.muted}>Cargando beneficiarios…</Text></Centered> : beneficiariesQuery.isError ? <View style={styles.notice}><Ionicons name="cloud-offline-outline" size={22} color={colors.error} /><Text style={styles.errorText}>{beneficiariesQuery.error.message || 'No hay conexión. Revisa tu conexión e inténtalo de nuevo.'}</Text><Button title="Reintentar" onPress={() => void beneficiariesQuery.refetch()} /></View> : beneficiaries.length === 0 ? <View style={styles.emptyState}><Ionicons name="people-outline" size={28} color={colors.primary} /><Text style={styles.sectionTitle}>Aún no tienes beneficiarios</Text><Text style={styles.muted}>Agrega beneficiarios desde la versión web para poder seleccionarlos aquí.</Text></View> : filteredBeneficiaries.length === 0 ? <View style={styles.emptyState}><Text style={styles.sectionTitle}>Sin resultados</Text><Text style={styles.muted}>Prueba con otro nombre, alias o CLABE.</Text></View> : <View style={styles.listCard}>{filteredBeneficiaries.map((beneficiary, index) => <Pressable key={beneficiary.id} accessibilityRole="button" accessibilityLabel={`Seleccionar ${beneficiary.name}, ${beneficiary.alias}, CLABE ${beneficiary.clabeMasked}`} onPress={() => { setDestination(beneficiary); setChoosingBeneficiary(false); }} style={[styles.accountRow, index > 0 && styles.divider]}><View style={styles.accountIcon}><Ionicons name="person-outline" size={21} color={colors.primary} /></View><View style={{ flex: 1 }}><Text style={styles.rowTitle}>{beneficiary.name}</Text><Text style={styles.muted}>{beneficiary.alias} · {beneficiary.clabeMasked}</Text></View><Ionicons name="chevron-forward" size={20} color={colors.primary} /></Pressable>)}</View>}
        {beneficiariesQuery.isError ? <Text style={styles.offlineHint}>Comprueba tu conexión para volver a cargar la lista.</Text> : null}
      </View>}
      {accountsQuery.isPending ? <Centered><ActivityIndicator color={colors.primary} /><Text style={styles.muted}>Cargando tus cuentas…</Text></Centered> : accountsQuery.isError ? <View style={styles.notice}><Ionicons name="cloud-offline-outline" size={22} color={colors.error} /><Text style={styles.errorText}>{accountsQuery.error.message}</Text><Button title="Reintentar" onPress={() => void accountsQuery.refetch()} /></View> : accounts.length === 0 ? <View style={styles.notice}><Text style={styles.sectionTitle}>Aún no tienes cuentas</Text><Text style={styles.muted}>Cuando haya una cuenta disponible, aparecerá aquí.</Text></View> : <>
        <View style={styles.accountTabs}>{accounts.map((account) => <Pressable key={account.id} accessibilityRole="button" accessibilityState={{ selected: selected?.id === account.id }} style={[styles.tab, selected?.id === account.id && styles.tabSelected]} onPress={() => setSelectedId(account.id)}><Text numberOfLines={1} style={[styles.tabText, selected?.id === account.id && styles.tabTextSelected]}>{account.name}</Text></Pressable>)}</View>
        {selected && <View style={styles.balanceCard}><Text style={styles.label}>Saldo total</Text><View style={styles.balanceLine}><Text adjustsFontSizeToFit numberOfLines={1} style={styles.balance}>{formatBalance(totalBalanceMinor)}</Text><Text style={styles.currency}> MXN</Text></View><View style={styles.balanceDivider}/><View style={styles.accountLabel}><Text style={styles.tag}>{selected.kind === 'checking' ? 'CUENTA PRINCIPAL' : 'CUENTA DE AHORRO'}</Text><Text style={styles.muted}>{selected.clabeMasked}</Text></View><Text style={styles.muted}>Disponible en {selected.name}</Text><View style={styles.selectedBalanceLine}><Text adjustsFontSizeToFit numberOfLines={1} style={styles.selectedBalance}>{formatBalance(selected.availableBalanceMinor)}</Text><Text style={styles.currency}> MXN</Text></View></View>}
         <View style={styles.notice}><Ionicons name="time-outline" size={23} color={colors.primary} /><View style={{ flex: 1 }}><Text style={styles.sectionTitle}>Saldo actualizado</Text><Text style={styles.muted}>Consulta el saldo disponible de tu cuenta.</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Actualizar cuentas" hitSlop={10} onPress={() => void accountsQuery.refetch()}><Ionicons name="refresh" size={21} color={colors.primary} /></Pressable></View>
         <View style={styles.activityHeader}><Text style={styles.sectionTitle}>Movimientos recientes</Text><Text style={styles.eyebrow}>ÚLTIMOS 20</Text></View>
         {movementsQuery.isPending ? <Centered><ActivityIndicator color={colors.primary} /><Text style={styles.muted}>Cargando movimientos…</Text></Centered> : movementsQuery.isError ? <View style={styles.notice}><Ionicons name="cloud-offline-outline" size={22} color={colors.error} /><View style={{ flex: 1 }}><Text style={styles.errorText}>{movementsQuery.error.message || 'Sin conexión. Revisa tu conexión e inténtalo de nuevo.'}</Text><Button title="Reintentar" onPress={() => void movementsQuery.refetch()} /></View></View> : (movementsQuery.data?.items.length ?? 0) === 0 ? <View style={styles.emptyState}><Ionicons name="receipt-outline" size={28} color={colors.primary} /><Text style={styles.sectionTitle}>Aún no hay movimientos</Text><Text style={styles.muted}>Los movimientos de esta cuenta aparecerán aquí.</Text></View> : <View style={styles.listCard}>{movementsQuery.data?.items.map((movement, index) => <Pressable key={movement.id} accessibilityRole="button" accessibilityLabel={`${movement.type === 'debit' ? 'Cargo' : 'Abono'} ${formatBalance(movement.amountMinor)} pesos, ${movement.concept}`} onPress={() => void openMovement(movement)} style={[styles.accountRow, index > 0 && styles.divider]}><View style={styles.accountIcon}><Ionicons name={movement.type === 'debit' ? 'arrow-up-outline' : 'arrow-down-outline'} size={21} color={colors.primary} /></View><View style={{ flex: 1 }}><Text style={styles.rowTitle}>{movement.concept}</Text><Text style={styles.muted}>{new Date(movement.occurredAt).toLocaleString('es-MX')} · {movement.status === 'completed' ? 'Completado' : movement.status === 'processing' ? 'En proceso' : 'Rechazado'}</Text></View><Text style={styles.rowBalance}>{movement.type === 'debit' ? '−' : '+'}{formatBalance(movement.amountMinor)}</Text></Pressable>)}{movementsQuery.data?.nextCursor ? <View style={styles.loadMore}><Button title={movementsQuery.isFetching ? 'Cargando…' : 'Cargar más movimientos'} disabled={movementsQuery.isFetching} onPress={() => void loadMoreMovements()} />{'loadMoreError' in (movementsQuery.data ?? {}) ? <Text accessibilityRole="alert" style={styles.errorText}>{String((movementsQuery.data as typeof movementsQuery.data & { loadMoreError?: string })?.loadMoreError)}</Text> : null}</View> : null}</View>}
        <View style={styles.activityHeader}><Text style={styles.sectionTitle}>Tus cuentas</Text><Text style={styles.eyebrow}>{accounts.length} {accounts.length === 1 ? 'CUENTA' : 'CUENTAS'}</Text></View>
        <View style={styles.listCard}>{accounts.map((account, index) => <Pressable key={account.id} accessibilityRole="button" accessibilityLabel={`${account.name}, saldo ${formatBalance(account.availableBalanceMinor)} pesos`} accessibilityState={{ selected: selected?.id === account.id }} onPress={() => setSelectedId(account.id)} style={[styles.accountRow, index > 0 && styles.divider]}><View style={styles.accountIcon}><Ionicons name={account.kind === 'checking' ? 'wallet-outline' : 'bookmark-outline'} size={22} color={colors.primary} /></View><View style={{ flex: 1 }}><Text style={styles.rowTitle}>{account.name}</Text><Text style={styles.muted}>{account.clabeMasked} · MXN</Text></View><Text style={styles.rowBalance}>{formatBalance(account.availableBalanceMinor)}</Text></Pressable>)}</View>
      </>}
     </ScrollView>
     <BottomNavigation active="home" onChange={setActiveTab}/>
   </View>;
}

function MovementListScreen(props: { account: Account | undefined; accounts: Account[]; movements: Movement[]; pending: boolean; error: string; hasMore: boolean; loadingMore: boolean; onRetry: () => void; onLoadMore: () => void; onOpen: (movement: Movement) => void; onSelectAccount: (id: string) => void; onNavigate: (tab: 'home' | 'movements') => void }) {
  const groups = props.movements.reduce<Record<string, Movement[]>>((result, movement) => {
    const date = new Date(movement.occurredAt);
    const key = date.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
    (result[key] ??= []).push(movement);
    return result;
  }, {});
  return <View style={styles.page}><StatusBar barStyle="dark-content"/><ScrollView contentContainerStyle={styles.content}>
    <View style={styles.topbar}><View><Text style={styles.brand}>Billetera MXN</Text><Text style={styles.eyebrow}>MOVIMIENTOS</Text></View><View style={styles.avatar}><Text style={styles.avatarText}>MX</Text></View></View>
    {props.account && <View style={styles.movementAccountCard}><View style={styles.accountIcon}><Ionicons name="business-outline" size={24} color={colors.primary}/></View><View style={{ flex: 1 }}><Text style={styles.rowTitle}>{props.account.name}</Text><Text style={styles.muted}>{props.account.clabeMasked} · MXN</Text></View><View style={styles.movementBalance}><Text style={styles.eyebrow}>SALDO DISPONIBLE</Text><Text adjustsFontSizeToFit numberOfLines={1} style={styles.rowBalance}>{formatBalance(props.account.availableBalanceMinor)}</Text></View></View>}
    {props.accounts.length > 1 && <View style={styles.accountTabs}>{props.accounts.map((account) => <Pressable key={account.id} accessibilityRole="button" accessibilityState={{ selected: account.id === props.account?.id }} style={[styles.tab, account.id === props.account?.id && styles.tabSelected]} onPress={() => props.onSelectAccount(account.id)}><Text style={[styles.tabText, account.id === props.account?.id && styles.tabTextSelected]}>{account.name}</Text></Pressable>)}</View>}
    <View style={styles.activityHeader}><Text style={styles.title}>Últimos movimientos</Text><Text style={styles.muted}>{props.movements.length} {props.movements.length === 1 ? 'transacción' : 'transacciones'}</Text></View>
    {props.pending ? <Centered><ActivityIndicator color={colors.primary}/><Text style={styles.muted}>Cargando movimientos…</Text></Centered> : props.error ? <View style={styles.emptyState}><Ionicons name="cloud-offline-outline" size={28} color={colors.error}/><Text style={styles.errorText}>{props.error}</Text><Button title="Reintentar" onPress={props.onRetry}/></View> : props.movements.length === 0 ? <View style={styles.emptyState}><Ionicons name="receipt-outline" size={28} color={colors.primary}/><Text style={styles.sectionTitle}>Aún no hay movimientos</Text><Text style={styles.muted}>Los movimientos de esta cuenta aparecerán aquí.</Text></View> : Object.entries(groups).map(([date, entries]) => <View key={date} style={styles.movementGroup}><View style={styles.movementGroupHeading}><Text style={styles.tag}>{date.toLocaleUpperCase('es-MX')}</Text><Text style={styles.muted}>{entries.length} {entries.length === 1 ? 'transacción' : 'transacciones'}</Text></View><View style={styles.listCard}>{entries.map((movement, index) => <Pressable key={movement.id} accessibilityRole="button" accessibilityLabel={`${movement.type === 'debit' ? 'Cargo' : 'Abono'} ${formatBalance(movement.amountMinor)} pesos, ${movement.concept}`} onPress={() => props.onOpen(movement)} style={[styles.movementRow, index > 0 && styles.divider]}><View style={[styles.accountIcon, movement.type === 'credit' && styles.creditIcon]}><Ionicons name={movement.type === 'debit' ? 'arrow-up-outline' : 'arrow-down-outline'} size={21} color={movement.type === 'debit' ? colors.primary : colors.success}/></View><View style={styles.movementCopy}><Text numberOfLines={1} style={styles.rowTitle}>{movement.concept}</Text><Text numberOfLines={1} style={styles.muted}>{movement.type === 'debit' ? 'Cargo' : 'Abono'} · {movement.status === 'completed' ? 'Completado' : movement.status === 'processing' ? 'En proceso' : 'Rechazado'}</Text><Text style={styles.muted}>{new Date(movement.occurredAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</Text></View><Text adjustsFontSizeToFit numberOfLines={1} style={[styles.rowBalance, movement.type === 'credit' && styles.creditAmount]}>{movement.type === 'debit' ? '−' : '+'}{formatBalance(movement.amountMinor)}<Text style={styles.currency}> MXN</Text></Text></Pressable>)}</View></View>)}
    {props.hasMore && <Button title={props.loadingMore ? 'Cargando…' : 'Cargar más movimientos'} disabled={props.loadingMore} onPress={props.onLoadMore}/>}
  </ScrollView><BottomNavigation active="movements" onChange={props.onNavigate}/></View>;
}

function BottomNavigation({ active, onChange }: { active: 'home' | 'movements'; onChange: (tab: 'home' | 'movements') => void }) {
  return <View style={styles.bottomNavigation}>{(['home', 'movements'] as const).map((tab) => <Pressable key={tab} accessibilityRole="tab" accessibilityState={{ selected: active === tab }} onPress={() => onChange(tab)} style={styles.navigationItem}><Ionicons name={tab === 'home' ? 'wallet-outline' : 'receipt-outline'} size={24} color={active === tab ? colors.primary : colors.muted}/><Text style={[styles.navigationLabel, active === tab && styles.navigationLabelActive]}>{tab === 'home' ? 'Inicio' : 'Movimientos'}</Text></Pressable>)}</View>;
}

function BeneficiaryPickerScreen(props: { queryPending: boolean; error: string; beneficiaries: Beneficiary[]; total: number; search: string; setSearch: (value: string) => void; onRetry: () => void; onClose: () => void; onChoose: (beneficiary: Beneficiary) => void }) {
  return <View style={styles.page}><StatusBar barStyle="dark-content"/><ScrollView contentContainerStyle={styles.pickerContent} keyboardShouldPersistTaps="handled">
    <Pressable accessibilityRole="button" accessibilityLabel="Volver a inicio" style={styles.backButton} onPress={props.onClose}><Ionicons name="arrow-back" size={22} color={colors.primary}/><Text style={styles.link}>Transferir</Text></Pressable>
    <Text style={styles.flowTitle}>Elegir beneficiario</Text><Text style={[styles.muted, styles.pickerDescription]}>Selecciona la cuenta destino para enviar fondos.</Text>
    <View style={styles.searchWrap}><Ionicons name="search" size={21} color={colors.muted}/><TextInput accessibilityLabel="Buscar beneficiario" value={props.search} onChangeText={props.setSearch} placeholder="Buscar por nombre o alias…" placeholderTextColor={colors.placeholder} autoCapitalize="none" style={styles.input}/></View>
    <View style={styles.pickerMeta}><Text style={styles.eyebrow}>CONTACTOS DISPONIBLES</Text><Text style={styles.muted}>{props.beneficiaries.length}</Text></View>
    {props.queryPending ? <Centered><ActivityIndicator color={colors.primary}/><Text style={styles.muted}>Cargando beneficiarios…</Text></Centered> : props.error ? <View style={styles.emptyState}><Ionicons name="cloud-offline-outline" size={28} color={colors.error}/><Text style={styles.errorText}>{props.error}</Text><Button title="Reintentar" onPress={props.onRetry}/></View> : props.total === 0 ? <View style={styles.emptyState}><View style={styles.accountIcon}><Ionicons name="people-outline" size={24} color={colors.primary}/></View><Text style={styles.sectionTitle}>No tienes beneficiarios guardados</Text><Text style={[styles.muted, styles.center]}>Los beneficiarios se registran y administran únicamente desde la versión web.</Text></View> : props.beneficiaries.length === 0 ? <View style={styles.emptyState}><Text style={styles.sectionTitle}>Sin resultados</Text><Text style={styles.muted}>Prueba con otro nombre o alias.</Text></View> : props.beneficiaries.map((beneficiary) => <Pressable key={beneficiary.id} accessibilityRole="button" accessibilityLabel={`Seleccionar ${beneficiary.name}, ${beneficiary.alias}, CLABE ${beneficiary.clabeMasked}`} onPress={() => props.onChoose(beneficiary)} style={styles.beneficiaryCard}><View style={styles.beneficiaryAvatar}><Text style={styles.beneficiaryInitials}>{initials(beneficiary.name)}</Text></View><View style={styles.summaryCopy}><Text numberOfLines={1} style={styles.rowTitle}>{beneficiary.name}</Text><Text style={styles.muted}>{beneficiary.alias}</Text><Text style={styles.muted}>{beneficiary.clabeMasked}</Text></View><Ionicons name="chevron-forward" size={22} color={colors.muted}/></Pressable>)}
    <View style={styles.pickerFooter}><Ionicons name="information-circle-outline" size={20} color={colors.muted}/><Text style={[styles.muted, { flex: 1 }]}>Los beneficiarios se registran y administran únicamente desde la versión web.</Text></View>
  </ScrollView></View>;
}

function LoginScreen(props: { email: string; password: string; setEmail: (value: string) => void; setPassword: (value: string) => void; passwordVisible: boolean; setPasswordVisible: (value: boolean) => void; error: string; submitting: boolean; onSubmit: () => void }) {
  return <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><StatusBar barStyle="dark-content" /><ScrollView contentContainerStyle={styles.loginContent} keyboardShouldPersistTaps="handled">
    <View style={styles.loginBrand}><View style={styles.walletMark}><Ionicons name="wallet-outline" size={28} color={colors.primary} /></View><Text style={styles.eyebrow}>BILLETERA MXN</Text><Text style={styles.loginTitle}>Inicia sesión</Text><Text style={styles.loginSubtitle}>Ingresa con tu correo y contraseña registrados en el panel web.</Text></View>
    <View style={styles.formCard}><Text style={styles.label}>Correo electrónico</Text><View style={styles.inputWrap}><Ionicons name="mail-outline" size={20} color={colors.muted} /><TextInput accessibilityLabel="Correo electrónico" autoCapitalize="none" autoComplete="email" keyboardType="email-address" returnKeyType="next" value={props.email} onChangeText={props.setEmail} placeholder="tu@correo.com" placeholderTextColor={colors.placeholder} style={styles.input} /></View><Text style={[styles.label, { marginTop: 18 }]}>Contraseña</Text><View style={styles.inputWrap}><Ionicons name="lock-closed-outline" size={20} color={colors.muted} /><TextInput accessibilityLabel="Contraseña" autoCapitalize="none" autoComplete="password" secureTextEntry={!props.passwordVisible} returnKeyType="done" onSubmitEditing={props.onSubmit} value={props.password} onChangeText={props.setPassword} placeholder="Tu contraseña" placeholderTextColor={colors.placeholder} style={styles.input} /><Pressable accessibilityRole="button" accessibilityLabel={props.passwordVisible ? 'Ocultar contraseña' : 'Mostrar contraseña'} hitSlop={10} onPress={() => props.setPasswordVisible(!props.passwordVisible)}><Ionicons name={props.passwordVisible ? 'eye-off-outline' : 'eye-outline'} size={21} color={colors.muted} /></Pressable></View>
       {props.error ? <Text accessibilityRole="alert" style={styles.errorText}>{props.error}</Text> : null}<Button title="Ingresar" loading={props.submitting} disabled={props.submitting} onPress={props.onSubmit} /></View>
    <View style={styles.infoBox}><Ionicons name="information-circle-outline" size={22} color={colors.muted} /><Text style={styles.infoText}><Text style={styles.bold}>¿No tienes cuenta? </Text>El registro se realiza exclusivamente desde el panel web.</Text></View>
  </ScrollView></KeyboardAvoidingView>;
}

function TransferFlow(props: { screen: 'details' | 'review' | 'otp' | 'status' | 'receipt' | 'rejected'; amount: string; setAmount: (value: string) => void; concept: string; setConcept: (value: string) => void; reference: string; setReference: (value: string) => void; otp: string; setOtp: (value: string) => void; destination: Beneficiary | null; source: Account | undefined; transfer: Transfer | null; demoOnlyCode: string; error: string; busy: boolean; createRetry: boolean; confirmRetry: boolean; onBack: () => void; onReview: () => void; onCreate: () => void; onRetryCreate: () => void; onConfirm: () => void; onRetryConfirm: () => void; onCheck: () => void; onDone: () => void }) {
  const minor = amountToMinor(props.amount);
  const insufficient = Boolean(minor && props.source && BigInt(minor) > BigInt(props.source.availableBalanceMinor));
  const formValid = Boolean(minor && props.concept.trim().length >= 1 && props.concept.trim().length <= 40 && /^\d{1,7}$/.test(props.reference));
  let title = 'Datos de transferencia';
  if (props.screen === 'review') title = 'Revisa tu transferencia';
  if (props.screen === 'otp') title = 'Confirma tu identidad';
  if (props.screen === 'status') title = props.busy ? 'Consultando operación…' : 'Estamos verificando si tu transferencia se completó';
  if (props.screen === 'receipt') title = 'Transferencia completada';
  if (props.screen === 'rejected') title = 'Transferencia no completada';
  return <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}><StatusBar barStyle="dark-content"/><ScrollView contentContainerStyle={styles.flowContent} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}>
    <Pressable accessibilityRole="button" accessibilityLabel="Volver" style={styles.backButton} onPress={props.screen === 'details' ? props.onDone : props.onBack}><Ionicons name="arrow-back" size={22} color={colors.primary}/><Text style={styles.link}>Volver</Text><View style={styles.flowHeaderSpacer}/><Text style={styles.eyebrow}>TRANSFERIR</Text></Pressable>
    {(props.screen === 'details' || props.screen === 'review') && <View style={styles.progressHeader}><View style={styles.progressLabels}><Text style={styles.progressActive}>{props.screen === 'details' ? 'PASO 1 DE 2' : 'PASO 2 DE 2'}</Text><Text style={styles.muted}>{props.screen === 'details' ? 'Datos de la operación' : 'Revisar y confirmar'}</Text></View><View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 2, now: props.screen === 'details' ? 1 : 2 }} style={styles.progressTrack}><View style={[styles.progressFill, props.screen === 'review' && styles.progressComplete]}/></View></View>}
    <Text style={styles.flowTitle}>{title}</Text>
    {props.destination && <View style={styles.flowCard}><Text style={styles.label}>Para</Text><Text style={styles.rowTitle}>{props.destination.name}</Text><Text style={styles.muted}>{props.destination.alias} · {props.destination.clabeMasked}</Text></View>}
    {props.screen === 'details' && <>
      <View style={styles.flowCard}><Text style={styles.label}>Cuenta de origen</Text><View style={styles.accountSummary}><View style={styles.accountIcon}><Ionicons name="wallet-outline" size={22} color={colors.primary}/></View><View style={styles.summaryCopy}><Text style={styles.rowTitle}>{props.source?.name ?? 'Selecciona una cuenta'}</Text><Text style={styles.muted}>Disponible {props.source ? formatBalance(props.source.availableBalanceMinor) : '—'} MXN</Text></View></View></View>
      <View style={styles.flowCard}><Text style={styles.sectionTitle}>Monto a transferir</Text><View style={styles.amountInputWrap}><Text style={styles.amountPrefix}>$</Text><TextInput accessibilityLabel="Importe" keyboardType="decimal-pad" value={props.amount} onChangeText={props.setAmount} placeholder="0.00" placeholderTextColor={colors.placeholder} style={styles.amountInput}/><Text style={styles.amountCurrency}>MXN</Text></View><Text style={styles.label}>Concepto de pago</Text><TextInput accessibilityLabel="Concepto" value={props.concept} onChangeText={props.setConcept} maxLength={40} placeholder="¿Para qué es?" placeholderTextColor={colors.placeholder} style={styles.flowInput}/><Text style={styles.fieldMeta}>{props.concept.length}/40</Text><Text style={styles.label}>Referencia numérica (hasta 7 dígitos)</Text><TextInput accessibilityLabel="Referencia" keyboardType="number-pad" value={props.reference} onChangeText={(value) => props.setReference(value.replace(/\D/g, '').slice(0, 7))} maxLength={7} placeholder="1 a 7 dígitos" placeholderTextColor={colors.placeholder} style={styles.flowInput}/></View>
      {insufficient && <Text accessibilityRole="alert" style={styles.errorText}>Saldo insuficiente para este importe.</Text>}
      {!insufficient && props.amount && !minor && <Text accessibilityRole="alert" style={styles.errorText}>Escribe un importe positivo con máximo dos decimales.</Text>}
      <Button title="Revisar transferencia" disabled={!formValid || insufficient || !props.source} onPress={props.onReview}/>
    </>}
    {props.screen === 'review' && <><View style={styles.amountHero}><View style={styles.heroIcon}><Ionicons name="arrow-forward-circle-outline" size={28} color={colors.primary}/></View><Text style={styles.muted}>Monto a transferir</Text><Text adjustsFontSizeToFit numberOfLines={1} style={styles.flowAmount}>{minor ? formatBalance(minor) : '—'} <Text style={styles.amountCurrency}>MXN</Text></Text><Text style={styles.internalBadge}>● Transferencia interna</Text></View><View style={styles.flowCard}><SummaryRow label="Cuenta de origen" value={props.source?.name ?? '—'}/><View style={styles.flowDivider}/><SummaryRow label="Destinatario" value={props.destination?.name ?? '—'} detail={props.destination?.clabeMasked}/><View style={styles.flowDivider}/><SummaryRow label="Concepto" value={props.concept.trim()}/><SummaryRow label="Referencia numérica" value={props.reference}/></View>{props.error ? <Text accessibilityRole="alert" style={styles.errorText}>{props.error}</Text> : null}<Button title="Confirmar transferencia" loading={props.busy} disabled={props.busy} onPress={props.onCreate}/><Pressable accessibilityRole="button" style={styles.modifyAction} onPress={props.onBack}><Text style={styles.link}>Modificar datos</Text></Pressable></>}
    {props.screen === 'otp' && <><View style={styles.otpIntro}><View style={styles.otpBadge}><Ionicons name="shield-checkmark-outline" size={18} color={colors.primary}/><Text style={styles.otpBadgeText}>CONFIRMACIÓN</Text></View><Text style={styles.sectionTitle}>Código de confirmación</Text><Text style={[styles.muted, styles.center]}>Ingresa el código de 6 dígitos asociado a esta operación.</Text>{props.demoOnlyCode ? <Text style={styles.demoCode}>Código de prueba: {props.demoOnlyCode}</Text> : null}<View style={styles.otpDigits} pointerEvents="none">{Array.from({ length: 6 }, (_, index) => <View key={index} style={[styles.otpDigit, index < props.otp.length && styles.otpDigitFilled]}><Text style={styles.otpDigitText}>{props.otp[index] ? '•' : '—'}</Text></View>)}</View><TextInput accessibilityLabel="Código de confirmación" keyboardType="number-pad" maxLength={6} value={props.otp} onChangeText={(value) => props.setOtp(value.replace(/\D/g, '').slice(0, 6))} style={styles.otpInput}/></View>{props.error ? <Text accessibilityRole="alert" style={styles.errorText}>{props.error}</Text> : null}<Button title="Autorizar transferencia" loading={props.busy} disabled={props.busy || !/^\d{6}$/.test(props.otp)} onPress={props.onConfirm}/>{props.confirmRetry && <Button title="Reintentar envío del mismo código" loading={props.busy} disabled={props.busy} onPress={props.onRetryConfirm}/>}</>}
    {props.screen === 'status' && <><View style={styles.statusIcon}><Ionicons name={props.busy ? 'sync-outline' : 'cloud-offline-outline'} size={38} color={colors.primary}/></View><View style={styles.statusPill}><Ionicons name="shield-checkmark-outline" size={16} color={colors.primary}/><Text style={styles.statusPillText}>Protección contra duplicados activa</Text></View><View style={styles.flowCard}><Text style={styles.statusMessage}>{props.error || 'Estamos comprobando el estado del intento para evitar una operación duplicada.'}</Text><View style={styles.warningBox}><Ionicons name="information-circle-outline" size={20} color={colors.primary}/><Text style={styles.muted}>No vuelvas a enviar el dinero. Consulta el intento original o reinténtalo con la misma clave.</Text></View>{props.transfer && <SummaryRow label="Estado actual" value={props.transfer.status}/>}</View><Button title="Verificar estado de la transferencia" loading={props.busy} disabled={props.busy || !props.transfer} onPress={props.onCheck}/>{props.createRetry && <Button title="Reintentar el mismo envío" loading={props.busy} disabled={props.busy} onPress={props.onRetryCreate}/>}</>}
    {props.screen === 'receipt' && <>
      <View style={styles.resultHero}>
        <View style={styles.successIcon}><Ionicons name="checkmark" size={34} color={colors.white}/></View>
        <View style={styles.successPill}><View style={styles.successDot}/><Text style={styles.successPillText}>Completada</Text></View>
        <Text style={styles.sectionTitle}>Transferencia completada</Text>
        <Text style={styles.flowAmount}>{formatBalance(props.transfer?.amountMinor ?? '0')} <Text style={styles.amountCurrency}>MXN</Text></Text>
      </View>
      <View style={styles.flowCard}>
        <Text style={styles.receiptHeading}>DETALLE DE LA OPERACIÓN</Text>
        <SummaryRow label="Destinatario" value={props.destination?.name ?? props.transfer?.destination.name ?? '—'} detail={props.destination?.alias}/>
        <View style={styles.flowDivider}/>
        <SummaryRow label="Concepto" value={props.transfer?.concept ?? '—'}/>
        <SummaryRow label="Referencia" value={props.transfer?.reference ?? '—'}/>
        <SummaryRow label="Folio interno" value={props.transfer?.receiptReference ?? props.transfer?.id ?? '—'}/>
        <SummaryRow label="Tipo de operación" value="Transferencia interna"/>
      </View>
      <Button title="Volver a mis cuentas" onPress={props.onDone}/>
    </>}
    {props.screen === 'rejected' && <><View style={styles.resultHero}><View style={styles.rejectedIcon}><Ionicons name="close" size={34} color={colors.error}/></View><Text style={styles.sectionTitle}>No se pudo completar la transferencia</Text><Text style={[styles.muted, styles.center]}>{props.error || 'La transferencia fue rechazada. No se completó el movimiento.'}</Text></View><View style={styles.warningBox}><Ionicons name="checkmark-circle" size={22} color={colors.success}/><View style={styles.summaryCopy}><Text style={styles.rowTitle}>Tu dinero está intacto</Text><Text style={styles.muted}>No se aplicó ningún cargo a tu cuenta por este intento.</Text></View></View><Button title="Volver a mis cuentas" onPress={props.onDone}/></>}
  </ScrollView></KeyboardAvoidingView>;
}

function MovementReceipt({ transfer, onBack }: { transfer: Transfer; onBack: () => void }) {
  const completed = transfer.status === 'completed';
  return <View style={styles.page}><StatusBar barStyle="dark-content"/><ScrollView contentContainerStyle={styles.flowContent}>
    <Pressable accessibilityRole="button" accessibilityLabel="Volver a movimientos" style={styles.backButton} onPress={onBack}><Ionicons name="arrow-back" size={22} color={colors.primary}/><Text style={styles.link}>Movimientos</Text></Pressable>
    <View style={styles.resultHero}>
      <View style={[styles.successIcon, !completed && styles.movementStateIcon]}><Ionicons name={completed ? 'checkmark' : transfer.status === 'rejected' ? 'close' : 'time-outline'} size={34} color={colors.white}/></View>
      <View style={completed ? styles.successPill : styles.statusPill}><Text style={completed ? styles.successPillText : styles.statusPillText}>{completed ? 'Completada' : transfer.status === 'rejected' ? 'Rechazada' : 'En proceso'}</Text></View>
      <Text style={styles.sectionTitle}>{completed ? 'Movimiento completado' : transfer.status === 'rejected' ? 'Movimiento rechazado' : 'Movimiento en proceso'}</Text>
      <Text style={styles.flowAmount}>{formatBalance(transfer.amountMinor)} <Text style={styles.amountCurrency}>MXN</Text></Text>
    </View>
    <View style={styles.flowCard}><Text style={styles.receiptHeading}>DETALLE DE LA OPERACIÓN</Text>
      <SummaryRow label="Concepto" value={transfer.concept}/><View style={styles.flowDivider}/>
      <SummaryRow label="Estado" value={transfer.status}/><SummaryRow label="Referencia" value={transfer.reference}/>
      <SummaryRow label="Folio interno" value={transfer.receiptReference ?? transfer.id}/>
      <SummaryRow label="Fecha" value={new Date(transfer.createdAt).toLocaleString('es-MX')}/>
    </View>
    <Button title="Volver a movimientos" onPress={onBack}/>
  </ScrollView></View>;
}

function amountToMinor(value: string): string | null {
  const normalized = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ''] = normalized.split('.');
  const minor = `${whole}${fraction.padEnd(2, '0')}`.replace(/^0+/, '');
  return minor && /[1-9]/.test(minor) ? minor : null;
}

function newIdempotencyKey(): string {
  if (!globalThis.crypto?.randomUUID) throw new Error('No se pudo crear una clave segura para el intento.');
  return globalThis.crypto.randomUUID();
}

function PrivacyScreen() { return <View style={styles.privacy}><View style={styles.privacyCard}><View style={styles.privacyIcon}><Ionicons name="eye-off-outline" size={34} color={colors.primary} /></View><Text style={styles.brand}>Billetera MXN</Text><View style={styles.privacyPill}><Ionicons name="shield-checkmark-outline" size={17} color={colors.primary}/><Text style={styles.privacyPillText}>Contenido oculto por privacidad</Text></View><Text style={[styles.muted, styles.center]}>La información confidencial y los saldos están ocultos mientras la aplicación está en segundo plano.</Text></View><View style={styles.privacyNote}><View style={styles.accountIcon}><Ionicons name="layers-outline" size={22} color={colors.primary}/></View><View style={styles.summaryCopy}><Text style={styles.rowTitle}>Privacidad en segundo plano</Text><Text style={styles.muted}>Esta vista protege tus saldos y datos de cuenta en el selector de aplicaciones de tu dispositivo móvil.</Text></View></View></View>; }
function Centered({ children }: { children: React.ReactNode }) { return <View style={styles.centered}>{children}</View>; }
function SummaryRow({ label, value, detail }: { label: string; value: string; detail?: string }) { return <View style={styles.summaryRow}><View style={styles.summaryCopy}><Text style={styles.muted}>{label}</Text>{detail ? <Text style={styles.summaryDetail}>{detail}</Text> : null}</View><Text style={styles.summaryValue}>{value}</Text></View>; }
function Button({ title, onPress, disabled, loading = false }: { title: string; onPress: () => void; disabled?: boolean; loading?: boolean }) { return <Pressable accessibilityRole="button" accessibilityState={{ disabled, busy: loading }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.button, (pressed || disabled) && styles.buttonPressed]}>{loading ? <ActivityIndicator color="#fff" accessibilityLabel={title} /> : <Text style={styles.buttonText}>{title}</Text>}</Pressable>; }
function initials(name: string) { return name.split(/\s+/).slice(0, 2).map((part) => part[0] ?? '').join('').toUpperCase(); }

const colors = { bg: '#f9f9ff', white: '#ffffff', text: '#141b2c', muted: '#434655', placeholder: '#747686', primary: '#0037b0', pale: '#e9edff', input: '#f1f3ff', border: '#c4c5d7', error: '#ba1a1a', success: '#006d40', successPale: '#98f6bb', pending: '#8f0001', pendingPale: '#ffdad5' };
const styles = StyleSheet.create({
  flowContent: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 48, maxWidth: 600, width: '100%', alignSelf: 'center', flexGrow: 1 }, backButton: { minHeight: 48, minWidth: 48, flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }, flowHeaderSpacer: { flex: 1 }, flowTitle: { color: colors.text, fontSize: 30, lineHeight: 38, fontWeight: '700', marginTop: 12, marginBottom: 24, letterSpacing: -0.5 }, flowCard: { backgroundColor: colors.white, borderRadius: 20, borderWidth: 1, borderColor: colors.border, padding: 20, marginBottom: 16, gap: 12 }, flowInput: { minHeight: 56, borderRadius: 14, paddingHorizontal: 16, backgroundColor: colors.input, borderWidth: 1, borderColor: colors.border, color: colors.text, fontSize: 16, marginBottom: 8 }, flowAmount: { color: colors.text, fontSize: 36, lineHeight: 44, fontWeight: '700', marginTop: 6, marginBottom: 12, fontVariant: ['tabular-nums'], letterSpacing: -0.7 }, receiptHeading: { color: colors.muted, fontSize: 13, fontWeight: '700', letterSpacing: 1, marginBottom: 4 }, successIcon: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center', marginBottom: 12, borderWidth: 10, borderColor: colors.successPale }, movementStateIcon: { backgroundColor: colors.primary, borderColor: colors.pale }, successPill: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: colors.pale, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 7, marginBottom: 12 }, successDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success }, successPillText: { color: colors.muted, fontSize: 14, fontWeight: '600' }, demoCode: { color: colors.primary, fontWeight: '700', fontSize: 16, marginVertical: 8 },
  progressHeader: { marginTop: 8, marginBottom: 8 }, progressLabels: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 10 }, progressActive: { color: colors.primary, fontSize: 14, fontWeight: '700', letterSpacing: 0.5 }, progressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.pale, overflow: 'hidden' }, progressFill: { height: 6, width: '50%', backgroundColor: colors.primary, borderRadius: 3 }, progressComplete: { width: '100%' }, accountSummary: { flexDirection: 'row', alignItems: 'center', gap: 12 }, summaryCopy: { flex: 1 }, amountInputWrap: { minHeight: 84, borderRadius: 14, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.input, marginBottom: 18 }, amountPrefix: { fontSize: 30, color: colors.text, fontWeight: '600' }, amountInput: { flex: 1, minWidth: 0, color: colors.text, fontSize: 36, lineHeight: 44, fontWeight: '700', fontVariant: ['tabular-nums'], paddingHorizontal: 6 }, amountCurrency: { color: colors.muted, fontSize: 14, fontWeight: '600' }, fieldMeta: { color: colors.muted, fontSize: 12, textAlign: 'right', marginTop: -8, marginBottom: 12 }, amountHero: { alignItems: 'center', padding: 20, backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.border, marginBottom: 14 }, heroIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.input, marginBottom: 10 }, internalBadge: { color: colors.success, backgroundColor: colors.successPale, overflow: 'hidden', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, fontSize: 13, fontWeight: '600' }, summaryRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14 }, summaryValue: { color: colors.text, fontSize: 15, fontWeight: '600', textAlign: 'right', flexShrink: 1 }, summaryDetail: { color: colors.muted, fontSize: 12, marginTop: 3 }, flowDivider: { height: 1, backgroundColor: colors.input, marginVertical: 3 }, modifyAction: { minHeight: 48, alignItems: 'center', justifyContent: 'center' }, otpIntro: { alignItems: 'center', backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 20, marginBottom: 16 }, otpBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.input, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 12, marginBottom: 18 }, otpBadgeText: { color: colors.primary, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 }, otpDigits: { width: '100%', flexDirection: 'row', justifyContent: 'space-between', gap: 6, marginTop: 20 }, otpDigit: { flex: 1, height: 54, borderRadius: 10, backgroundColor: colors.input, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border }, otpDigitFilled: { borderColor: colors.primary, backgroundColor: colors.pale }, otpDigitText: { color: colors.primary, fontSize: 22, fontWeight: '600' }, otpInput: { width: '100%', height: 48, marginTop: -50, color: 'transparent', opacity: 0.02 }, statusIcon: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.pale, alignSelf: 'center', marginTop: 12, marginBottom: 14 }, statusPill: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, alignSelf: 'center', backgroundColor: colors.pale, borderRadius: 18, paddingHorizontal: 12, paddingVertical: 7, marginBottom: 16 }, statusPillText: { color: colors.muted, fontSize: 13, fontWeight: '500' }, statusMessage: { color: colors.text, fontSize: 16, lineHeight: 26 }, warningBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: colors.input, borderRadius: 12, padding: 14, marginTop: 8, marginBottom: 8 }, resultHero: { alignItems: 'center', gap: 14, paddingVertical: 22 }, rejectedIcon: { width: 84, height: 84, borderRadius: 42, backgroundColor: colors.pendingPale, alignItems: 'center', justifyContent: 'center' },
  page: { flex: 1, backgroundColor: colors.bg }, content: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 28, maxWidth: 600, width: '100%', alignSelf: 'center' },
  topbar: { minHeight: 56, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, brand: { color: colors.text, fontSize: 20, fontWeight: '700' }, eyebrow: { color: colors.muted, fontSize: 12, fontWeight: '600', letterSpacing: 1 }, avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.pale, alignItems: 'center', justifyContent: 'center' }, avatarText: { color: colors.primary, fontWeight: '700' },
  greeting: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, marginBottom: 20 }, title: { fontSize: 28, lineHeight: 36, fontWeight: '600', color: colors.text }, muted: { color: colors.muted, fontSize: 14, lineHeight: 20 }, iconButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  accountTabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 6, borderRadius: 16, backgroundColor: colors.pale, marginBottom: 16 }, tab: { minHeight: 48, minWidth: 100, flex: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 }, tabSelected: { backgroundColor: colors.white }, tabText: { color: colors.muted, fontSize: 15, fontWeight: '600' }, tabTextSelected: { color: colors.primary },
  balanceCard: { backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16, marginBottom: 16 }, accountLabel: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 14, marginBottom: 8 }, tag: { paddingHorizontal: 8, paddingVertical: 4, backgroundColor: colors.pale, borderRadius: 6, color: colors.primary, fontSize: 12, fontWeight: '600' }, balanceLine: { flexDirection: 'row', alignItems: 'baseline', marginTop: 4 }, balance: { flexShrink: 1, color: colors.text, fontSize: 36, lineHeight: 44, fontWeight: '700', letterSpacing: -0.7, fontVariant: ['tabular-nums'] }, selectedBalanceLine: { flexDirection: 'row', alignItems: 'baseline' }, selectedBalance: { flexShrink: 1, color: colors.text, fontSize: 20, lineHeight: 28, fontWeight: '600', fontVariant: ['tabular-nums'] }, balanceDivider: { height: 1, backgroundColor: colors.border, marginTop: 14 }, currency: { color: colors.muted, fontSize: 14, fontWeight: '600' },
    notice: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.input, borderRadius: 16, padding: 16, marginVertical: 8 }, sectionTitle: { color: colors.text, fontSize: 20, lineHeight: 28, fontWeight: '600' }, activityHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 24, marginBottom: 12 }, listCard: { backgroundColor: colors.white, borderRadius: 16, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border }, accountRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 }, divider: { borderTopWidth: 1, borderTopColor: colors.border }, accountIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.pale, alignItems: 'center', justifyContent: 'center' }, rowTitle: { color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '600', marginBottom: 3 }, rowBalance: { color: colors.text, fontSize: 16, lineHeight: 24, fontWeight: '600', fontVariant: ['tabular-nums'] }, loadMore: { borderTopWidth: 1, borderTopColor: colors.border, paddingBottom: 16 },
  transferEntry: { minHeight: 82, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 16, marginBottom: 16 }, destinationCard: { minHeight: 92, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16, marginBottom: 16 }, destinationIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.pale, alignItems: 'center', justifyContent: 'center' }, beneficiarySection: { marginTop: 4, marginBottom: 20 }, beneficiaryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }, searchWrap: { minHeight: 52, borderRadius: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, marginBottom: 12 }, emptyState: { alignItems: 'center', gap: 10, backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 24, marginVertical: 8 }, link: { color: colors.primary, fontSize: 14, fontWeight: '700' }, offlineHint: { color: colors.muted, fontSize: 13, marginTop: 8 },
  loginContent: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 20, paddingVertical: 28, width: '100%', maxWidth: 520, alignSelf: 'center' }, loginBrand: { alignItems: 'center', marginBottom: 32 }, walletMark: { width: 64, height: 64, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.pale, marginBottom: 16 }, loginTitle: { color: colors.text, fontSize: 34, lineHeight: 42, fontWeight: '700', marginTop: 18, textAlign: 'center', letterSpacing: -0.5 }, loginSubtitle: { color: colors.muted, fontSize: 16, lineHeight: 24, textAlign: 'center', marginTop: 10, maxWidth: 360 }, formCard: { backgroundColor: colors.white, borderRadius: 20, padding: 20, borderWidth: 1, borderColor: colors.border }, label: { color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '500', marginBottom: 8 }, inputWrap: { minHeight: 56, borderRadius: 14, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.input, borderWidth: 1, borderColor: colors.border }, input: { flex: 1, minWidth: 0, minHeight: 54, color: colors.text, fontSize: 16 }, button: { minHeight: 56, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 24, paddingHorizontal: 16 }, buttonPressed: { opacity: 0.86 }, buttonText: { color: colors.white, fontSize: 16, fontWeight: '600' }, errorText: { color: colors.error, fontSize: 14, lineHeight: 20, marginTop: 12 }, infoBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: colors.input, borderRadius: 16, padding: 18, marginTop: 18 }, infoText: { flex: 1, color: colors.muted, fontSize: 14, lineHeight: 21 }, bold: { fontWeight: '700', color: colors.text },
  movementAccountCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 18, minHeight: 112, backgroundColor: colors.white, borderRadius: 20, borderWidth: 1, borderColor: colors.border, marginTop: 18, marginBottom: 26 }, movementBalance: { alignItems: 'flex-end', maxWidth: '48%' }, movementGroup: { marginBottom: 20 }, movementGroupHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, paddingHorizontal: 4 }, movementRow: { minHeight: 88, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 }, movementCopy: { flex: 1, minWidth: 0 }, creditIcon: { backgroundColor: colors.successPale }, creditAmount: { color: colors.success }, bottomNavigation: { minHeight: 72, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', backgroundColor: colors.bg, borderTopWidth: 1, borderTopColor: colors.input, paddingBottom: 4 }, navigationItem: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 8 }, navigationLabel: { color: colors.muted, fontSize: 13, fontWeight: '500' }, navigationLabelActive: { color: colors.primary, fontWeight: '700' },
  pickerContent: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24 }, pickerDescription: { fontSize: 16, lineHeight: 24, marginTop: -12, marginBottom: 24 }, pickerMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, marginBottom: 10 }, beneficiaryCard: { minHeight: 88, flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.input, borderRadius: 18, marginBottom: 12 }, beneficiaryAvatar: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.pale }, beneficiaryInitials: { color: colors.primary, fontSize: 17, fontWeight: '700' }, pickerFooter: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.pale, borderRadius: 14, padding: 14, marginTop: 'auto' },
  centered: { flex: 1, minHeight: 180, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, backgroundColor: colors.bg }, privacy: { flex: 1, justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 24, backgroundColor: colors.bg }, privacyCard: { flex: 1, maxHeight: 560, minHeight: 340, alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: colors.white, borderRadius: 24, borderWidth: 1, borderColor: colors.border }, privacyIcon: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.pale, marginBottom: 24 }, privacyPill: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.pale, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, marginTop: 16 }, privacyPillText: { color: colors.primary, fontSize: 13, fontWeight: '600' }, privacyNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 16, marginTop: 20, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, borderRadius: 18 }, center: { textAlign: 'center', maxWidth: 320, marginTop: 16 }, privacyFooter: { position: 'absolute', bottom: 36, color: colors.muted, fontSize: 14, fontWeight: '600' },
});

export default function App() { return <SafeAreaProvider><SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}><QueryClientProvider client={queryClient}><Wallet /></QueryClientProvider></SafeAreaView></SafeAreaProvider>; }
