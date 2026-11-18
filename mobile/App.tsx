import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, KeyboardAvoidingView, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
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
  // Guards against a double tap or concurrent call racing past the `transferBusy` state check
  // before React re-renders with it set; a ref mutates synchronously, state does not.
  const transferInFlight = useRef(false);
  const [transfer, setTransfer] = useState<Transfer | null>(null);
  const [demoOnlyCode, setDemoOnlyCode] = useState('');
  const [createAttempt, setCreateAttempt] = useState<{ key: string; payload: TransferRequest } | null>(null);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [otp, setOtp] = useState('');
  // Set only when the API answers a confirm with "code expired"; the challenge can then never be confirmed.
  const [otpExpired, setOtpExpired] = useState(false);
  const [confirmAttempt, setConfirmAttempt] = useState<{ key: string; payload: { code: string } } | null>(null);
  const [movementDetail, setMovementDetail] = useState<Transfer | null>(null);
  const [movementDetailId, setMovementDetailId] = useState('');
  const [movementDetailType, setMovementDetailType] = useState<Movement['type'] | null>(null);
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
      setOtpExpired(false);
      setTransferScreen(null);
      setChoosingBeneficiary(false);
      setBeneficiarySearch('');
      setMovementDetail(null);
      setMovementDetailId('');
      setMovementDetailError('');
      setMovementDetailType(null);
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
          try {
            if (error instanceof ApiError && error.status === 401) {
              const refresh = await SecureStore.getItemAsync(REFRESH_KEY);
              if (refresh) await refreshSession(refresh).catch(endSession);
              else await endSession();
            }
          } catch { /* Best-effort background session recheck on foreground; never let it crash the app. */ }
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
    setMovementDetailType(movement.type);
    setMovementDetailBusy(true); setMovementDetailError('');
    try { setMovementDetail(await request<Transfer>(`/transfers/${encodeURIComponent(movement.transferId)}`, session.accessToken)); }
    catch (error) { setMovementDetailError(error instanceof Error ? error.message : 'No se pudo cargar el comprobante.'); }
    finally { setMovementDetailBusy(false); }
  }
  const amountMinor = amountToMinor(amount);
  const transferPayload: TransferRequest | null = destination && selected && amountMinor && concept.trim() && reference
    ? { sourceAccountId: selected.id, destinationType: 'beneficiary', beneficiaryId: destination.id, amountMinor, concept: concept.trim(), reference }
    : null;

  async function submitCreate(retry = false, payloadOverride?: TransferRequest) {
    if (!session || transferBusy || transferInFlight.current) return;
    transferInFlight.current = true;
    let attempt: { key: string; payload: TransferRequest; transferId?: string } | null;
    const payload = payloadOverride ?? transferPayload;
    try {
      attempt = retry && createAttempt ? createAttempt : payload ? { key: newIdempotencyKey(), payload } : null;
    } catch (error) {
      transferInFlight.current = false;
      setTransferError(error instanceof Error ? error.message : 'No se pudo preparar el intento de transferencia.');
      return;
    }
    if (!attempt) { transferInFlight.current = false; return; }
    if (!retry) {
      setCreateAttempt(attempt);
      await SecureStore.setItemAsync(TRANSFER_RECOVERY_KEY, JSON.stringify(attempt));
    }
    setTransferBusy(true); setTransferError(''); setOtpExpired(false); setTransferScreen('status');
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
    } finally { setTransferBusy(false); transferInFlight.current = false; }
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
    if (!session || !transfer || transferBusy || transferInFlight.current) return;
    transferInFlight.current = true;
    let attempt: { key: string; payload: { code: string } };
    try {
      attempt = retry && confirmAttempt ? confirmAttempt : { key: newIdempotencyKey(), payload: { code: otp } };
    } catch (error) {
      transferInFlight.current = false;
      setTransferError(error instanceof Error ? error.message : 'No se pudo preparar la confirmación.');
      return;
    }
    if (!retry) setConfirmAttempt(attempt);
    setTransferBusy(true); setTransferError('');
    try {
      const result = await request<Transfer>(`/transfers/${transfer.id}/confirm`, session.accessToken, { method: 'POST', headers: { 'Idempotency-Key': attempt.key }, body: JSON.stringify(attempt.payload) });
      const finalResult = result.status === 'completed' ? await request<Transfer>(`/transfers/${result.id}`, session.accessToken) : result;
      setTransfer(finalResult); setConfirmAttempt(null); setOtp('');
      if (finalResult.status === 'completed' || finalResult.status === 'rejected') await SecureStore.deleteItemAsync(TRANSFER_RECOVERY_KEY);
      setTransferScreen(finalResult.status === 'rejected' ? 'rejected' : finalResult.status === 'awaiting_confirmation' ? 'otp' : 'receipt');
    } catch (error) {
      if (!(error instanceof ApiError) || error.status >= 500) {
        // Result is uncertain: the confirmation may have been processed even though we lost the response.
        // The OTP challenge is single-consumption server-side (confirmTransfer rejects a second confirm once
        // consumed_at is set), so re-querying by transfer id is always safe and never duplicates a charge.
        try {
          const recovered = await request<Transfer>(`/transfers/${transfer.id}`, session.accessToken);
          setTransfer(recovered); setConfirmAttempt(null); setOtp('');
          if (recovered.status === 'completed' || recovered.status === 'rejected') await SecureStore.deleteItemAsync(TRANSFER_RECOVERY_KEY);
          setTransferScreen(recovered.status === 'rejected' ? 'rejected' : recovered.status === 'awaiting_confirmation' ? 'otp' : 'receipt');
          return;
        } catch { /* Recovery query failed too; fall through and show the error with the attempt preserved for retry. */ }
      }
      if (error instanceof ApiError && error.status === 422 && /expir/i.test(error.message)) { setOtpExpired(true); setOtp(''); }
      setTransferError(error instanceof Error ? error.message : 'No se pudo confirmar el resultado.');
    } finally { setTransferBusy(false); transferInFlight.current = false; }
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
    setTransferScreen(null); setAmount(''); setConcept(''); setReference(''); setTransfer(null); setCreateAttempt(null); setConfirmAttempt(null); setOtp(''); setOtpExpired(false); setTransferError(''); setDemoOnlyCode('');
  }

  function requestNewCode() {
    // The API checks expiry before the code, so an expired challenge can never be confirmed and its attempt can
    // never move money. A new code therefore needs a new attempt (new Idempotency-Key) with the same data.
    const payload = createAttempt?.payload ?? transferPayload;
    if (!payload || transferBusy || transferInFlight.current) return;
    setOtp(''); setConfirmAttempt(null); setTransfer(null); setDemoOnlyCode('');
    void submitCreate(false, payload);
  }

  function leaveUncertainTransfer() {
    // Deliberately keeps the persisted recovery record (unlike resetTransfer): the next launch resumes this exact
    // attempt with its original Idempotency-Key instead of forgetting a transfer whose outcome is still unknown.
    setTransferScreen(null); setAmount(''); setConcept(''); setReference(''); setTransfer(null); setCreateAttempt(null); setConfirmAttempt(null); setOtp(''); setOtpExpired(false); setTransferError(''); setDemoOnlyCode('');
    void client.invalidateQueries({ queryKey: ['accounts'] });
    void client.invalidateQueries({ queryKey: ['movements'] });
  }

  function leaveOtp() {
    setOtp(''); setOtpExpired(false); setConfirmAttempt(null); setTransferError('');
    setTransferScreen('review');
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

  // Opened from Home or from "Cambiar beneficiario" on the transfer details step; any later step keeps priority.
  if (choosingBeneficiary && (!transferScreen || transferScreen === 'details')) return <BeneficiaryPickerScreen queryPending={beneficiariesQuery.isPending} error={beneficiariesQuery.error instanceof Error ? beneficiariesQuery.error.message : ''} beneficiaries={filteredBeneficiaries} total={beneficiaries.length} search={beneficiarySearch} setSearch={setBeneficiarySearch} userInitials={initials(session.user.fullName)} backLabel={transferScreen ? 'Volver a datos de transferencia' : 'Volver a inicio'} onRetry={() => void beneficiariesQuery.refetch()} onClose={() => setChoosingBeneficiary(false)} onChoose={(beneficiary) => { setDestination(beneficiary); setChoosingBeneficiary(false); }} />;
  if (transferScreen) return <TransferFlow screen={transferScreen} amount={amount} setAmount={setAmount} concept={concept} setConcept={setConcept} reference={reference} setReference={setReference} otp={otp} setOtp={setOtp} destination={destination} source={selected} transfer={transfer} demoOnlyCode={demoOnlyCode} error={transferError} busy={transferBusy} createRetry={Boolean(createAttempt && transferScreen === 'status' && !transfer)} confirmRetry={Boolean(confirmAttempt)} otpExpired={otpExpired} pendingPayload={createAttempt?.payload ?? null} userInitials={initials(session.user.fullName)} onChangeBeneficiary={() => { setBeneficiarySearch(''); setChoosingBeneficiary(true); }} onRequestNewCode={requestNewCode} onLeave={leaveUncertainTransfer} onBack={() => { if (transferScreen === 'otp') leaveOtp(); else setTransferScreen(transferScreen === 'review' ? 'details' : 'review'); }} onReview={() => { setTransferError(''); setTransferScreen('review'); }} onCreate={() => void submitCreate()} onRetryCreate={() => void submitCreate(true)} onConfirm={() => void confirmOtp()} onRetryConfirm={() => void confirmOtp(true)} onCheck={() => void checkTransferStatus()} onDone={resetTransfer} />;

  if (movementDetailBusy || movementDetailError) return <View style={styles.page}><View style={styles.flowContent}><Pressable accessibilityRole="button" accessibilityLabel="Volver a movimientos" style={styles.backButton} onPress={() => { setMovementDetailError(''); setMovementDetailBusy(false); setMovementDetailId(''); }}><Ionicons name="arrow-back" size={22} color={colors.primary}/><Text style={styles.link}>Movimientos</Text></Pressable>{movementDetailBusy ? <Centered><ActivityIndicator color={colors.primary}/><Text style={styles.muted}>Cargando comprobante…</Text></Centered> : <View style={styles.notice}><Text accessibilityRole="alert" style={styles.errorText}>{movementDetailError}</Text><Button title="Reintentar" onPress={() => { const item = movementsQuery.data?.items.find((movement) => movement.transferId === movementDetailId); if (item) void openMovement(item); }}/></View>}</View></View>;
  const closeMovementDetail = () => { setMovementDetail(null); setMovementDetailId(''); setMovementDetailError(''); setMovementDetailType(null); };
  if (movementDetail) return <MovementReceipt transfer={movementDetail} movementType={movementDetailType} accounts={accounts} userInitials={initials(session.user.fullName)} onBack={closeMovementDetail} onHome={() => { closeMovementDetail(); setActiveTab('home'); }} />;

  if (activeTab === 'movements') return <MovementListScreen account={selected} movements={movementsQuery.data?.items ?? []} pending={movementsQuery.isPending} error={movementsQuery.error instanceof Error ? movementsQuery.error.message : ''} hasMore={Boolean(movementsQuery.data?.nextCursor)} loadingMore={movementsQuery.isFetching} onRetry={() => void movementsQuery.refetch()} onLoadMore={() => void loadMoreMovements()} onOpen={openMovement} onSelectAccount={setSelectedId} accounts={accounts} initials={initials(session.user.fullName)} onNavigate={setActiveTab} />;


  return <View style={styles.page}>
    <StatusBar barStyle="dark-content" />
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.topbar}><View><Text style={styles.brand}>Billetera MXN</Text><Text style={styles.eyebrow}>INICIO</Text></View><View style={styles.avatar}><Text style={styles.avatarText}>{initials(session.user.fullName)}</Text></View></View>
      <View style={styles.greeting}><View><Text style={styles.title}>Hola, {session.user.fullName.split(' ')[0]}</Text><Text style={styles.muted}>Tus cuentas y saldos</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Cerrar sesión" style={styles.iconButton} onPress={() => void endSession()}><Ionicons name="log-out-outline" size={25} color={colors.text} /></Pressable></View>
      {accountsQuery.isPending ? <Centered><ActivityIndicator color={colors.primary} /><Text style={styles.muted}>Cargando tus cuentas…</Text></Centered> : accountsQuery.isError ? <View style={styles.notice}><Ionicons name="cloud-offline-outline" size={22} color={colors.error} /><Text style={styles.errorText}>{accountsQuery.error.message}</Text><Button title="Reintentar" onPress={() => void accountsQuery.refetch()} /></View> : accounts.length === 0 ? <View style={styles.notice}><Text style={styles.sectionTitle}>Aún no tienes cuentas</Text><Text style={styles.muted}>Cuando haya una cuenta disponible, aparecerá aquí.</Text></View> : <>
        <View style={styles.accountTabs}>{accounts.map((account) => <Pressable key={account.id} accessibilityRole="button" accessibilityState={{ selected: selected?.id === account.id }} style={[styles.tab, selected?.id === account.id && styles.tabSelected]} onPress={() => setSelectedId(account.id)}><Text numberOfLines={1} style={[styles.tabText, selected?.id === account.id && styles.tabTextSelected]}>{account.name}</Text></Pressable>)}</View>
        {selected && <View style={styles.balanceCard}><View style={styles.accountLabel}><Text style={styles.tag}>{selected.kind === 'checking' ? 'CUENTA PRINCIPAL' : 'CUENTA DE AHORRO'}</Text><Text style={styles.muted}>{selected.clabeMasked}</Text></View><Text style={styles.label}>Saldo disponible</Text><View style={styles.balanceLine}><Text adjustsFontSizeToFit numberOfLines={1} style={styles.balance}>{formatBalance(selected.availableBalanceMinor)}</Text><Text style={styles.currency}> MXN</Text></View></View>}
      </>}
        {destination ? <View style={styles.destinationCard}><View style={styles.destinationIcon}><Ionicons name="person-outline" size={22} color={colors.primary} /></View><View style={{ flex: 1 }}><Text style={styles.tag}>DESTINO SELECCIONADO</Text><Text style={styles.rowTitle}>{destination.name}</Text><Text style={styles.muted}>{destination.alias} · {destination.clabeMasked}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Cambiar beneficiario" onPress={() => setChoosingBeneficiary(true)}><Text style={styles.link}>Cambiar</Text></Pressable></View> : <Pressable accessibilityRole="button" accessibilityLabel="Elegir beneficiario" style={styles.transferEntry} onPress={() => { setChoosingBeneficiary(true); setBeneficiarySearch(''); }}><View style={styles.accountIcon}><Ionicons name="send-outline" size={22} color={colors.primary} /></View><View style={{ flex: 1 }}><Text style={styles.rowTitle}>Transferir dinero</Text><Text style={styles.muted}>Elige un destino registrado en la web</Text></View><Ionicons name="chevron-forward" size={22} color={colors.primary} /></Pressable>}
        {destination && !choosingBeneficiary && <Button title="Continuar con transferencia" disabled={!selected} onPress={() => { setTransferScreen('details'); setTransferError(''); }} />}
      {accounts.length > 0 && <>
         <View style={styles.notice}><Ionicons name="time-outline" size={23} color={colors.primary} /><View style={{ flex: 1 }}><Text style={styles.sectionTitle}>Saldo actualizado</Text><Text style={styles.muted}>Saldo total en tus cuentas: {formatBalance(totalBalanceMinor)} MXN</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Actualizar cuentas" hitSlop={10} onPress={() => void accountsQuery.refetch()}><Ionicons name="refresh" size={21} color={colors.primary} /></Pressable></View>
         <View style={styles.activityHeader}><Text style={styles.sectionTitle}>Movimientos recientes</Text><Text style={styles.eyebrow}>ÚLTIMOS 20</Text></View>
         {movementsQuery.isPending ? <Centered><ActivityIndicator color={colors.primary} /><Text style={styles.muted}>Cargando movimientos…</Text></Centered> : movementsQuery.isError ? <View style={styles.notice}><Ionicons name="cloud-offline-outline" size={22} color={colors.error} /><View style={{ flex: 1 }}><Text style={styles.errorText}>{movementsQuery.error.message || 'Sin conexión. Revisa tu conexión e inténtalo de nuevo.'}</Text><Button title="Reintentar" onPress={() => void movementsQuery.refetch()} /></View></View> : (movementsQuery.data?.items.length ?? 0) === 0 ? <View style={styles.emptyState}><Ionicons name="receipt-outline" size={28} color={colors.primary} /><Text style={styles.sectionTitle}>Aún no hay movimientos</Text><Text style={styles.muted}>Los movimientos de esta cuenta aparecerán aquí.</Text></View> : <View style={styles.listCard}>{movementsQuery.data?.items.map((movement, index) => <Pressable key={movement.id} accessibilityRole="button" accessibilityLabel={`${movement.type === 'debit' ? 'Cargo' : 'Abono'} ${formatBalance(movement.amountMinor)} pesos, ${movement.concept}`} onPress={() => void openMovement(movement)} style={[styles.accountRow, index > 0 && styles.divider]}><View style={styles.accountIcon}><Ionicons name={movement.type === 'debit' ? 'arrow-up-outline' : 'arrow-down-outline'} size={21} color={colors.primary} /></View><View style={{ flex: 1 }}><Text style={styles.rowTitle}>{movement.concept}</Text><Text style={styles.muted}>{new Date(movement.occurredAt).toLocaleString('es-MX')} · {movement.status === 'completed' ? 'Completado' : movement.status === 'processing' ? 'En proceso' : 'Rechazado'}</Text></View><Text style={styles.rowBalance}>{movement.type === 'debit' ? '−' : '+'}{formatBalance(movement.amountMinor)}</Text></Pressable>)}{movementsQuery.data?.nextCursor ? <View style={styles.loadMore}><Button title={movementsQuery.isFetching ? 'Cargando…' : 'Cargar más movimientos'} disabled={movementsQuery.isFetching} onPress={() => void loadMoreMovements()} />{'loadMoreError' in (movementsQuery.data ?? {}) ? <Text accessibilityRole="alert" style={styles.errorText}>{String((movementsQuery.data as typeof movementsQuery.data & { loadMoreError?: string })?.loadMoreError)}</Text> : null}</View> : null}</View>}
        <View style={styles.activityHeader}><Text style={styles.sectionTitle}>Tus cuentas</Text><Text style={styles.eyebrow}>{accounts.length} {accounts.length === 1 ? 'CUENTA' : 'CUENTAS'}</Text></View>
        <View style={styles.listCard}>{accounts.map((account, index) => <Pressable key={account.id} accessibilityRole="button" accessibilityLabel={`${account.name}, saldo ${formatBalance(account.availableBalanceMinor)} pesos`} accessibilityState={{ selected: selected?.id === account.id }} onPress={() => setSelectedId(account.id)} style={[styles.accountRow, index > 0 && styles.divider]}><View style={styles.accountIcon}><Ionicons name={account.kind === 'checking' ? 'wallet-outline' : 'bookmark-outline'} size={22} color={colors.primary} /></View><View style={{ flex: 1 }}><Text style={styles.rowTitle}>{account.name}</Text><Text style={styles.muted}>{account.clabeMasked} · MXN</Text></View><Text style={styles.rowBalance}>{formatBalance(account.availableBalanceMinor)}</Text></Pressable>)}</View>
      </>}
     </ScrollView>
     <BottomNavigation active="home" onChange={setActiveTab}/>
   </View>;
}

function MovementListScreen(props: { account: Account | undefined; accounts: Account[]; initials: string; movements: Movement[]; pending: boolean; error: string; hasMore: boolean; loadingMore: boolean; onRetry: () => void; onLoadMore: () => void; onOpen: (movement: Movement) => void; onSelectAccount: (id: string) => void; onNavigate: (tab: 'home' | 'movements') => void }) {
  const [choosingAccount, setChoosingAccount] = useState(false);
  const groups = props.movements.reduce<{ key: string; label: string; items: Movement[] }[]>((result, movement) => {
    const date = new Date(movement.occurredAt);
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    const group = result.find((entry) => entry.key === key);
    if (group) group.items.push(movement);
    else result.push({ key, label: movementDayLabel(date), items: [movement] });
    return result;
  }, []);
  const multipleAccounts = props.accounts.length > 1;
  return <View style={styles.page}><StatusBar barStyle="dark-content"/><ScrollView contentContainerStyle={styles.content}>
    <View style={styles.topbar}><View><Text style={styles.brand}>Billetera MXN</Text><Text style={styles.eyebrow}>MOVIMIENTOS</Text></View><View style={styles.avatar}><Text style={styles.avatarText}>{props.initials}</Text></View></View>
    {props.account && <View style={styles.movementAccountCard}>
      <View style={styles.movementAccountTop}>
        <View style={styles.bankIcon}><MaterialIcons name="account-balance" size={24} color={colors.primary}/></View>
        <Pressable accessibilityRole="button" accessibilityLabel={multipleAccounts ? `Cuenta ${props.account.name}, cambiar cuenta` : `Cuenta ${props.account.name}`} accessibilityState={{ expanded: choosingAccount, disabled: !multipleAccounts }} disabled={!multipleAccounts} onPress={() => setChoosingAccount(!choosingAccount)} style={styles.accountPicker}>
          <Text style={styles.movementAccountName}>{props.account.name} (•• {lastDigits(props.account.clabeMasked)})</Text>
          {multipleAccounts && <Ionicons name={choosingAccount ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted}/>}
        </Pressable>
        <View style={styles.movementBalance}><Text style={styles.eyebrow}>SALDO DISPONIBLE</Text><Text adjustsFontSizeToFit numberOfLines={1} style={styles.movementBalanceAmount}>{formatBalance(props.account.availableBalanceMinor)}</Text><Text style={styles.currency}>MXN</Text></View>
      </View>
      {multipleAccounts && choosingAccount && <View style={styles.accountOptions}>{props.accounts.map((account) => <Pressable key={account.id} accessibilityRole="button" accessibilityLabel={`Ver movimientos de ${account.name}`} accessibilityState={{ selected: account.id === props.account?.id }} onPress={() => { props.onSelectAccount(account.id); setChoosingAccount(false); }} style={[styles.accountOption, account.id === props.account?.id && styles.accountOptionSelected]}><Text numberOfLines={1} style={[styles.rowTitle, styles.summaryCopy]}>{account.name} (•• {lastDigits(account.clabeMasked)})</Text><Text style={styles.muted}>{formatBalance(account.availableBalanceMinor)} MXN</Text></Pressable>)}</View>}
    </View>}
    <Text style={styles.movementsTitle}>Últimos movimientos</Text>
    {props.pending ? <Centered><ActivityIndicator color={colors.primary}/><Text style={styles.muted}>Cargando movimientos…</Text></Centered> : props.error ? <View style={styles.emptyState}><Ionicons name="cloud-offline-outline" size={28} color={colors.error}/><Text style={styles.errorText}>{props.error}</Text><Button title="Reintentar" onPress={props.onRetry}/></View> : props.movements.length === 0 ? <View style={styles.emptyState}><Ionicons name="receipt-outline" size={28} color={colors.primary}/><Text style={styles.sectionTitle}>Aún no hay movimientos</Text><Text style={styles.muted}>Los movimientos de esta cuenta aparecerán aquí.</Text></View> : <>
      {groups.map((group) => <View key={group.key} style={styles.movementGroup}>
        <View style={styles.movementGroupHeading}><Text style={styles.groupLabel}>{group.label.toLocaleUpperCase('es-MX')}</Text><Text style={styles.groupCount}>{group.items.length} {group.items.length === 1 ? 'transacción' : 'transacciones'}</Text></View>
        <View style={styles.movementCard}>{group.items.map((movement) => {
          const credit = movement.type === 'credit';
          return <Pressable key={movement.id} accessibilityRole="button" accessibilityLabel={`${credit ? 'Abono' : 'Cargo'} ${formatBalance(movement.amountMinor)} pesos, ${movement.concept}`} onPress={() => props.onOpen(movement)} style={styles.movementRow}>
            <View style={[styles.movementIcon, credit && styles.creditIcon]}><MaterialIcons name={credit ? 'south-west' : 'north-east'} size={24} color={credit ? colors.success : colors.primary}/></View>
            <View style={styles.movementCopy}>
              <Text numberOfLines={1} style={styles.movementTitle}>{movement.concept}</Text>
              <Text numberOfLines={1} style={[styles.movementSub, credit && styles.creditAmount]}>{credit ? 'Abono' : 'Cargo'} · {movementStatusLabel(movement.status)}</Text>
              <Text numberOfLines={2} style={styles.movementMeta}>Ref: {movement.reference} • {new Date(movement.occurredAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</Text>
            </View>
            <View style={styles.movementAmountColumn}><Text adjustsFontSizeToFit numberOfLines={1} style={[styles.movementAmount, credit && styles.creditAmount]}>{credit ? '+' : '-'}{formatBalance(movement.amountMinor)}</Text><Text style={[styles.currency, credit && styles.creditAmount]}>MXN</Text></View>
            <Ionicons name="chevron-forward" size={20} color={colors.muted}/>
          </Pressable>;
        })}</View>
      </View>)}
      {props.hasMore && <Button title={props.loadingMore ? 'Cargando…' : 'Cargar más movimientos'} disabled={props.loadingMore} onPress={props.onLoadMore}/>}
      <Text style={styles.movementsFooter}>Puedes consultar más movimientos en la web</Text>
    </>}
  </ScrollView><BottomNavigation active="movements" onChange={props.onNavigate}/></View>;
}

function transferStatusLabel(status: Transfer['status'] | undefined): string {
  if (status === 'awaiting_confirmation') return 'Pendiente de confirmación';
  if (status === 'processing') return 'En proceso';
  if (status === 'completed') return 'Completada';
  if (status === 'rejected') return 'Rechazada';
  return 'En verificación de estado';
}

function movementStatusLabel(status: Movement['status']): string {
  return status === 'completed' ? 'Completado' : status === 'processing' ? 'En proceso' : 'Rechazado';
}

function movementDayLabel(date: Date, now = new Date()): string {
  const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  const shortDate = `${date.getDate()} ${date.toLocaleDateString('es-MX', { month: 'short' }).replace('.', '')} ${date.getFullYear()}`;
  if (days === 0) return `Hoy (${shortDate})`;
  if (days === 1) return `Ayer (${shortDate})`;
  return `${date.getDate()} de ${date.toLocaleDateString('es-MX', { month: 'long' })} ${date.getFullYear()}`;
}

function lastDigits(masked: string): string { return masked.replace(/\D/g, '').slice(-4); }

function BottomNavigation({ active, onChange }: { active: 'home' | 'movements'; onChange: (tab: 'home' | 'movements') => void }) {
  return <View style={styles.bottomNavigation}>{(['home', 'movements'] as const).map((tab) => <Pressable key={tab} accessibilityRole="tab" accessibilityState={{ selected: active === tab }} onPress={() => onChange(tab)} style={styles.navigationItem}><Ionicons name={tab === 'home' ? 'wallet-outline' : 'receipt-outline'} size={24} color={active === tab ? colors.primary : colors.muted}/><Text style={[styles.navigationLabel, active === tab && styles.navigationLabelActive]}>{tab === 'home' ? 'Inicio' : 'Movimientos'}</Text></Pressable>)}</View>;
}

function BeneficiaryPickerScreen(props: { queryPending: boolean; error: string; beneficiaries: Beneficiary[]; total: number; search: string; setSearch: (value: string) => void; userInitials: string; backLabel: string; onRetry: () => void; onClose: () => void; onChoose: (beneficiary: Beneficiary) => void }) {
  const empty = !props.queryPending && !props.error && props.total === 0;
  return <View style={styles.page}><StatusBar barStyle="dark-content"/>
    <ScreenHeader title="Transferir" backLabel={props.backLabel} onBack={props.onClose} userInitials={props.userInitials}/>
    <ScrollView contentContainerStyle={styles.pickerContent} keyboardShouldPersistTaps="handled">
      <Text style={styles.pickerTitle}>Elegir beneficiario</Text>
      <Text style={styles.pickerDescription}>Selecciona la cuenta destino para enviar fondos.</Text>
      <View style={styles.searchWrap}><Ionicons name="search" size={20} color={colors.placeholder}/><TextInput accessibilityLabel="Buscar beneficiario" value={props.search} onChangeText={props.setSearch} placeholder="Buscar por nombre o alias…" placeholderTextColor={colors.placeholder} autoCapitalize="none" style={styles.searchInput}/>{props.search ? <Pressable accessibilityRole="button" accessibilityLabel="Limpiar búsqueda" hitSlop={10} onPress={() => props.setSearch('')}><Ionicons name="close-circle" size={18} color={colors.placeholder}/></Pressable> : null}</View>
      {props.total > 0 && <View style={styles.filterRow}><View accessibilityRole="text" style={styles.filterChip}><Text style={styles.filterChipText}>Todos ({props.total})</Text></View></View>}
      {!empty && <View style={styles.pickerMeta}><Text style={styles.captionLabel}>CONTACTOS DISPONIBLES</Text><Text style={styles.captionMeta}>Billetera MXN</Text></View>}
      {props.queryPending ? <Centered><ActivityIndicator color={colors.primary}/><Text style={styles.muted}>Cargando beneficiarios…</Text></Centered>
        : props.error ? <View style={styles.emptyState}><Ionicons name="cloud-offline-outline" size={28} color={colors.error}/><Text style={styles.errorText}>{props.error}</Text><Button title="Reintentar" onPress={props.onRetry}/></View>
        : empty ? <View style={styles.pickerEmpty}><View style={styles.pickerEmptyIcon}><Ionicons name="person" size={22} color={colors.muted}/></View><Text style={styles.pickerEmptyTitle}>No tienes beneficiarios guardados</Text><Text style={styles.pickerEmptyText}>Los beneficiarios se registran y administran únicamente desde la plataforma web.</Text></View>
        : props.beneficiaries.length === 0 ? <View style={styles.pickerEmpty}><Text style={styles.pickerEmptyTitle}>Sin resultados</Text><Text style={styles.pickerEmptyText}>Prueba con otro nombre o alias.</Text></View>
        : props.beneficiaries.map((beneficiary) => <Pressable key={beneficiary.id} accessibilityRole="button" accessibilityLabel={`Seleccionar ${beneficiary.name}, ${beneficiary.alias}, CLABE ${beneficiary.clabeMasked}`} onPress={() => props.onChoose(beneficiary)} style={({ pressed }) => [styles.beneficiaryCard, pressed && styles.beneficiaryCardPressed]}>
          <View style={styles.beneficiaryAvatar}><Text style={styles.beneficiaryInitials}>{initials(beneficiary.name)}</Text></View>
          <View style={styles.summaryCopy}>
            <View style={styles.beneficiaryNameLine}><Text numberOfLines={1} style={styles.beneficiaryName}>{beneficiary.name}</Text><Text numberOfLines={1} style={styles.aliasBadge}>{beneficiary.alias}</Text></View>
            <Text numberOfLines={1} style={styles.beneficiaryAccount}>Billetera MXN •• {lastDigits(beneficiary.clabeMasked)}</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.placeholder}/>
        </Pressable>)}
      {!empty && <View style={styles.pickerFooter}><Ionicons name="information-circle-outline" size={18} color={colors.muted}/><Text style={styles.pickerFooterText}>Los beneficiarios se registran y administran únicamente desde la versión web.</Text></View>}
    </ScrollView>
  </View>;
}

function LoginScreen(props: { email: string; password: string; setEmail: (value: string) => void; setPassword: (value: string) => void; passwordVisible: boolean; setPasswordVisible: (value: boolean) => void; error: string; submitting: boolean; onSubmit: () => void }) {
  return <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><StatusBar barStyle="dark-content" /><ScrollView contentContainerStyle={styles.loginContent} keyboardShouldPersistTaps="handled">
    <View style={styles.loginBrand}><View style={styles.walletMark}><Ionicons name="wallet-outline" size={28} color={colors.primary} /></View><Text style={styles.eyebrow}>BILLETERA MXN</Text><Text style={styles.loginTitle}>Inicia sesión</Text><Text style={styles.loginSubtitle}>Ingresa con tu correo y contraseña registrados en el panel web.</Text></View>
    <View style={styles.formCard}><Text style={styles.label}>Correo electrónico</Text><View style={styles.inputWrap}><Ionicons name="mail-outline" size={20} color={colors.muted} /><TextInput accessibilityLabel="Correo electrónico" autoCapitalize="none" autoComplete="email" keyboardType="email-address" returnKeyType="next" value={props.email} onChangeText={props.setEmail} placeholder="tu@correo.com" placeholderTextColor={colors.placeholder} style={styles.input} /></View><Text style={[styles.label, { marginTop: 18 }]}>Contraseña</Text><View style={styles.inputWrap}><Ionicons name="lock-closed-outline" size={20} color={colors.muted} /><TextInput accessibilityLabel="Contraseña" autoCapitalize="none" autoComplete="password" secureTextEntry={!props.passwordVisible} returnKeyType="done" onSubmitEditing={props.onSubmit} value={props.password} onChangeText={props.setPassword} placeholder="Tu contraseña" placeholderTextColor={colors.placeholder} style={styles.input} /><Pressable accessibilityRole="button" accessibilityLabel={props.passwordVisible ? 'Ocultar contraseña' : 'Mostrar contraseña'} hitSlop={10} onPress={() => props.setPasswordVisible(!props.passwordVisible)}><Ionicons name={props.passwordVisible ? 'eye-off-outline' : 'eye-outline'} size={21} color={colors.muted} /></Pressable></View>
       {props.error ? <Text accessibilityRole="alert" style={styles.errorText}>{props.error}</Text> : null}<Button title="Ingresar" loading={props.submitting} disabled={props.submitting} onPress={props.onSubmit} /></View>
    <View style={styles.infoBox}><Ionicons name="information-circle-outline" size={22} color={colors.muted} /><Text style={styles.infoText}><Text style={styles.bold}>¿No tienes cuenta? </Text>El registro se realiza exclusivamente desde el panel web.</Text></View>
  </ScrollView></KeyboardAvoidingView>;
}

function TransferFlow(props: { screen: 'details' | 'review' | 'otp' | 'status' | 'receipt' | 'rejected'; amount: string; setAmount: (value: string) => void; concept: string; setConcept: (value: string) => void; reference: string; setReference: (value: string) => void; otp: string; setOtp: (value: string) => void; destination: Beneficiary | null; source: Account | undefined; transfer: Transfer | null; demoOnlyCode: string; error: string; busy: boolean; createRetry: boolean; confirmRetry: boolean; otpExpired: boolean; pendingPayload: TransferRequest | null; userInitials: string; onChangeBeneficiary: () => void; onRequestNewCode: () => void; onLeave: () => void; onBack: () => void; onReview: () => void; onCreate: () => void; onRetryCreate: () => void; onConfirm: () => void; onRetryConfirm: () => void; onCheck: () => void; onDone: () => void }) {
  const minor = amountToMinor(props.amount);
  const insufficient = Boolean(minor && props.source && BigInt(minor) > BigInt(props.source.availableBalanceMinor));
  const formValid = Boolean(minor && props.concept.trim().length >= 1 && props.concept.trim().length <= 40 && /^\d{1,7}$/.test(props.reference));
  const statusTitle = props.busy ? 'Consultando operación…' : 'Estamos verificando si tu transferencia se completó';
  const headerTitle = props.screen === 'status' || props.screen === 'receipt' ? 'Detalle' : 'Transferir';
  const headerBack = props.screen === 'review' || props.screen === 'otp' ? props.onBack : props.screen === 'status' ? props.onLeave : props.onDone;
  const headerBackLabel = props.screen === 'otp' ? 'Cancelar y volver a revisar' : props.screen === 'status' ? 'Ir al inicio' : props.screen === 'receipt' || props.screen === 'rejected' ? 'Volver al inicio' : 'Volver';
  const trackedAmount = props.transfer?.amountMinor ?? props.pendingPayload?.amountMinor;
  const trackedReference = props.transfer?.reference ?? props.pendingPayload?.reference;
  const recipient = props.transfer ? `${props.transfer.destination.name} •• ${lastDigits(props.transfer.destination.clabeMasked)}` : props.destination ? `${props.destination.name} •• ${lastDigits(props.destination.clabeMasked)}` : '—';
  return <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}><StatusBar barStyle="dark-content"/><ScreenHeader title={headerTitle} backLabel={headerBackLabel} onBack={headerBack} userInitials={props.userInitials} tone={headerTitle === 'Detalle' ? 'pale' : 'solid'}/><ScrollView contentContainerStyle={[styles.flowContent, styles.steppedContent]} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}>
    {props.screen === 'details' && <View style={styles.progressHeader}><View style={styles.progressLabels}><Text style={styles.progressActive}>PASO 1 DE 2</Text><Text style={styles.progressPercent}>50% completado</Text></View><Text style={styles.progressTitle}>Datos de la operación</Text><View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 2, now: 1 }} style={styles.progressTrack}><View style={styles.progressFill}/></View></View>}
    {props.screen === 'review' && <View style={styles.progressHeader}><View style={styles.progressLabels}><Text style={styles.reviewStep}>Paso 2 de 2</Text><Text style={styles.reviewStepLabel}>Revisar transferencia</Text></View><View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 2, now: 2 }} style={styles.progressTrack}><View style={[styles.progressFill, styles.progressComplete]}/></View></View>}
    {props.screen === 'details' && <>
      <View style={styles.formSection}>
        <View style={styles.cardHeaderRow}><Text style={styles.cardLabel}>Cuenta de origen</Text><Text style={styles.debitBadge}>Débito</Text></View>
        <View style={styles.accountSummary}><View style={styles.originIcon}><Ionicons name="wallet-outline" size={20} color={colors.primary}/></View><View style={styles.summaryCopy}><Text numberOfLines={1} style={styles.originName}>{props.source ? `${props.source.name} •• ${lastDigits(props.source.clabeMasked)}` : 'Selecciona una cuenta'}</Text><Text style={styles.originBalance}>Saldo disponible: <Text style={styles.strongText}>{props.source ? `${formatBalance(props.source.availableBalanceMinor)} MXN` : '—'}</Text></Text></View></View>
      </View>
      <View style={styles.formSection}>
        <View style={styles.cardHeaderRow}><Text style={styles.cardLabel}>Beneficiario destino</Text><Pressable accessibilityRole="button" accessibilityLabel="Cambiar beneficiario" hitSlop={8} style={styles.changeLink} onPress={props.onChangeBeneficiary}><Text style={styles.changeLinkText}>Cambiar beneficiario</Text></Pressable></View>
        {props.destination ? <View style={styles.destinationBox}><View style={styles.beneficiaryNameLine}><Text numberOfLines={1} style={styles.destinationName}>{props.destination.name}</Text><Text numberOfLines={1} style={styles.aliasBadgeMuted}>{props.destination.alias}</Text></View><Text style={styles.destinationAccount}>Billetera MXN •• {lastDigits(props.destination.clabeMasked)}</Text></View> : null}
        <View style={styles.inlineNote}><Ionicons name="information-circle-outline" size={16} color={colors.muted}/><Text style={styles.inlineNoteText}>Los beneficiarios se registran y administran únicamente desde la web.</Text></View>
      </View>
      <View style={[styles.formSection, styles.formFields]}>
        <View><Text style={styles.fieldLabel}>Monto a transferir <Text style={styles.required}>*</Text></Text><View style={styles.amountInputWrap}><Text style={styles.amountPrefix}>$</Text><TextInput accessibilityLabel="Importe" keyboardType="decimal-pad" value={props.amount} onChangeText={props.setAmount} placeholder="0.00" placeholderTextColor={colors.placeholder} style={styles.amountInput}/><Text style={styles.currencyBadge}>MXN</Text></View><Text style={styles.fieldHint}>Disponible: <Text style={styles.strongText}>{props.source ? `${formatBalance(props.source.availableBalanceMinor)} MXN` : '—'}</Text></Text></View>
        <View><View style={styles.fieldLabelRow}><Text style={styles.fieldLabel}>Concepto de pago <Text style={styles.required}>*</Text></Text><Text style={styles.fieldCounter}>{props.concept.length}/40</Text></View><TextInput accessibilityLabel="Concepto" value={props.concept} onChangeText={props.setConcept} maxLength={40} placeholder="Ej. Pago servicio, renta" placeholderTextColor={colors.placeholder} style={styles.flowInput}/></View>
        <View><Text style={styles.fieldLabel}>Referencia numérica (hasta 7 dígitos) <Text style={styles.required}>*</Text></Text><View style={styles.referenceWrap}><TextInput accessibilityLabel="Referencia" keyboardType="number-pad" value={props.reference} onChangeText={(value) => props.setReference(value.replace(/\D/g, '').slice(0, 7))} maxLength={7} placeholder="Ej. 1234567" placeholderTextColor={colors.placeholder} style={styles.referenceInput}/><MaterialIcons name="tag" size={18} color={colors.muted}/></View></View>
      </View>
      {insufficient && <Text accessibilityRole="alert" style={styles.errorText}>Saldo insuficiente para este importe.</Text>}
      {!insufficient && props.amount && !minor && <Text accessibilityRole="alert" style={styles.errorText}>Escribe un importe positivo con máximo dos decimales.</Text>}
    </>}
    {props.screen === 'review' && <>{__DEV__ && <Text style={{ color: '#ff005c', fontSize: 11, fontWeight: '700', textAlign: 'center' }}>DIAG-MOBILE-32693d3-M07</Text>}
      <View style={styles.reviewHero}>
        <View style={styles.heroIcon}><Ionicons name="arrow-forward-circle-outline" size={26} color={colors.primary}/></View>
        <Text style={styles.reviewHeroLabel}>Monto a transferir</Text>
        <View style={styles.reviewAmountLine}><Text adjustsFontSizeToFit numberOfLines={1} style={styles.reviewAmount}>{minor ? formatBalance(minor) : '—'}</Text><Text style={styles.amountCurrency}> MXN</Text></View>
      </View>
      <View style={styles.reviewCard}>
        <View style={styles.reviewParty}>
          <View style={styles.reviewPartyIcon}><Ionicons name="wallet-outline" size={20} color={colors.muted}/></View>
          <View style={styles.summaryCopy}>
            <Text style={styles.reviewCaption}>CUENTA DE ORIGEN</Text>
            <Text numberOfLines={1} style={styles.reviewPartyName}>{props.source ? `${props.source.name} •• ${lastDigits(props.source.clabeMasked)}` : '—'}</Text>
            {props.source ? <Text style={styles.originBalance}>Saldo disponible: <Text style={styles.strongText}>{formatBalance(props.source.availableBalanceMinor)} MXN</Text></Text> : null}
          </View>
        </View>
        <View style={styles.reviewDirection}><View style={styles.reviewDirectionLine}/><Ionicons name="arrow-down" size={15} color={colors.primary}/><Text style={styles.reviewDirectionText}>TRANSFERENCIA INTERNA</Text><View style={styles.reviewDirectionLine}/></View>
        <View style={styles.reviewParty}>
          <View style={[styles.reviewPartyIcon, styles.reviewPartyIconDestination]}><Ionicons name="person-outline" size={20} color={colors.primary}/></View>
          <View style={styles.summaryCopy}>
            <Text style={styles.reviewCaption}>DESTINATARIO</Text>
            <Text numberOfLines={1} style={styles.reviewPartyName}>{props.destination ? `${props.destination.name} (${props.destination.alias}) •• ${lastDigits(props.destination.clabeMasked)}` : '—'}</Text>
            <Text style={styles.originBalance}>Billetera MXN</Text>
          </View>
        </View>
        <View style={styles.reviewMeta}>
          <MetaRow label="Concepto" value={props.concept.trim()}/>
          <MetaRow label="Referencia numérica" value={props.reference}/>
          <View style={styles.metaRow}><Text style={styles.metaLabel}>Tipo de operación</Text><View style={styles.metaStatus}><View style={styles.successDot}/><Text style={styles.metaStatusText}>Transferencia interna</Text></View></View>
        </View>
      </View>
      {minor && props.source && BigInt(props.source.availableBalanceMinor) >= BigInt(minor) ? <EstimatedBalance availableMinor={props.source.availableBalanceMinor} amountMinor={minor}/> : null}
      {props.error ? <Text accessibilityRole="alert" style={styles.errorText}>{props.error}</Text> : null}
      <Button title="Confirmar transferencia" trailingIcon="arrow-forward" loading={props.busy} disabled={props.busy} onPress={props.onCreate}/>
      <Pressable accessibilityRole="button" style={styles.modifyAction} onPress={props.onBack}><Text style={styles.link}>Modificar datos</Text></Pressable>
    </>}
    {props.screen === 'otp' && <>
      <View style={styles.otpContext}>
        <View style={styles.otpContextTop}><View style={styles.estimateLabel}><Ionicons name="shield-checkmark-outline" size={20} color={colors.primary}/><Text style={styles.otpContextLabel}>Confirmación de seguridad</Text></View><Text style={styles.otpContextBadge}>Monto extraordinario</Text></View>
        <View style={styles.otpContextBody}>
          <View style={styles.summaryCopy}><Text style={styles.reviewCaption}>DESTINATARIO</Text><Text numberOfLines={1} style={styles.otpContextName}>{recipient}</Text><Text style={styles.originBalance}>(Billetera MXN)</Text></View>
          <View style={styles.otpContextAmount}><Text style={styles.reviewCaption}>IMPORTE</Text><Text adjustsFontSizeToFit numberOfLines={1} style={styles.otpContextValue}>{props.transfer ? formatBalance(props.transfer.amountMinor) : '—'}<Text style={styles.amountCurrency}> MXN</Text></Text></View>
        </View>
        <View style={styles.otpContextNote}><Ionicons name="information-circle-outline" size={16} color={colors.placeholder}/><Text style={styles.estimateNoteText}>Operación sobre el umbral de verificación configurado (escenario ilustrativo de demostración)</Text></View>
      </View>
      <View style={styles.otpCard}>
        <View style={styles.otpBadge}><View style={styles.otpBadgeDot}/><Text style={styles.otpBadgeText}>CÓDIGO DE DEMOSTRACIÓN</Text></View>
        <Text style={styles.otpTitle}>Código de confirmación</Text>
        <Text style={styles.otpDescription}>Ingresa el código de demostración de 6 dígitos para autorizar el traspaso por <Text style={styles.strongText}>{props.transfer ? `${formatBalance(props.transfer.amountMinor)} MXN` : '—'}</Text> a {recipient}.</Text>
        {props.demoOnlyCode && !props.otpExpired ? <View style={styles.demoCodeBox}><Ionicons name="information-circle-outline" size={18} color={colors.muted}/><Text style={styles.demoCodeLabel}>Código asignado para esta prueba: <Text style={styles.demoCodeValue}>{props.demoOnlyCode}</Text></Text></View> : null}
        <View style={styles.otpDigits} pointerEvents="none">{Array.from({ length: 6 }, (_, index) => <View key={index} style={[styles.otpDigit, index < props.otp.length && styles.otpDigitFilled, props.otpExpired && styles.otpDigitExpired]}>{props.otp[index] ? <View style={styles.otpDot}/> : <View style={styles.otpDash}/>}</View>)}</View>
        <TextInput accessibilityLabel="Código de confirmación" keyboardType="number-pad" maxLength={6} editable={!props.otpExpired} value={props.otp} onChangeText={(value) => props.setOtp(value.replace(/\D/g, '').slice(0, 6))} style={styles.otpInput}/>
        {props.otpExpired ? <View style={styles.otpExpiredBlock}>
          <View accessibilityRole="alert" style={styles.otpExpiredBanner}><Ionicons name="timer-outline" size={20} color={colors.warning}/><Text style={styles.otpExpiredText}>El código ha expirado. Por seguridad solicita uno nuevo para continuar.</Text></View>
          <Button title="Solicitar nuevo código de demostración" variant="secondary" leadingIcon="refresh" loading={props.busy} disabled={props.busy} onPress={props.onRequestNewCode}/>
        </View> : null}
      </View>
      {!props.otpExpired && props.error ? <Text accessibilityRole="alert" style={styles.errorText}>{props.error}</Text> : null}
      <Button title="Autorizar transferencia" leadingIcon="lock-open-outline" loading={props.busy && !props.otpExpired} disabled={props.busy || props.otpExpired || !/^\d{6}$/.test(props.otp)} onPress={props.onConfirm}/>
      {props.confirmRetry && !props.otpExpired && <Button title="Reintentar envío del mismo código" variant="secondary" loading={props.busy} disabled={props.busy} onPress={props.onRetryConfirm}/>}
      <Button title="Cancelar y volver a revisar" variant="surface" leadingIcon="arrow-back" onPress={props.onBack}/>
    </>}
    {props.screen === 'status' && <>
      <View style={styles.statusIcon}>
        <View style={styles.statusIconInner}><Ionicons name={props.busy ? 'sync-outline' : 'cloud-offline-outline'} size={32} color={colors.muted}/></View>
        <View style={styles.statusIconBadge}><Ionicons name="hourglass-outline" size={16} color={colors.primary}/></View>
      </View>
      <View style={styles.statusPill}><Ionicons name="shield-checkmark-outline" size={16} color={colors.primary}/><Text style={styles.statusPillText}>Protección contra duplicados activa</Text></View>
      <Text style={styles.statusTitle}>{statusTitle}</Text>
      <View style={styles.statusCard}>
        <Text style={styles.statusMessage}>{props.busy || !trackedAmount
          ? 'Estamos comprobando el estado del intento para evitar una operación duplicada.'
          : <>No pudimos confirmar el resultado de la operación de <Text style={styles.strongText}>{formatBalance(trackedAmount)} MXN</Text>{recipient !== '—' ? <> a <Text style={styles.strongText}>{recipient}</Text></> : null}. Para evitar cobros duplicados, consultamos el estado del intento original{trackedReference ? ` (Ref: ${trackedReference})` : ''}.</>}</Text>
        {props.error ? <Text accessibilityRole="alert" style={styles.errorText}>{props.error}</Text> : null}
        <View style={styles.warningBox}><Ionicons name="information-circle-outline" size={20} color={colors.primary}/><View style={styles.summaryCopy}><Text style={styles.rowTitle}>No intentes enviar el dinero nuevamente</Text><Text style={styles.muted}>Verificar el estado consulta el intento original con su misma clave, sin duplicar el cargo.</Text></View></View>
      </View>
      <View style={styles.statusDetails}>
        <MetaRow label="Destinatario" value={props.transfer?.destination.name ?? props.destination?.name ?? '—'}/>
        <MetaRow label="Monto en verificación" value={trackedAmount ? `${formatBalance(trackedAmount)} MXN` : '—'}/>
        <MetaRow label="Referencia de seguimiento" value={trackedReference ?? '—'}/>
        <View style={styles.metaRow}><Text style={styles.metaLabel}>Estado actual</Text><Text style={styles.statusState}>{transferStatusLabel(props.transfer?.status)}</Text></View>
      </View>
      <Button title="Verificar estado de la transferencia" leadingIcon="sync-outline" loading={props.busy} disabled={props.busy || (!props.transfer && !props.createRetry)} onPress={props.transfer ? props.onCheck : props.onRetryCreate}/>
      <Button title="Ir al inicio (revisar saldo después)" variant="secondary" disabled={props.busy} onPress={props.onLeave}/>
    </>}
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
  </ScrollView>{props.screen === 'details' && <View style={styles.stickyFooter}><Button title="Continuar" trailingIcon="arrow-forward" disabled={!formValid || insufficient || !props.source || !props.destination} onPress={props.onReview}/></View>}</KeyboardAvoidingView>;
}

function MovementReceipt({ transfer, movementType, accounts, userInitials, onBack, onHome }: { transfer: Transfer; movementType: Movement['type'] | null; accounts: Account[]; userInitials: string; onBack: () => void; onHome: () => void }) {
  const completed = transfer.status === 'completed';
  const rejected = transfer.status === 'rejected';
  const credit = movementType === 'credit';
  const source = accounts.find((account) => account.id === transfer.sourceAccountId);
  const sign = movementType === 'debit' ? '-' : movementType === 'credit' ? '+' : '';
  const when = formatReceiptDate(transfer.completedAt ?? transfer.createdAt);
  const title = completed ? (credit ? 'Transferencia recibida' : 'Transferencia completada') : rejected ? 'Transferencia rechazada' : 'Transferencia en proceso';
  return <View style={styles.page}><StatusBar barStyle="dark-content"/>
    <ScreenHeader title="Detalle" backLabel="Volver a movimientos" onBack={onBack} userInitials={userInitials} tone="pale"/>
    <ScrollView contentContainerStyle={styles.detailContent}>
      <View style={styles.detailHero}>
        <View style={[styles.detailStatusIcon, !completed && styles.detailStatusIconPending, rejected && styles.detailStatusIconRejected]}><Ionicons name={completed ? 'checkmark-circle' : rejected ? 'close-circle' : 'time'} size={52} color={completed ? colors.success : rejected ? colors.error : colors.primary}/></View>
        <View style={styles.detailPill}><View style={[styles.successDot, !completed && { backgroundColor: rejected ? colors.error : colors.primary }]}/><Text style={styles.successPillText}>{completed ? 'Completada' : rejected ? 'Rechazada' : 'En proceso'}</Text></View>
        <Text style={styles.detailTitle}>{title}</Text>
        <Text adjustsFontSizeToFit numberOfLines={1} style={styles.detailAmount}>{sign}{formatBalance(transfer.amountMinor)} <Text style={styles.detailCurrency}>MXN</Text></Text>
        <Text style={styles.detailDate}>{when.text}</Text>
        {when.centralMexico ? <Text style={styles.detailZone}>(Tiempo del Centro de México)</Text> : null}
      </View>
      <View style={styles.detailCard}>
        <Text style={styles.receiptHeading}>DETALLES DE LA TRANSACCIÓN</Text>
        {source ? <View style={styles.detailStacked}><Text style={styles.muted}>Cuenta origen</Text><Text style={styles.detailStackedValue}>{source.name} •• {lastDigits(source.clabeMasked)}</Text></View> : null}
        <View style={styles.detailStacked}><Text style={styles.muted}>Cuenta destino</Text><View style={styles.detailDestination}><Ionicons name="person-circle-outline" size={20} color={colors.primary}/><Text style={styles.detailStackedValue}>{transfer.destination.name} •• {lastDigits(transfer.destination.clabeMasked)}</Text></View></View>
        <DetailRow label="Concepto" value={transfer.concept}/>
        <DetailRow label="Referencia" value={transfer.reference} emphasis/>
        <DetailRow label="Folio interno" value={transfer.receiptReference ?? transfer.id} accent/>
        <DetailRow label="Tipo de operación" value="Transferencia interna"/>
      </View>
      <Text style={styles.detailFootnote}>Comprobante de demostración técnica interna de Billetera MXN</Text>
      <Button title="Volver a movimientos" leadingIcon="arrow-back" onPress={onBack}/>
      <Button title="Ir al inicio" variant="secondary" leadingIcon="home-outline" onPress={onHome}/>
    </ScrollView>
  </View>;
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return <View style={styles.metaRow}><Text style={styles.metaLabel}>{label}</Text><Text numberOfLines={1} style={styles.metaValue}>{value}</Text></View>;
}

function EstimatedBalance({ availableMinor, amountMinor }: { availableMinor: string; amountMinor: string }) {
  const available = BigInt(availableMinor);
  const amount = BigInt(amountMinor);
  const after = available - amount;
  // Integer basis points keep the money arithmetic in BigInt; only the bar width becomes a number.
  const remainingBasisPoints = available > 0n ? Number((after * 10_000n) / available) : 0;
  return <View style={styles.estimateCard}>
    <View style={styles.estimateHeader}>
      <View style={styles.estimateLabel}><Ionicons name="calculator-outline" size={18} color={colors.primary}/><Text style={styles.estimateLabelText}>Saldo posterior estimado</Text></View>
      <Text adjustsFontSizeToFit numberOfLines={1} style={styles.estimateValue}>{formatBalance(after.toString())} MXN</Text>
    </View>
    <View style={styles.estimateMath}><Text style={styles.estimateMathText}>Cálculo:</Text><Text adjustsFontSizeToFit numberOfLines={1} style={[styles.estimateMathText, styles.estimateMathValue]}>{formatBalance(availableMinor)} - {formatBalance(amountMinor)} = {formatBalance(after.toString())} MXN</Text></View>
    <View accessible={false} style={styles.estimateTrack}><View style={[styles.estimateRemaining, { width: `${remainingBasisPoints / 100}%` }]}/><View style={styles.estimateSpent}/></View>
    <View style={styles.estimateNote}><Ionicons name="information-circle-outline" size={15} color={colors.muted}/><Text style={styles.estimateNoteText}>El envío aún no está confirmado. El saldo final se actualizará en tu cuenta una vez procesada la operación por el sistema.</Text></View>
  </View>;
}

function DetailRow({ label, value, emphasis = false, accent = false }: { label: string; value: string; emphasis?: boolean; accent?: boolean }) {
  return <View style={styles.detailRow}><Text style={styles.muted}>{label}</Text><Text style={[styles.detailRowValue, emphasis && styles.detailRowEmphasis, accent && styles.detailRowAccent]}>{value}</Text></View>;
}

function formatReceiptDate(iso: string): { text: string; centralMexico: boolean } {
  const date = new Date(iso);
  try {
    const formatter = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    // Only claim "Tiempo del Centro de México" when the engine really honoured the zone.
    if (formatter.resolvedOptions().timeZone === 'America/Mexico_City') {
      const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
      return { text: `${parts.day} de ${parts.month} de ${parts.year}, ${parts.hour}:${parts.minute} hrs`, centralMexico: true };
    }
  } catch { /* fall back to the device's local time without a zone label */ }
  return { text: `${date.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}, ${date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })} hrs`, centralMexico: false };
}

function ScreenHeader({ title, backLabel, onBack, userInitials, tone = 'solid' }: { title: string; backLabel: string; onBack: () => void; userInitials: string; tone?: 'pale' | 'solid' }) {
  return <View style={styles.screenHeader}>
    <Pressable accessibilityRole="button" accessibilityLabel={backLabel} hitSlop={8} style={styles.headerBack} onPress={onBack}><Ionicons name="arrow-back" size={24} color={colors.text}/></Pressable>
    <Text numberOfLines={1} style={styles.headerTitle}>{title}</Text>
    <View style={styles.flowHeaderSpacer}/>
    <View style={[styles.headerAvatar, tone === 'solid' && styles.headerAvatarSolid]}><Text style={[styles.avatarText, tone === 'solid' && styles.headerAvatarSolidText]}>{userInitials}</Text></View>
  </View>;
}

function amountToMinor(value: string): string | null {
  const normalized = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ''] = normalized.split('.');
  const minor = `${whole}${fraction.padEnd(2, '0')}`.replace(/^0+/, '');
  return minor && /[1-9]/.test(minor) ? minor : null;
}

function newIdempotencyKey(): string {
  // Hermes (the on-device JS engine Expo Go and production builds actually run) does not
  // reliably expose globalThis.crypto.randomUUID; expo-crypto provides the same RFC4122 v4 UUID
  // through a native module. Prefer the Web Crypto API where it genuinely exists (web target,
  // Jest's Node test environment) so behavior there is unchanged.
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (typeof Crypto.randomUUID === 'function') return Crypto.randomUUID();
  throw new Error('No se pudo crear una clave segura para el intento.');
}

function PrivacyScreen() { return <View style={styles.privacy}><View style={styles.privacyCard}><View style={styles.privacyIcon}><Ionicons name="eye-off-outline" size={34} color={colors.primary} /></View><Text style={styles.brand}>Billetera MXN</Text><View style={styles.privacyPill}><Ionicons name="shield-checkmark-outline" size={17} color={colors.primary}/><Text style={styles.privacyPillText}>Contenido oculto por privacidad</Text></View><Text style={[styles.muted, styles.center]}>La información confidencial y los saldos están ocultos mientras la aplicación está en segundo plano.</Text></View><View style={styles.privacyNote}><View style={styles.accountIcon}><Ionicons name="layers-outline" size={22} color={colors.primary}/></View><View style={styles.summaryCopy}><Text style={styles.rowTitle}>Privacidad en segundo plano</Text><Text style={styles.muted}>Esta vista protege tus saldos y datos de cuenta en el selector de aplicaciones de tu dispositivo móvil.</Text></View></View></View>; }
function Centered({ children }: { children: React.ReactNode }) { return <View style={styles.centered}>{children}</View>; }
function SummaryRow({ label, value, detail }: { label: string; value: string; detail?: string }) { return <View style={styles.summaryRow}><View style={styles.summaryCopy}><Text style={styles.muted}>{label}</Text>{detail ? <Text style={styles.summaryDetail}>{detail}</Text> : null}</View><Text style={styles.summaryValue}>{value}</Text></View>; }
type IconName = React.ComponentProps<typeof Ionicons>['name'];
function Button({ title, onPress, disabled, loading = false, variant = 'primary', leadingIcon, trailingIcon }: { title: string; onPress: () => void; disabled?: boolean; loading?: boolean; variant?: 'primary' | 'secondary' | 'surface'; leadingIcon?: IconName; trailingIcon?: IconName }) {
  const tint = variant === 'secondary' ? colors.primary : variant === 'surface' ? colors.muted : colors.white;
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled, busy: loading }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.button, variant === 'secondary' && styles.buttonSecondary, variant === 'surface' && styles.buttonSurface, (pressed || disabled) && styles.buttonPressed, disabled && variant === 'primary' && styles.buttonDisabled]}>{loading ? <ActivityIndicator color={tint} accessibilityLabel={title} /> : <View style={styles.buttonContent}>{leadingIcon ? <Ionicons name={leadingIcon} size={20} color={tint}/> : null}<Text style={[styles.buttonText, variant === 'secondary' && styles.buttonTextSecondary, variant === 'surface' && styles.buttonTextSurface]}>{title}</Text>{trailingIcon ? <Ionicons name={trailingIcon} size={20} color={tint}/> : null}</View>}</Pressable>;
}
function initials(name: string) { return name.split(/\s+/).slice(0, 2).map((part) => part[0] ?? '').join('').toUpperCase(); }

const colors = { bg: '#f9f9ff', white: '#ffffff', primaryFixed: '#dce1ff', paleHigh: '#e0e8ff', primaryContainer: '#1d4ed8', errorPale: '#ffdad6', text: '#141b2c', muted: '#434655', placeholder: '#747686', primary: '#0037b0', pale: '#e9edff', input: '#f1f3ff', border: '#c4c5d7', error: '#ba1a1a', success: '#006d40', successPale: '#98f6bb', pending: '#8f0001', pendingPale: '#ffdad5', pendingDim: '#ffb4a8', warning: '#b54708' };
const cardShadow = { shadowColor: '#141b2c', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 } as const;
const styles = StyleSheet.create({
  flowContent: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 48, maxWidth: 600, width: '100%', alignSelf: 'center', flexGrow: 1 }, backButton: { minHeight: 48, minWidth: 48, flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }, flowHeaderSpacer: { flex: 1 }, flowTitle: { color: colors.text, fontSize: 30, lineHeight: 38, fontWeight: '700', marginTop: 12, marginBottom: 24, letterSpacing: -0.5 }, flowCard: { backgroundColor: colors.white, borderRadius: 20, borderWidth: 1, borderColor: colors.border, padding: 20, marginBottom: 16, gap: 12 }, flowInput: { minHeight: 48, borderRadius: 12, paddingHorizontal: 12, backgroundColor: colors.bg, color: colors.text, fontSize: 14 }, flowAmount: { color: colors.text, fontSize: 36, lineHeight: 44, fontWeight: '700', marginTop: 6, marginBottom: 12, fontVariant: ['tabular-nums'], letterSpacing: -0.7 }, receiptHeading: { color: colors.muted, fontSize: 13, fontWeight: '700', letterSpacing: 1, marginBottom: 4 }, successIcon: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center', marginBottom: 12, borderWidth: 10, borderColor: colors.successPale }, movementStateIcon: { backgroundColor: colors.primary, borderColor: colors.pale }, successPill: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: colors.pale, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 7, marginBottom: 12 }, successDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success }, successPillText: { color: colors.muted, fontSize: 14, fontWeight: '600' }, demoCode: { color: colors.primary, fontWeight: '700', fontSize: 16, marginVertical: 8 },
  progressHeader: { marginTop: 8, marginBottom: 16 }, progressPercent: { color: colors.muted, fontSize: 10, lineHeight: 14, fontWeight: '500', letterSpacing: 0.2 }, progressTitle: { color: colors.text, fontSize: 16, lineHeight: 24, fontWeight: '600', marginTop: -6, marginBottom: 8 }, steppedContent: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 24 }, formSection: { backgroundColor: colors.white, borderRadius: 16, padding: 16, marginBottom: 12, ...cardShadow }, formFields: { gap: 16 }, cardHeaderRow: { minHeight: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }, cardLabel: { color: colors.muted, fontSize: 12, lineHeight: 16, fontWeight: '500' }, debitBadge: { overflow: 'hidden', borderRadius: 4, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: colors.pale, color: colors.muted, fontSize: 10, lineHeight: 14, fontWeight: '500' }, originIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primaryFixed, alignItems: 'center', justifyContent: 'center' }, originName: { color: colors.text, fontSize: 16, lineHeight: 24, fontWeight: '600' }, originBalance: { color: colors.muted, fontSize: 12, lineHeight: 16 }, strongText: { color: colors.text, fontWeight: '600' }, changeLink: { minHeight: 44, justifyContent: 'center' }, changeLinkText: { color: colors.primaryContainer, fontSize: 12, lineHeight: 16, fontWeight: '600' }, destinationBox: { backgroundColor: colors.bg, borderRadius: 8, padding: 8, marginBottom: 8 }, destinationName: { flexShrink: 1, color: colors.text, fontSize: 16, lineHeight: 24, fontWeight: '600' }, aliasBadgeMuted: { flexShrink: 0, maxWidth: '45%', overflow: 'hidden', borderRadius: 4, paddingHorizontal: 6, backgroundColor: colors.pale, color: colors.muted, fontSize: 10, lineHeight: 14, fontWeight: '500' }, destinationAccount: { color: colors.muted, fontSize: 12, lineHeight: 16, marginTop: 2 }, inlineNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, backgroundColor: colors.input, borderRadius: 8, padding: 8 }, inlineNoteText: { flex: 1, color: colors.muted, fontSize: 10, lineHeight: 15, letterSpacing: 0.2 }, fieldLabel: { color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '600', marginBottom: 6 }, fieldLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, fieldCounter: { color: colors.muted, fontSize: 10, lineHeight: 14, fontWeight: '500', marginBottom: 6 }, required: { color: colors.pending }, fieldHint: { color: colors.muted, fontSize: 10, lineHeight: 14, letterSpacing: 0.2, marginTop: 6, paddingHorizontal: 4 }, currencyBadge: { overflow: 'hidden', borderRadius: 4, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: colors.pale, color: colors.muted, fontSize: 14, lineHeight: 20, fontWeight: '600' }, referenceWrap: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, paddingHorizontal: 12, backgroundColor: colors.bg }, referenceInput: { flex: 1, minWidth: 0, minHeight: 48, color: colors.text, fontSize: 14, letterSpacing: 0.5, fontVariant: ['tabular-nums'] }, stickyFooter: { paddingHorizontal: 16, paddingBottom: 12, marginTop: -12, backgroundColor: colors.bg }, progressLabels: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 10 }, progressActive: { color: colors.primary, fontSize: 14, fontWeight: '700', letterSpacing: 0.5 }, progressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.pale, overflow: 'hidden' }, progressFill: { height: 6, width: '50%', backgroundColor: colors.primary, borderRadius: 3 }, progressComplete: { width: '100%' }, accountSummary: { flexDirection: 'row', alignItems: 'center', gap: 12 }, summaryCopy: { flex: 1 }, amountInputWrap: { minHeight: 64, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bg }, amountPrefix: { fontSize: 28, lineHeight: 36, color: colors.text, fontWeight: '600' }, amountInput: { flex: 1, minWidth: 0, color: colors.text, fontSize: 36, lineHeight: 44, fontWeight: '700', fontVariant: ['tabular-nums'], paddingHorizontal: 6 }, amountCurrency: { color: colors.muted, fontSize: 14, fontWeight: '600' }, fieldMeta: { color: colors.muted, fontSize: 12, textAlign: 'right', marginTop: -8, marginBottom: 12 }, amountHero: { alignItems: 'center', padding: 20, backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.border, marginBottom: 14 }, heroIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.input, marginBottom: 10 }, internalBadge: { color: colors.success, backgroundColor: colors.successPale, overflow: 'hidden', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, fontSize: 13, fontWeight: '600' }, summaryRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14 }, summaryValue: { color: colors.text, fontSize: 15, fontWeight: '600', textAlign: 'right', flexShrink: 1 }, summaryDetail: { color: colors.muted, fontSize: 12, marginTop: 3 }, flowDivider: { height: 1, backgroundColor: colors.input, marginVertical: 3 }, modifyAction: { minHeight: 48, alignItems: 'center', justifyContent: 'center' }, otpIntro: { alignItems: 'center', backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 20, marginBottom: 16 }, otpBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.input, borderRadius: 20, paddingVertical: 4, paddingHorizontal: 16, marginBottom: 16 }, otpBadgeText: { color: colors.primary, fontSize: 12, fontWeight: '600', letterSpacing: 0.5 }, otpDigits: { width: '100%', flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 24 }, otpDigit: { flex: 1, maxWidth: 48, height: 54, borderRadius: 8, backgroundColor: colors.pale, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.paleHigh }, otpDigitFilled: { borderColor: colors.paleHigh, backgroundColor: colors.paleHigh }, otpDigitText: { color: colors.primary, fontSize: 22, fontWeight: '600' }, otpInput: { width: '100%', height: 48, marginTop: -50, color: 'transparent', opacity: 0.02 }, statusIcon: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.pale, alignSelf: 'center', marginTop: 12, marginBottom: 14 }, statusIconInner: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paleHigh }, statusIconBadge: { position: 'absolute', right: -2, bottom: -2, width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white, ...cardShadow }, statusTitle: { color: colors.text, fontSize: 24, lineHeight: 32, fontWeight: '600', textAlign: 'center', letterSpacing: -0.3, marginBottom: 16, paddingHorizontal: 8 }, statusCard: { backgroundColor: colors.white, borderRadius: 16, padding: 16, marginBottom: 16, ...cardShadow }, statusDetails: { backgroundColor: colors.white, borderRadius: 16, padding: 16, gap: 12, ...cardShadow }, statusState: { overflow: 'hidden', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, backgroundColor: colors.pale, color: colors.muted, fontSize: 12, lineHeight: 16, fontWeight: '500' }, statusPill: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, alignSelf: 'center', backgroundColor: colors.pale, borderRadius: 18, paddingHorizontal: 12, paddingVertical: 7, marginBottom: 16 }, statusPillText: { color: colors.muted, fontSize: 13, fontWeight: '500' }, statusMessage: { color: colors.muted, fontSize: 16, lineHeight: 26 }, warningBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: colors.input, borderRadius: 12, padding: 14, marginTop: 8, marginBottom: 8 }, resultHero: { alignItems: 'center', gap: 14, paddingVertical: 22 }, rejectedIcon: { width: 84, height: 84, borderRadius: 42, backgroundColor: colors.pendingPale, alignItems: 'center', justifyContent: 'center' },
  reviewStep: { color: colors.primary, fontSize: 12, lineHeight: 16, fontWeight: '600' }, reviewStepLabel: { color: colors.muted, fontSize: 12, lineHeight: 16, fontWeight: '500' }, reviewHero: { alignItems: 'center', padding: 24, backgroundColor: colors.white, borderRadius: 16, marginBottom: 16, ...cardShadow }, reviewHeroLabel: { color: colors.muted, fontSize: 14, lineHeight: 20, fontWeight: '500' }, reviewAmountLine: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', marginTop: 2 }, reviewAmount: { flexShrink: 1, color: colors.text, fontSize: 36, lineHeight: 44, fontWeight: '700', letterSpacing: -0.7, fontVariant: ['tabular-nums'] }, reviewCard: { backgroundColor: colors.white, borderRadius: 16, overflow: 'hidden', marginBottom: 16, ...cardShadow }, reviewParty: { flexDirection: 'row', alignItems: 'flex-start', gap: 16, padding: 16 }, reviewPartyIcon: { width: 40, height: 40, borderRadius: 8, backgroundColor: colors.input, alignItems: 'center', justifyContent: 'center', marginTop: 2 }, reviewPartyIconDestination: { backgroundColor: colors.paleHigh }, reviewCaption: { color: colors.muted, fontSize: 12, lineHeight: 16, letterSpacing: 0.8 }, reviewPartyName: { color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '600', marginTop: 2 }, reviewDirection: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 24, paddingVertical: 4, backgroundColor: colors.input }, reviewDirectionLine: { flex: 1, height: 1, backgroundColor: colors.paleHigh }, reviewDirectionText: { color: colors.primary, fontSize: 12, lineHeight: 16, fontWeight: '600', letterSpacing: 0.8 }, reviewMeta: { backgroundColor: colors.input, padding: 16, gap: 10 }, metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, metaLabel: { color: colors.muted, fontSize: 12, lineHeight: 16 }, metaValue: { flexShrink: 1, color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '500', textAlign: 'right', fontVariant: ['tabular-nums'] }, metaStatus: { flexDirection: 'row', alignItems: 'center', gap: 6 }, metaStatusText: { color: colors.success, fontSize: 12, lineHeight: 16, fontWeight: '500' }, estimateCard: { backgroundColor: colors.white, borderRadius: 16, padding: 16, marginBottom: 24, ...cardShadow }, estimateHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }, estimateLabel: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }, estimateLabelText: { color: colors.muted, fontSize: 12, lineHeight: 16, fontWeight: '500' }, estimateValue: { flexShrink: 1, color: colors.primary, fontSize: 18, lineHeight: 24, fontWeight: '700', fontVariant: ['tabular-nums'] }, estimateMath: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, backgroundColor: colors.input, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, marginVertical: 4 }, estimateMathText: { color: colors.muted, fontSize: 12, lineHeight: 16 }, estimateMathValue: { flexShrink: 1, fontWeight: '500', textAlign: 'right', fontVariant: ['tabular-nums'] }, estimateTrack: { height: 6, borderRadius: 3, overflow: 'hidden', flexDirection: 'row', backgroundColor: colors.paleHigh, marginVertical: 8 }, estimateRemaining: { height: 6, backgroundColor: colors.primary }, estimateSpent: { flex: 1, height: 6, backgroundColor: colors.pendingDim }, estimateNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 }, estimateNoteText: { flex: 1, color: colors.muted, fontSize: 12, lineHeight: 18 },
  otpContext: { backgroundColor: colors.white, borderRadius: 16, padding: 16, marginBottom: 24, ...cardShadow }, otpContextTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, otpContextLabel: { color: colors.muted, fontSize: 12, lineHeight: 16, fontWeight: '500' }, otpContextBadge: { overflow: 'hidden', borderRadius: 4, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: colors.pale, color: colors.primary, fontSize: 12, lineHeight: 16, fontWeight: '600' }, otpContextBody: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, marginTop: 8 }, otpContextName: { color: colors.text, fontSize: 16, lineHeight: 24, fontWeight: '600' }, otpContextAmount: { alignItems: 'flex-end', maxWidth: '50%' }, otpContextValue: { color: colors.text, fontSize: 20, lineHeight: 28, fontWeight: '600', fontVariant: ['tabular-nums'] }, otpContextNote: { flexDirection: 'row', alignItems: 'center', gap: 6, borderTopWidth: 1, borderTopColor: colors.paleHigh, marginTop: 12, paddingTop: 8 }, otpCard: { alignItems: 'center', backgroundColor: colors.white, borderRadius: 16, padding: 24, marginBottom: 8, ...cardShadow }, otpBadgeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary }, otpTitle: { color: colors.text, fontSize: 20, lineHeight: 28, fontWeight: '600', textAlign: 'center', marginBottom: 6 }, otpDescription: { color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: 'center', maxWidth: 320 }, demoCodeBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.input, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, marginTop: 16 }, demoCodeLabel: { flexShrink: 1, color: colors.muted, fontSize: 12, lineHeight: 16 }, demoCodeValue: { color: colors.text, fontWeight: '700', fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }), letterSpacing: 1 }, otpDigitExpired: { opacity: 0.6, borderColor: colors.border }, otpDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.primary }, otpDash: { width: 14, height: 3, borderRadius: 2, backgroundColor: colors.border }, otpExpiredBlock: { width: '100%', marginTop: 16 }, otpExpiredBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.errorPale, backgroundColor: '#fff1ef' }, otpExpiredText: { flex: 1, color: colors.warning, fontSize: 12, lineHeight: 18, fontWeight: '500', textAlign: 'center' },
  page: { flex: 1, backgroundColor: colors.bg }, content: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 28, maxWidth: 600, width: '100%', alignSelf: 'center' },
  topbar: { minHeight: 56, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, brand: { color: colors.text, fontSize: 20, fontWeight: '700' }, eyebrow: { color: colors.muted, fontSize: 12, fontWeight: '600', letterSpacing: 1 }, avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.pale, alignItems: 'center', justifyContent: 'center' }, avatarText: { color: colors.primary, fontWeight: '700' },
  greeting: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, marginBottom: 20 }, title: { fontSize: 28, lineHeight: 36, fontWeight: '600', color: colors.text }, muted: { color: colors.muted, fontSize: 14, lineHeight: 20 }, iconButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  accountTabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 6, borderRadius: 16, backgroundColor: colors.pale, marginBottom: 16 }, tab: { minHeight: 48, minWidth: 100, flex: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 }, tabSelected: { backgroundColor: colors.white }, tabText: { color: colors.muted, fontSize: 15, fontWeight: '600' }, tabTextSelected: { color: colors.primary },
  balanceCard: { backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16, marginBottom: 16 }, accountLabel: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 14, marginBottom: 8 }, tag: { paddingHorizontal: 8, paddingVertical: 4, backgroundColor: colors.pale, borderRadius: 6, color: colors.primary, fontSize: 12, fontWeight: '600' }, balanceLine: { flexDirection: 'row', alignItems: 'baseline', marginTop: 4 }, balance: { flexShrink: 1, color: colors.text, fontSize: 36, lineHeight: 44, fontWeight: '700', letterSpacing: -0.7, fontVariant: ['tabular-nums'] }, selectedBalanceLine: { flexDirection: 'row', alignItems: 'baseline' }, selectedBalance: { flexShrink: 1, color: colors.text, fontSize: 20, lineHeight: 28, fontWeight: '600', fontVariant: ['tabular-nums'] }, balanceDivider: { height: 1, backgroundColor: colors.border, marginTop: 14 }, currency: { color: colors.muted, fontSize: 14, fontWeight: '600' },
    notice: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.input, borderRadius: 16, padding: 16, marginVertical: 8 }, sectionTitle: { color: colors.text, fontSize: 20, lineHeight: 28, fontWeight: '600' }, activityHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 24, marginBottom: 12 }, listCard: { backgroundColor: colors.white, borderRadius: 16, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border }, accountRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 }, divider: { borderTopWidth: 1, borderTopColor: colors.border }, accountIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.pale, alignItems: 'center', justifyContent: 'center' }, rowTitle: { color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '600', marginBottom: 3 }, rowBalance: { color: colors.text, fontSize: 16, lineHeight: 24, fontWeight: '600', fontVariant: ['tabular-nums'] }, loadMore: { borderTopWidth: 1, borderTopColor: colors.border, paddingBottom: 16 },
  transferEntry: { minHeight: 82, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 16, marginBottom: 16 }, destinationCard: { minHeight: 92, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16, marginBottom: 16 }, destinationIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.pale, alignItems: 'center', justifyContent: 'center' }, beneficiarySection: { marginTop: 4, marginBottom: 20 }, beneficiaryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }, searchWrap: { minHeight: 48, borderRadius: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.white, marginTop: 16, marginBottom: 16, ...cardShadow }, searchInput: { flex: 1, minWidth: 0, minHeight: 48, color: colors.text, fontSize: 14 }, emptyState: { alignItems: 'center', gap: 10, backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 24, marginVertical: 8 }, link: { color: colors.primary, fontSize: 14, fontWeight: '700' }, offlineHint: { color: colors.muted, fontSize: 13, marginTop: 8 },
  loginContent: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 20, paddingVertical: 28, width: '100%', maxWidth: 520, alignSelf: 'center' }, loginBrand: { alignItems: 'center', marginBottom: 32 }, walletMark: { width: 64, height: 64, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.pale, marginBottom: 16 }, loginTitle: { color: colors.text, fontSize: 34, lineHeight: 42, fontWeight: '700', marginTop: 18, textAlign: 'center', letterSpacing: -0.5 }, loginSubtitle: { color: colors.muted, fontSize: 16, lineHeight: 24, textAlign: 'center', marginTop: 10, maxWidth: 360 }, formCard: { backgroundColor: colors.white, borderRadius: 20, padding: 20, borderWidth: 1, borderColor: colors.border }, label: { color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '500', marginBottom: 8 }, inputWrap: { minHeight: 56, borderRadius: 14, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.input, borderWidth: 1, borderColor: colors.border }, input: { flex: 1, minWidth: 0, minHeight: 54, color: colors.text, fontSize: 16 }, button: { minHeight: 56, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 24, paddingHorizontal: 16 }, buttonPressed: { opacity: 0.86 }, buttonSecondary: { backgroundColor: colors.pale, marginTop: 12 }, buttonContent: { flexDirection: 'row', alignItems: 'center', gap: 8 }, buttonText: { color: colors.white, fontSize: 16, fontWeight: '600' }, buttonTextSecondary: { color: colors.primary }, buttonSurface: { backgroundColor: colors.white, marginTop: 12 }, buttonTextSurface: { color: colors.text, fontWeight: '500' }, buttonDisabled: { opacity: 0.5 }, errorText: { color: colors.error, fontSize: 14, lineHeight: 20, marginTop: 12 }, infoBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: colors.input, borderRadius: 16, padding: 18, marginTop: 18 }, infoText: { flex: 1, color: colors.muted, fontSize: 14, lineHeight: 21 }, bold: { fontWeight: '700', color: colors.text },
  movementAccountCard: { padding: 16, backgroundColor: colors.white, borderRadius: 16, marginTop: 8, marginBottom: 24, ...cardShadow }, movementAccountTop: { flexDirection: 'row', alignItems: 'center', gap: 12 }, bankIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.pale, alignItems: 'center', justifyContent: 'center' }, accountPicker: { flex: 1, minWidth: 0, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 4 }, movementAccountName: { flexShrink: 1, color: colors.text, fontSize: 16, lineHeight: 24, fontWeight: '600' }, movementBalance: { alignItems: 'flex-end', maxWidth: '45%' }, movementBalanceAmount: { color: colors.text, fontSize: 16, lineHeight: 24, fontWeight: '700', fontVariant: ['tabular-nums'] }, accountOptions: { marginTop: 12, gap: 6 }, accountOption: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12, paddingHorizontal: 12, backgroundColor: colors.input }, accountOptionSelected: { backgroundColor: colors.pale }, movementsTitle: { color: colors.text, fontSize: 28, lineHeight: 36, fontWeight: '600', letterSpacing: -0.3, marginBottom: 20 }, movementGroup: { marginBottom: 24 }, movementGroupHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, paddingHorizontal: 4 }, groupLabel: { color: colors.muted, fontSize: 12, lineHeight: 16, fontWeight: '600', letterSpacing: 0.8 }, groupCount: { color: colors.muted, fontSize: 12, lineHeight: 16 }, movementCard: { backgroundColor: colors.white, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 4, ...cardShadow }, movementRow: { minHeight: 80, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 }, movementIcon: { width: 48, height: 48, borderRadius: 14, backgroundColor: colors.pale, alignItems: 'center', justifyContent: 'center' }, movementCopy: { flex: 1, minWidth: 0 }, movementTitle: { color: colors.text, fontSize: 16, lineHeight: 22, fontWeight: '600' }, movementSub: { color: colors.muted, fontSize: 14, lineHeight: 20 }, movementMeta: { color: colors.muted, fontSize: 12, lineHeight: 16, marginTop: 2 }, movementAmountColumn: { alignItems: 'flex-end', maxWidth: '40%' }, movementAmount: { color: colors.text, fontSize: 16, lineHeight: 24, fontWeight: '700', fontVariant: ['tabular-nums'] }, movementsFooter: { color: colors.muted, fontSize: 12, lineHeight: 16, textAlign: 'center', marginTop: 8, marginBottom: 16 }, creditIcon: { backgroundColor: colors.successPale }, creditAmount: { color: colors.success }, bottomNavigation: { minHeight: 72, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', backgroundColor: colors.bg, borderTopWidth: 1, borderTopColor: colors.input, paddingBottom: 4 }, navigationItem: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 8 }, navigationLabel: { color: colors.muted, fontSize: 13, fontWeight: '500' }, navigationLabelActive: { color: colors.primary, fontWeight: '700' },
  pickerContent: { flexGrow: 1, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 24, maxWidth: 600, width: '100%', alignSelf: 'center' }, pickerTitle: { color: colors.text, fontSize: 20, lineHeight: 28, fontWeight: '600', letterSpacing: -0.1 }, pickerDescription: { color: colors.muted, fontSize: 12, lineHeight: 16, marginTop: 4 }, filterRow: { flexDirection: 'row', gap: 8, marginBottom: 12 }, filterChip: { height: 28, borderRadius: 14, paddingHorizontal: 12, justifyContent: 'center', backgroundColor: colors.primary }, filterChipText: { color: colors.white, fontSize: 12, lineHeight: 16, fontWeight: '500' }, pickerMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }, captionLabel: { color: colors.placeholder, fontSize: 10, lineHeight: 14, fontWeight: '500', letterSpacing: 1 }, captionMeta: { color: colors.placeholder, fontSize: 10, lineHeight: 14, fontWeight: '500' }, beneficiaryCard: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, backgroundColor: colors.white, borderRadius: 12, marginBottom: 8, ...cardShadow }, beneficiaryCardPressed: { backgroundColor: colors.input }, beneficiaryAvatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paleHigh }, beneficiaryInitials: { color: colors.primary, fontSize: 16, lineHeight: 24, fontWeight: '600' }, beneficiaryNameLine: { flexDirection: 'row', alignItems: 'center', gap: 6 }, beneficiaryName: { flexShrink: 1, color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '500' }, aliasBadge: { flexShrink: 0, maxWidth: '45%', overflow: 'hidden', borderRadius: 4, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: colors.pale, color: colors.primary, fontSize: 10, lineHeight: 14, fontWeight: '500', letterSpacing: 0.2 }, beneficiaryAccount: { color: colors.muted, fontSize: 12, lineHeight: 16, marginTop: 2 }, pickerEmpty: { alignItems: 'center', padding: 16, borderRadius: 12, backgroundColor: colors.input, marginTop: 8, ...cardShadow }, pickerEmptyIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.pale, marginBottom: 12 }, pickerEmptyTitle: { color: colors.text, fontSize: 16, lineHeight: 24, fontWeight: '600', textAlign: 'center', marginBottom: 4 }, pickerEmptyText: { color: colors.muted, fontSize: 12, lineHeight: 16, textAlign: 'center', maxWidth: 280 }, pickerFooter: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.input, borderRadius: 8, padding: 12, marginTop: 'auto' }, pickerFooterText: { flex: 1, color: colors.muted, fontSize: 10, lineHeight: 14, letterSpacing: 0.2, textAlign: 'center' },
  screenHeader: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, backgroundColor: colors.bg, ...cardShadow, shadowOpacity: 0.03 }, headerBack: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, headerTitle: { color: colors.text, fontSize: 18, lineHeight: 26, fontWeight: '600', flexShrink: 1 }, headerAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.pale, alignItems: 'center', justifyContent: 'center' }, headerAvatarSolid: { backgroundColor: colors.primaryContainer }, headerAvatarSolidText: { color: colors.white, fontSize: 12 },
  detailContent: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32, maxWidth: 600, width: '100%', alignSelf: 'center' }, detailHero: { alignItems: 'center', paddingVertical: 12 }, detailStatusIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.successPale, alignItems: 'center', justifyContent: 'center', marginBottom: 12 }, detailStatusIconPending: { backgroundColor: colors.pale }, detailStatusIconRejected: { backgroundColor: colors.errorPale }, detailPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.pale, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 4, marginBottom: 10 }, detailTitle: { color: colors.text, fontSize: 20, lineHeight: 28, fontWeight: '600', textAlign: 'center' }, detailAmount: { color: colors.text, fontSize: 36, lineHeight: 44, fontWeight: '700', letterSpacing: -0.7, fontVariant: ['tabular-nums'], marginTop: 6 }, detailCurrency: { color: colors.muted, fontSize: 16, fontWeight: '600' }, detailDate: { color: colors.muted, fontSize: 12, lineHeight: 16, marginTop: 4, textAlign: 'center' }, detailZone: { color: colors.placeholder, fontSize: 10, lineHeight: 14, letterSpacing: 0.2, textAlign: 'center' }, detailCard: { backgroundColor: colors.white, borderRadius: 16, padding: 16, marginTop: 12, gap: 14, ...cardShadow }, detailStacked: { gap: 4 }, detailStackedValue: { color: colors.text, fontSize: 16, lineHeight: 24, fontWeight: '500', flexShrink: 1 }, detailDestination: { flexDirection: 'row', alignItems: 'center', gap: 6 }, detailRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 28 }, detailRowValue: { color: colors.text, fontSize: 14, lineHeight: 20, textAlign: 'right', flexShrink: 1 }, detailRowEmphasis: { fontSize: 16, lineHeight: 24, fontWeight: '600', fontVariant: ['tabular-nums'] }, detailRowAccent: { color: colors.primary, fontWeight: '600' }, detailFootnote: { color: colors.muted, fontSize: 10, lineHeight: 14, letterSpacing: 0.2, textAlign: 'center', marginTop: 16, marginBottom: 4 },
  centered: { flex: 1, minHeight: 180, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, backgroundColor: colors.bg }, privacy: { flex: 1, justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 24, backgroundColor: colors.bg }, privacyCard: { flex: 1, maxHeight: 560, minHeight: 340, alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: colors.white, borderRadius: 24, borderWidth: 1, borderColor: colors.border }, privacyIcon: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.pale, marginBottom: 24 }, privacyPill: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.pale, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, marginTop: 16 }, privacyPillText: { color: colors.primary, fontSize: 13, fontWeight: '600' }, privacyNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 16, marginTop: 20, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, borderRadius: 18 }, center: { textAlign: 'center', maxWidth: 320, marginTop: 16 }, privacyFooter: { position: 'absolute', bottom: 36, color: colors.muted, fontSize: 14, fontWeight: '600' },
});

export default function App() { return <SafeAreaProvider><SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>{__DEV__ && <View style={{ backgroundColor: '#ff005c', paddingVertical: 5 }}><Text style={{ color: '#fff', fontSize: 11, fontWeight: '700', textAlign: 'center', letterSpacing: 0.5 }}>DIAG-MOBILE-32693d3-A</Text></View>}<QueryClientProvider client={queryClient}><Wallet /></QueryClientProvider></SafeAreaView></SafeAreaProvider>; }
