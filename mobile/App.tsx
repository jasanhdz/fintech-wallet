import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import type { ProductComponents } from '@fintech-wallet/shared';
import { amountToMinor, formatMoney } from './src/money';
import { useInterTypeface, withInter, type Typeface } from './src/typography';
import { receiptFromTransfer } from './src/receipt';
import { RECEIPT_ACTION_LABELS, RECEIPT_BUSY_LABELS, useReceiptShare } from './src/receiptShare';
import { parseTimestamp, BUSINESS_ZONE_LABEL, DATE_UNAVAILABLE, businessDayKey, businessDayLabel, formatBusinessDateTime, formatBusinessShort, formatBusinessTime, formatUpdatedAt } from './src/dates';

type User = ProductComponents['schemas']['User'];
type Account = ProductComponents['schemas']['Account'];
type AuthResponse = ProductComponents['schemas']['AuthResponse'];
type Beneficiary = ProductComponents['schemas']['Beneficiary'];
type Transfer = ProductComponents['schemas']['Transfer'];
type TransferRequest = ProductComponents['schemas']['TransferCreateRequest'];
type Movement = ProductComponents['schemas']['Movement'];
type TransferPolicy = ProductComponents['schemas']['TransferPolicy'];
type FlowScreen = 'details' | 'review' | 'sending' | 'otp' | 'status' | 'receipt' | 'rejected' | 'closed';

// One mapping from the API transfer status to the screen that may show it. Only "completed" reaches the receipt;
// "expired"/"cancelled" are terminal attempts without postings; an unknown or "processing" state is still being
// verified for the same attempt.
function screenForStatus(status: Transfer['status']): FlowScreen {
  if (status === 'awaiting_confirmation') return 'otp';
  if (status === 'completed') return 'receipt';
  if (status === 'rejected') return 'rejected';
  if (status === 'expired' || status === 'cancelled') return 'closed';
  return 'status';
}
const INCOMPATIBLE_DESTINATION_TEXT = 'Es tu cuenta de origen: elige otra cuenta de origen para enviarle.';
const SAME_ACCOUNT_MESSAGE = 'La cuenta de origen y el destino son la misma cuenta. Elige otra cuenta de origen o cambia el beneficiario.';
// B: identity check only (Beneficiary.ownAccountId is present only when the destination is one of the user's own
// accounts); names, aliases or last digits are never compared. The API stays authoritative (422).
function sameAccountDestination(beneficiary: Beneficiary | null | undefined, sourceAccountId: string | undefined): boolean {
  return Boolean(beneficiary?.ownAccountId && sourceAccountId && beneficiary.ownAccountId === sourceAccountId);
}
type RejectedCombo = { sourceAccountId: string; beneficiaryId: string | undefined; amountMinor: string; reason: string };

function isBusinessRejection(error: ApiError): boolean {
  return error.status === 422 || (error.status === 429 && DAILY_LIMIT_PATTERN.test(error.message));
}
const DAILY_LIMIT_PATTERN = /límite diario/i;
function isTerminalStatus(status: Transfer['status']): boolean {
  return status === 'completed' || status === 'rejected' || status === 'expired' || status === 'cancelled';
}
const REFRESH_KEY = 'wallet.refresh-token';
// F-21/F-22: the record of an attempt whose outcome is not known yet (or that still waits for its code). One record per
// user (SecureStore keys allow [A-Za-z0-9._-]); a record is read, replaced and deleted only in its owner's session and
// only removed when the API reports the attempt resolved. Signing out (explicitly or by expiry) never deletes it. The
// single pre-round-8 slot is migrated to its owner's key the first time that owner signs in again.
const LEGACY_RECOVERY_KEY = 'wallet.transfer-recovery';
function recoveryKeyFor(userId: string): string { return `${LEGACY_RECOVERY_KEY}.${userId.replace(/[^A-Za-z0-9._-]/g, '_')}`; }
type RecoveryRecord = { key: string; payload: TransferRequest; transferId?: string; userId?: string; status?: Transfer['status'] };
async function readOwnRecovery(userId: string): Promise<RecoveryRecord | null> {
  const own = await SecureStore.getItemAsync(recoveryKeyFor(userId));
  if (own) return JSON.parse(own) as RecoveryRecord;
  const legacy = await SecureStore.getItemAsync(LEGACY_RECOVERY_KEY);
  if (!legacy) return null;
  const record = JSON.parse(legacy) as RecoveryRecord;
  // Another user's record is never shown, consumed, replaced nor deleted from this session.
  if (record.userId && record.userId !== userId) return null;
  const migrated = { ...record, userId };
  await SecureStore.setItemAsync(recoveryKeyFor(userId), JSON.stringify(migrated));
  await SecureStore.deleteItemAsync(LEGACY_RECOVERY_KEY);
  return migrated;
}
const PENDING_UNVERIFIABLE_MESSAGE = 'No pudimos comprobar si tienes una transferencia en verificación. Para evitar un cargo doble no enviamos nada; inténtalo de nuevo en un momento.';
// Round 7 · 5: a new code needs the previous attempt to be closed first; when its state cannot be read nothing is created.
const NEW_CODE_UNCERTAIN_MESSAGE = 'No pudimos confirmar que el intento anterior quedó cancelado. Para evitar dos intentos abiertos no creamos uno nuevo; inténtalo de nuevo en un momento.';
const UNCERTAIN_CONFIRM_MESSAGE = 'No pudimos verificar si tu autorización anterior se aplicó. Para evitar un cargo doble, reintenta con el mismo código o vuelve a intentarlo cuando tengas conexión.';
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

function Wallet() {
  const [session, setSession] = useState<{ accessToken: string; user: User } | null>(null);
  const [ready, setReady] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [formError, setFormError] = useState('');
  // M01 error variants (credentials, temporary lock, no connection) and the M12 "sesión vencida" notice.
  const [formErrorKind, setFormErrorKind] = useState<'validation' | 'credentials' | 'locked' | 'network' | 'other'>('validation');
  const [sessionExpired, setSessionExpired] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [choosingBeneficiary, setChoosingBeneficiary] = useState(false);
  const [beneficiarySearch, setBeneficiarySearch] = useState('');
  const [destination, setDestination] = useState<Beneficiary | null>(null);
  const [transferScreen, setTransferScreen] = useState<FlowScreen | null>(null);
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
  // F-21: mirror of this user's stored recovery record. While it exists Home offers only resuming/verifying that attempt
  // (no new transfer can be started) and re-checks it, with the same key, whenever Home is shown or the app returns.
  const [pendingRecord, setPendingRecord] = useState<RecoveryRecord | null>(null);
  const [pendingCheck, setPendingCheck] = useState<'idle' | 'checking' | 'failed'>('idle');
  const [homeCheckTick, setHomeCheckTick] = useState(0);
  const pendingCheckInFlight = useRef(false);
  const sessionUserRef = useRef<string | null>(null);
  const [otp, setOtp] = useState('');
  // Set only when the API answers a confirm with "code expired"; the challenge can then never be confirmed.
  const [otpExpired, setOtpExpired] = useState(false);
  // Round 7 · 4: server answers to a confirm that need their own M08 state. "wrong" = 422 "Código incorrecto" (the same
  // attempt can be retried with another code); "locked" = 429 "Se agotaron los intentos" (OTP_MAX_ATTEMPTS reached: the
  // attempt can no longer be authorized and only a new code or leaving helps). Neither ever moved money.
  const [otpWrong, setOtpWrong] = useState(false);
  const [otpLocked, setOtpLocked] = useState(false);
  const [confirmAttempt, setConfirmAttempt] = useState<{ key: string; payload: { code: string } } | null>(null);
  // True while a confirm may have been applied server-side but neither its response nor a status read arrived.
  // Until the original transfer is read back, the flow must not leave the OTP step or create a new attempt.
  const [confirmUncertain, setConfirmUncertain] = useState(false);
  // F-09: only a 422 business rejection (or an API transfer status of "rejected") proves no money moved. Other 4xx
  // answers to POST /transfers (401, 409, 429, …) lead to the rejected screen without claiming the balance is intact.
  const [rejectionUnverified, setRejectionUnverified] = useState(false);
  // Balance of the source account re-read from the API after a completed transfer; null until that read succeeds.
  const [postBalance, setPostBalance] = useState<{ accountName: string; minor: string } | null>(null);
  const [movementDetail, setMovementDetail] = useState<{ movement: Movement; transfer: Transfer | null } | null>(null);
  const [movementDetailId, setMovementDetailId] = useState('');
  const [movementDetailError, setMovementDetailError] = useState('');
  const [movementDetailBusy, setMovementDetailBusy] = useState(false);
  const [activeTab, setActiveTab] = useState<'home' | 'movements'>('home');
  // C: the origin selector on the details step is opened automatically when a rejection was caused by the account.
  const [originOpen, setOriginOpen] = useState(false);
  const [rejectedCombo, setRejectedCombo] = useState<RejectedCombo | null>(null);
  const client = useQueryClient();

  const refreshSession = useCallback(async (refreshToken: string) => {
    const result = await request<AuthResponse>('/auth/refresh', undefined, {
      method: 'POST', body: JSON.stringify({ client: 'mobile', refreshToken }),
    });
    if (!result.refreshToken) throw new Error('La API no devolvió la sesión móvil renovada.');
    await SecureStore.setItemAsync(REFRESH_KEY, result.refreshToken);
    setSession({ accessToken: result.accessToken, user: result.user });
  }, []);

  const expireSession = useCallback(async () => { setSessionExpired(true); }, []);
  // Round 8 (F-21/F-22): neither an expired session nor an explicit logout deletes a pending-transfer record. It stays
  // bound to its user, is shown only to that user and is resumed (same key) when that user signs in again.
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
      sessionUserRef.current = null;
      try { await SecureStore.deleteItemAsync(REFRESH_KEY); } catch { /* clear in-memory state regardless */ }
      setRecoveryReady(false); setPendingRecord(null); setPendingCheck('idle');
      setSession(null);
      setDestination(null);
      setTransfer(null);
      setCreateAttempt(null);
      setConfirmAttempt(null);
      setConfirmUncertain(false);
      setOtp('');
      setOtpExpired(false); setOtpWrong(false); setOtpLocked(false);
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

  useEffect(() => { sessionUserRef.current = session?.user.id ?? null; }, [session]);

  useEffect(() => {
    if (!session || !ready || recoveryReady) return;
    let active = true;
    void (async () => {
      try {
        // Round 7 · 8 / F-22: only this user's record is read (a record of another user is never shown nor consumed).
        // Records written before round 7 carry no userId; they come from the session restored with the same token.
        const attempt = await readOwnRecovery(session.user.id);
        if (!attempt || !active) return;
        setPendingRecord(attempt);
        setCreateAttempt({ key: attempt.key, payload: attempt.payload });
        setTransferScreen('status');
        if (attempt.transferId) {
          const result = await request<Transfer>(`/transfers/${encodeURIComponent(attempt.transferId)}`, session.accessToken);
          if (!active) return;
          setTransfer(result);
          if (result.status !== 'awaiting_confirmation') {
            setTransferScreen(screenForStatus(result.status));
            if (isTerminalStatus(result.status)) await clearRecovery(session.user.id);
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
          await submitRecoveredCreate(attempt, session.accessToken, session.user.id);
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
        // F-21: once the session is confirmed valid again, Home re-checks a pending attempt (same key) on its own.
        if (token) void request<User>('/auth/me', token).then(() => setHomeCheckTick((tick) => tick + 1)).catch(async (error: unknown) => {
          try {
            if (error instanceof ApiError && error.status === 401) {
              const refresh = await SecureStore.getItemAsync(REFRESH_KEY);
              if (refresh) await refreshSession(refresh).then(() => setHomeCheckTick((tick) => tick + 1)).catch(async () => { await expireSession(); await endSession(); });
              else { await expireSession(); await endSession(); }
            }
          } catch { /* Best-effort background session recheck on foreground; never let it crash the app. */ }
        });
        setHidden(false);
      }
      previous = next;
    });
    return () => subscription.remove();
  }, [endSession, expireSession, refreshSession, session?.accessToken]);

  const accountsQuery = useQuery({
    queryKey: ['accounts', session?.user.id],
    queryFn: async () => {
      try { return (await request<{ items: Account[] }>('/accounts', session?.accessToken)).items; }
      catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) throw error;
        const refreshToken = await SecureStore.getItemAsync(REFRESH_KEY);
        if (!refreshToken) { await expireSession(); await endSession(); throw error; }
        try {
          const refreshed = await request<AuthResponse>('/auth/refresh', undefined, { method: 'POST', body: JSON.stringify({ client: 'mobile', refreshToken }) });
          if (!refreshed.refreshToken) throw new Error('La API no devolvió la sesión móvil renovada.');
          await SecureStore.setItemAsync(REFRESH_KEY, refreshed.refreshToken);
          setSession({ accessToken: refreshed.accessToken, user: refreshed.user });
          return (await request<{ items: Account[] }>('/accounts', refreshed.accessToken)).items;
        } catch (refreshError) {
          await expireSession(); await endSession();
          throw refreshError;
        }
      }
    },
    enabled: Boolean(session && !hidden),
  });
  // F-08: the checking (principal) account is listed and selected first, as in the approved M02 reference; the API
  // order and data are left untouched.
  const accounts = useMemo(() => {
    const items = accountsQuery.data ?? [];
    return [...items.filter((account) => account.kind === 'checking'), ...items.filter((account) => account.kind !== 'checking')];
  }, [accountsQuery.data]);
  const refetchAccounts = accountsQuery.refetch;
  const completedTransfer = transferScreen === 'receipt' && transfer?.status === 'completed' ? transfer : null;
  useEffect(() => {
    setPostBalance(null);
    if (!completedTransfer) return;
    let active = true;
    // Only a fresh read made after the API reported the transfer completed is shown; a cached list may predate the debit.
    void refetchAccounts().then((result) => {
      if (!active || result.isError) return;
      const source = result.data?.find((account) => account.id === completedTransfer.sourceAccountId);
      if (source) setPostBalance({ accountName: source.name, minor: source.availableBalanceMinor });
    }).catch(() => { /* keep the balance hidden when it cannot be confirmed */ });
    return () => { active = false; };
  }, [completedTransfer, refetchAccounts]);
  const selected = accounts.find((account) => account.id === selectedId) ?? accounts[0];
  const updatedLabel = accountsQuery.dataUpdatedAt ? formatUpdatedAt(accountsQuery.dataUpdatedAt) : null;
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
    if (!session) return;
    // A received transfer from another user is not readable by its receiver (GET /transfers/{id} is sender-only), so
    // credits are shown from the movement and its counterparty; sent movements also read the transfer for its folio.
    if (movement.type === 'credit' || !movement.transferId) { setMovementDetail({ movement, transfer: null }); return; }
    setMovementDetailId(movement.transferId);
    setMovementDetailBusy(true); setMovementDetailError('');
    try { setMovementDetail({ movement, transfer: await request<Transfer>(`/transfers/${encodeURIComponent(movement.transferId)}`, session.accessToken) }); }
    catch (error) { setMovementDetailError(error instanceof Error ? error.message : 'No se pudo cargar el comprobante.'); }
    finally { setMovementDetailBusy(false); }
  }
  const amountMinor = amountToMinor(amount);
  const destinationIsSource = sameAccountDestination(destination, selected?.id);
  const transferPayload: TransferRequest | null = destination && selected && !destinationIsSource && amountMinor && concept.trim() && reference
    ? { sourceAccountId: selected.id, destinationType: 'beneficiary', beneficiaryId: destination.id, amountMinor, concept: concept.trim(), reference }
    : null;
  const repeatsRejected = Boolean(rejectedCombo && transferPayload && rejectedCombo.sourceAccountId === transferPayload.sourceAccountId && rejectedCombo.beneficiaryId === ('beneficiaryId' in transferPayload ? transferPayload.beneficiaryId : undefined) && rejectedCombo.amountMinor === transferPayload.amountMinor);

  // F-21: the stored record and its in-memory mirror always change together (only this user's key).
  async function saveRecovery(record: RecoveryRecord, userId: string) {
    const stored: RecoveryRecord = { ...record, userId };
    await SecureStore.setItemAsync(recoveryKeyFor(userId), JSON.stringify(stored));
    if (sessionUserRef.current === userId) setPendingRecord(stored);
  }
  async function clearRecovery(userId: string | undefined) {
    if (!userId) return;
    if (sessionUserRef.current === userId) { setPendingRecord(null); setPendingCheck('idle'); }
    await SecureStore.deleteItemAsync(recoveryKeyFor(userId));
  }

  // F-21: the attempt being prepared is dropped before anything is sent; Home shows the unresolved one and its own action.
  function holdForPendingAttempt(record: RecoveryRecord) {
    setPendingRecord(record);
    setTransferScreen(null); setTransfer(null); setCreateAttempt(null); setConfirmAttempt(null); setConfirmUncertain(false); setRejectionUnverified(false); setOtp(''); setOtpExpired(false); setOtpWrong(false); setOtpLocked(false); setTransferError(''); setDemoOnlyCode('');
    setChoosingBeneficiary(false); setActiveTab('home');
  }

  async function submitCreate(retry = false, payloadOverride?: TransferRequest, replacesClosedAttempt = false) {
    if (!session || transferBusy || transferInFlight.current) return;
    if (confirmUncertain) {
      setTransferError(UNCERTAIN_CONFIRM_MESSAGE);
      return;
    }
    transferInFlight.current = true;
    const userId = session.user.id;
    // F-21: a NEW attempt (new Idempotency-Key) is never created while this user still has an unresolved or pending one;
    // only "Solicitar un código nuevo", after the API confirmed the previous attempt closed, may replace it. When the
    // store cannot be read nothing is sent (fail closed).
    if (!retry && !replacesClosedAttempt) {
      let existing: RecoveryRecord | null;
      try { existing = await readOwnRecovery(userId); }
      catch { transferInFlight.current = false; setTransferError(PENDING_UNVERIFIABLE_MESSAGE); return; }
      if (existing) { transferInFlight.current = false; holdForPendingAttempt(existing); return; }
    }
    let attempt: { key: string; payload: TransferRequest; transferId?: string } | null;
    const payload = payloadOverride ?? transferPayload;
    try {
      attempt = retry && createAttempt ? createAttempt : payload ? { key: newIdempotencyKey(), payload } : null;
    } catch (error) {
      transferInFlight.current = false;
      setTransferError(error instanceof Error ? error.message : 'No se pudo preparar el intento de transferencia.');
      return;
    }
    if (!attempt) {
      transferInFlight.current = false;
      if (destinationIsSource) setTransferError(SAME_ACCOUNT_MESSAGE);
      return;
    }
    if (!retry) {
      setCreateAttempt(attempt);
      try { await saveRecovery(attempt, userId); }
      catch {
        // Without a stored record a lost response could not be resumed with this key: send nothing.
        transferInFlight.current = false;
        setTransferError('No se pudo preparar el intento de transferencia.');
        return;
      }
    }
    // E: a normal first request is "Enviando" (neutral copy); only a retry of the same attempt, after its outcome
    // became unknown, is shown as "Verificando resultado".
    setTransferBusy(true); setTransferError(''); setOtpExpired(false); setOtpWrong(false); setOtpLocked(false); setRejectionUnverified(false); setTransferScreen(retry ? 'status' : 'sending');
    try {
      const result = await request<Transfer>('/transfers', session.accessToken, { method: 'POST', headers: { 'Idempotency-Key': attempt.key }, body: JSON.stringify(attempt.payload) });
      setDemoOnlyCode((result as Transfer & { demoOnlyCode?: string }).demoOnlyCode ?? '');
      const finalResult = result.status === 'completed' ? await request<Transfer>(`/transfers/${result.id}`, session.accessToken) : result;
      setTransfer(finalResult);
      if (isTerminalStatus(finalResult.status)) await clearRecovery(userId);
      else if (finalResult.id) await saveRecovery({ ...attempt, transferId: finalResult.id, status: finalResult.status }, userId);
      setTransferScreen(screenForStatus(finalResult.status));
    } catch (error) {
      setTransferError(error instanceof Error ? error.message : 'No se pudo confirmar el resultado.');
      // Round 7 · 7: only a business rejection proves nothing was posted: 422 (e.g. "Saldo insuficiente") or the 429
      // "Se excedió el límite diario" of the transfer rules. Any other 4xx (401, 409, a rate limit…) stays unverified.
      setRejectionUnverified(error instanceof ApiError && !isBusinessRejection(error));
      // M11 shows the source balance and today's remaining limit: re-read them instead of presenting cached values.
      if (error instanceof ApiError) { void client.invalidateQueries({ queryKey: ['accounts'] }); void client.invalidateQueries({ queryKey: ['transfer-policy'] }); }
      setTransferScreen(error instanceof ApiError && error.status >= 400 && error.status < 500 ? 'rejected' : 'status');
    } finally { setTransferBusy(false); transferInFlight.current = false; }
  }

  async function submitRecoveredCreate(attempt: { key: string; payload: TransferRequest }, accessToken: string, userId: string) {
    setTransferScreen('status');
    setTransferBusy(true);
    try {
      const result = await request<Transfer>('/transfers', accessToken, { method: 'POST', headers: { 'Idempotency-Key': attempt.key }, body: JSON.stringify(attempt.payload) });
      if (!result.id) return;
      setDemoOnlyCode((result as Transfer & { demoOnlyCode?: string }).demoOnlyCode ?? '');
      await saveRecovery({ ...attempt, transferId: result.id, status: result.status }, userId);
      const finalResult = result.status === 'completed' ? await request<Transfer>(`/transfers/${result.id}`, accessToken) : result;
      setTransfer(finalResult);
      if (isTerminalStatus(finalResult.status)) await clearRecovery(userId);
      setTransferScreen(screenForStatus(finalResult.status));
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
    setTransferBusy(true); setTransferError(''); setOtpWrong(false);
    try {
      const result = await request<Transfer>(`/transfers/${transfer.id}/confirm`, session.accessToken, { method: 'POST', headers: { 'Idempotency-Key': attempt.key }, body: JSON.stringify(attempt.payload) });
      const finalResult = result.status === 'completed' ? await request<Transfer>(`/transfers/${result.id}`, session.accessToken) : result;
      setTransfer(finalResult); setConfirmAttempt(null); setConfirmUncertain(false); setOtp('');
      if (isTerminalStatus(finalResult.status)) await clearRecovery(session.user.id);
      setTransferScreen(screenForStatus(finalResult.status));
    } catch (error) {
      if (!(error instanceof ApiError) || error.status >= 500) {
        // Result is uncertain: the confirmation may have been processed even though we lost the response.
        // The OTP challenge is single-consumption server-side (confirmTransfer rejects a second confirm once
        // consumed_at is set), so re-querying by transfer id is always safe and never duplicates a charge.
        try {
          const recovered = await request<Transfer>(`/transfers/${transfer.id}`, session.accessToken);
          setTransfer(recovered); setConfirmAttempt(null); setConfirmUncertain(false); setOtp('');
          if (isTerminalStatus(recovered.status)) await clearRecovery(session.user.id);
          setTransferScreen(screenForStatus(recovered.status));
          return;
        } catch { /* Recovery query failed too; fall through and show the error with the attempt preserved for retry. */ }
        setConfirmUncertain(true);
      }
      if (error instanceof ApiError && error.status < 500) {
        // A definitive 4xx answer: the same confirm must not be replayed, and nothing was posted.
        setConfirmAttempt(null);
        if (error.status === 422 && /expir/i.test(error.message)) {
          // The API closed the attempt as "expired" before answering: it is terminal, no cancel is needed later.
          setOtpExpired(true); setOtp(''); setTransfer((current) => (current ? { ...current, status: 'expired' } : current));
        } else if (error.status === 429 && /intentos/i.test(error.message)) {
          setOtpLocked(true); setOtp('');
        } else if (error.status === 422 && /incorrect/i.test(error.message)) {
          setOtpWrong(true); setOtp('');
        } else if ((error.status === 422 && /saldo insuficiente/i.test(error.message)) || (error.status === 429 && /límite diario/i.test(error.message))) {
          // Confirmed business rejection at confirm time (M11): no posting happened. The still-pending attempt is closed.
          void cancelPendingAttempt(transfer);
          await clearRecovery(session.user.id);
          setRejectionUnverified(false); setOtp('');
          setTransferError(error.message);
          void client.invalidateQueries({ queryKey: ['accounts'] });
          void client.invalidateQueries({ queryKey: ['transfer-policy'] });
          setTransferScreen('rejected');
          return;
        }
      }
      setTransferError(error instanceof Error ? error.message : 'No se pudo confirmar el resultado.');
    } finally { setTransferBusy(false); transferInFlight.current = false; }
  }

  async function checkTransferStatus() {
    if (!session || !transfer) return;
    setTransferBusy(true); setTransferError('');
    try {
      const result = await request<Transfer>(`/transfers/${transfer.id}`, session.accessToken);
      setTransfer(result);
      if (isTerminalStatus(result.status)) await clearRecovery(session.user.id);
      setTransferScreen(screenForStatus(result.status));
    } catch (error) { setTransferError(error instanceof Error ? error.message : 'No se pudo consultar el estado.'); }
    finally { setTransferBusy(false); }
  }

  function resetTransfer() {
    // Reached only once the attempt is resolved (receipt, rejected, closed) or before any attempt exists (details).
    void clearRecovery(session?.user.id).catch(() => undefined);
    setTransferScreen(null); setAmount(''); setConcept(''); setReference(''); setTransfer(null); setCreateAttempt(null); setConfirmAttempt(null); setConfirmUncertain(false); setRejectionUnverified(false); setOtp(''); setOtpExpired(false); setOtpWrong(false); setOtpLocked(false); setTransferError(''); setDemoOnlyCode('');
    setRejectedCombo(null); setOriginOpen(false);
    void client.invalidateQueries({ queryKey: ['movements'] });
  }

  // G (F-10): best-effort POST /transfers/{id}/cancel of a pending attempt the user abandons. Failure is harmless: the
  // attempt never has postings and the API expires it at expiresAt.
  async function cancelPendingAttempt(pending: Transfer | null) {
    if (!session || !pending || pending.status !== 'awaiting_confirmation') return;
    try { await request<Transfer>(`/transfers/${encodeURIComponent(pending.id)}/cancel`, session.accessToken, { method: 'POST' }); }
    catch { /* expires on its own */ }
  }

  // Round 7 · 5: reads the previous attempt into a known state before a new one may exist. Returns null when neither
  // the cancel nor a status read answered (uncertain: the caller must not create anything).
  async function closePreviousAttempt(previous: Transfer, accessToken: string): Promise<Transfer | null> {
    // Already closed by an explicit API answer (e.g. the confirm that replied 422 "El código expiró" closes it as expired).
    if (previous.status === 'cancelled' || previous.status === 'expired') return previous;
    if (previous.status === 'awaiting_confirmation') {
      try { return await request<Transfer>(`/transfers/${encodeURIComponent(previous.id)}/cancel`, accessToken, { method: 'POST' }); }
      catch { /* 409 (already completed), network or 5xx: read the attempt instead of assuming */ }
    }
    try { return await request<Transfer>(`/transfers/${encodeURIComponent(previous.id)}`, accessToken); }
    catch { return null; }
  }

  async function requestNewCode() {
    // H: there is no resend endpoint (decision in docs/round6-contract-notes.md). "Solicitar un código nuevo" is an
    // explicit user action that closes the pending attempt and creates a new attempt with a NEW Idempotency-Key; only
    // a confirmed attempt can ever move money. Never while a confirm outcome is uncertain (F-06).
    // Round 7 · 5: the previous attempt must be confirmed cancelled/expired by the API BEFORE the new one is created; if
    // it completed meanwhile, its receipt is shown instead; if its state is unknown, nothing is created.
    const payload = createAttempt?.payload ?? transferPayload;
    if (!session || !payload || transferBusy || transferInFlight.current) return;
    if (confirmUncertain) { setTransferError(UNCERTAIN_CONFIRM_MESSAGE); return; }
    const previous = transfer;
    if (previous) {
      transferInFlight.current = true;
      setTransferBusy(true); setTransferError('');
      let closed: Transfer | null;
      try { closed = await closePreviousAttempt(previous, session.accessToken); }
      finally { setTransferBusy(false); transferInFlight.current = false; }
      if (!closed) { setTransferError(NEW_CODE_UNCERTAIN_MESSAGE); return; }
      if (closed.status !== 'cancelled' && closed.status !== 'expired') {
        setTransfer(closed);
        if (isTerminalStatus(closed.status)) await clearRecovery(session.user.id);
        if (closed.status !== 'awaiting_confirmation') setTransferScreen(screenForStatus(closed.status));
        else setTransferError(NEW_CODE_UNCERTAIN_MESSAGE);
        return;
      }
    }
    setOtp(''); setConfirmAttempt(null); setTransfer(null); setDemoOnlyCode(''); setOtpWrong(false); setOtpLocked(false);
    // F-21: only an attempt the API confirmed cancelled/expired may be replaced by a new one.
    await submitCreate(false, payload, Boolean(previous));
  }

  function otpTimedOut() {
    // The countdown reached Transfer.expiresAt. With an uncertain confirm the outcome must be resolved first (F-06).
    if (confirmUncertain) return;
    setOtpExpired(true); setOtp('');
  }

  function leaveUncertainTransfer() {
    // Deliberately keeps the persisted recovery record (unlike resetTransfer): Home shows it as the only transfer action
    // (F-21) and every check or resume replays this exact attempt with its original Idempotency-Key.
    setTransferScreen(null); setAmount(''); setConcept(''); setReference(''); setTransfer(null); setCreateAttempt(null); setConfirmAttempt(null); setConfirmUncertain(false); setRejectionUnverified(false); setOtp(''); setOtpExpired(false); setOtpWrong(false); setOtpLocked(false); setTransferError(''); setDemoOnlyCode('');
    void client.invalidateQueries({ queryKey: ['accounts'] });
    void client.invalidateQueries({ queryKey: ['movements'] });
  }

  function showMovementsAfterTransfer() {
    resetTransfer();
    void client.invalidateQueries({ queryKey: ['movements'] });
    setActiveTab('movements');
  }

  function editRejectedTransfer() {
    // A rejected attempt never moved money; keep the typed data so the user can adjust amount or account. C: remember
    // the rejected combination (to warn before resending it unchanged) and, when the account caused the rejection,
    // open the origin selector so the user can actually fix it instead of looping back to the same review.
    const payload = createAttempt?.payload ?? transferPayload;
    const accountCaused = /origen y destino/i.test(transferError) || (payload ? sameAccountDestination(destination, payload.sourceAccountId) : destinationIsSource);
    if (payload) {
      setRejectedCombo({ sourceAccountId: payload.sourceAccountId, beneficiaryId: 'beneficiaryId' in payload ? payload.beneficiaryId : undefined, amountMinor: payload.amountMinor, reason: transferError || 'La transferencia fue rechazada.' });
      setSelectedId(payload.sourceAccountId);
    }
    setOriginOpen(accountCaused);
    void clearRecovery(session?.user.id).catch(() => undefined);
    setTransfer(null); setCreateAttempt(null); setConfirmAttempt(null); setConfirmUncertain(false); setRejectionUnverified(false); setOtp(''); setOtpExpired(false); setOtpWrong(false); setOtpLocked(false); setTransferError(''); setDemoOnlyCode('');
    setTransferScreen('details');
  }

  async function leaveOtp() {
    // F-12: while a confirm (or any other request of this attempt) is in flight its outcome is not known yet; leaving
    // now would show the review while the server may be completing the transfer. The UI disables the exits too.
    if (transferBusy || transferInFlight.current) return;
    if (confirmUncertain) {
      // F-06: a confirm whose outcome is unknown may already have moved money. Read the original transfer first; only
      // if it is still awaiting confirmation is it safe to go back to review (where a new attempt could be created).
      if (!session || !transfer) return;
      transferInFlight.current = true;
      setTransferBusy(true); setTransferError('');
      try {
        const current = await request<Transfer>(`/transfers/${encodeURIComponent(transfer.id)}`, session.accessToken);
        setTransfer(current); setConfirmUncertain(false); setConfirmAttempt(null); setOtp('');
        if (current.status !== 'awaiting_confirmation') {
          if (isTerminalStatus(current.status)) await clearRecovery(session.user.id);
          setTransferScreen(screenForStatus(current.status));
          return;
        }
      } catch {
        setTransferError(UNCERTAIN_CONFIRM_MESSAGE);
        return;
      } finally { setTransferBusy(false); transferInFlight.current = false; }
    }
    // G (F-10): leaving the code step abandons this attempt; cancel it instead of leaving an orphan pending row.
    // F-21: the record is dropped only once the API confirms the attempt closed. If that cannot be confirmed the attempt
    // may still be open, so it stays recorded and Home offers only resuming it (no new attempt can start meanwhile).
    const abandoned = transfer;
    if (!session) return;
    if (abandoned) {
      transferInFlight.current = true;
      setTransferBusy(true); setTransferError('');
      let closed: Transfer | null;
      try { closed = await closePreviousAttempt(abandoned, session.accessToken); }
      finally { setTransferBusy(false); transferInFlight.current = false; }
      if (!closed || !isTerminalStatus(closed.status)) { leaveUncertainTransfer(); return; }
      if (closed.status !== 'cancelled' && closed.status !== 'expired') {
        setTransfer(closed); setOtp(''); setConfirmAttempt(null);
        await clearRecovery(session.user.id);
        setTransferScreen(screenForStatus(closed.status));
        return;
      }
    }
    await clearRecovery(session.user.id).catch(() => undefined);
    setOtp(''); setOtpExpired(false); setOtpWrong(false); setOtpLocked(false); setConfirmAttempt(null); setTransferError(''); setTransfer(null); setCreateAttempt(null); setDemoOnlyCode('');
    // A pending attempt resumed after a restart has no draft in memory; go home rather than to an empty review.
    if (!destination) { resetTransfer(); return; }
    setTransferScreen('review');
  }
  // H: daily limit, remaining amount and OTP threshold come from the server (demo configuration), never hard-coded.
  const policyQuery = useQuery({
    queryKey: ['transfer-policy', session?.user.id],
    queryFn: () => request<TransferPolicy>('/transfer-policy', session?.accessToken),
    enabled: Boolean(session && !hidden && (transferScreen === 'details' || transferScreen === 'review' || transferScreen === 'otp' || transferScreen === 'rejected')),
    staleTime: 0,
    retry: 0,
  });
  const beneficiariesQuery = useQuery({
    queryKey: ['beneficiaries', session?.user.id],
    queryFn: async () => {
      try { return (await request<{ items: Beneficiary[] }>('/beneficiaries', session?.accessToken)).items; }
      catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) throw error;
        const refreshToken = await SecureStore.getItemAsync(REFRESH_KEY);
        if (!refreshToken) { await expireSession(); await endSession(); throw error; }
        try {
          const refreshed = await request<AuthResponse>('/auth/refresh', undefined, { method: 'POST', body: JSON.stringify({ client: 'mobile', refreshToken }) });
          if (!refreshed.refreshToken) throw new Error('La API no devolvió la sesión móvil renovada.');
          await SecureStore.setItemAsync(REFRESH_KEY, refreshed.refreshToken);
          setSession({ accessToken: refreshed.accessToken, user: refreshed.user });
          return (await request<{ items: Beneficiary[] }>('/beneficiaries', refreshed.accessToken)).items;
        } catch (refreshError) { await expireSession(); await endSession(); throw refreshError; }
      }
    },
    enabled: Boolean(session && choosingBeneficiary && !hidden),
  });
  const beneficiaries = beneficiariesQuery.data ?? [];
  const normalizedSearch = beneficiarySearch.trim().toLocaleLowerCase('es-MX');
  const filteredBeneficiaries = beneficiaries.filter((beneficiary) =>
    [beneficiary.name, beneficiary.alias, beneficiary.clabeMasked].some((value) => value.toLocaleLowerCase('es-MX').includes(normalizedSearch)),
  );

  // F-21: Home resolves a pending attempt by itself whenever Home is shown and when the app returns to the foreground with
  // a valid session: GET by its id or, when its id never arrived, the idempotent replay of the same create (same key and
  // body). A resolved attempt shows its real result (receipt when completed) and the transfer flow is enabled again;
  // otherwise (still pending, processing or no answer) the notice and its single action stay.
  async function resolvePendingFromHome() {
    if (!session || pendingCheckInFlight.current || transferInFlight.current) return;
    const userId = session.user.id;
    const token = session.accessToken;
    pendingCheckInFlight.current = true;
    setPendingCheck('checking');
    let record: RecoveryRecord | null = null;
    try {
      record = await readOwnRecovery(userId);
      if (sessionUserRef.current !== userId) return;
      if (!record) { setPendingRecord(null); setPendingCheck('idle'); return; }
      let result: Transfer;
      if (record.transferId) result = await request<Transfer>(`/transfers/${encodeURIComponent(record.transferId)}`, token);
      else {
        const created = await request<Transfer>('/transfers', token, { method: 'POST', headers: { 'Idempotency-Key': record.key }, body: JSON.stringify(record.payload) });
        result = created.status === 'completed' ? await request<Transfer>(`/transfers/${encodeURIComponent(created.id)}`, token) : created;
      }
      if (sessionUserRef.current !== userId) return;
      if (isTerminalStatus(result.status)) {
        await clearRecovery(userId);
        setCreateAttempt({ key: record.key, payload: record.payload }); setTransfer(result); setTransferError(''); setRejectionUnverified(false);
        setTransferScreen(screenForStatus(result.status));
      } else {
        await saveRecovery({ ...record, transferId: result.id, status: result.status }, userId);
        setPendingCheck('idle');
      }
    } catch (error) {
      if (sessionUserRef.current !== userId) return;
      if (record && !record.transferId && error instanceof ApiError && isBusinessRejection(error)) {
        // The replayed create was refused by a business rule, so nothing was posted: M11, and the flow is enabled again.
        await clearRecovery(userId).catch(() => undefined);
        setCreateAttempt({ key: record.key, payload: record.payload }); setTransfer(null); setTransferError(error.message); setRejectionUnverified(false);
        void client.invalidateQueries({ queryKey: ['accounts'] });
        setTransferScreen('rejected');
        return;
      }
      setPendingCheck('failed');
    } finally { pendingCheckInFlight.current = false; }
  }
  const homeVisible = Boolean(session && ready && recoveryReady && !transferScreen && !choosingBeneficiary && !movementDetail && !movementDetailBusy && !movementDetailError && activeTab === 'home');
  const pendingKey = pendingRecord?.key;
  useEffect(() => {
    if (!homeVisible || !pendingKey) return;
    void resolvePendingFromHome();
    // Runs when Home is shown, for a new pending key, and on each confirmed return to the foreground (homeCheckTick).
  }, [homeVisible, pendingKey, homeCheckTick]);

  async function login() {
    setFormError(''); setFormErrorKind('validation');
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
      setPassword(''); setSessionExpired(false);
    } catch (error) {
      setFormErrorKind(error instanceof ApiError ? (error.status === 401 ? 'credentials' : error.status === 429 ? 'locked' : 'other') : 'network');
      setFormError(error instanceof Error ? error.message : 'No fue posible iniciar sesión.');
    } finally { setSubmitting(false); }
  }

  if (!ready) return <Centered><ActivityIndicator color={colors.primary} /><Text style={styles.muted}>Preparando sesión segura…</Text></Centered>;
  if (hidden) return <PrivacyScreen />;
  if (!session) return <LoginScreen email={email} password={password} setEmail={setEmail} setPassword={setPassword} passwordVisible={passwordVisible} setPasswordVisible={setPasswordVisible} error={formError} errorKind={formErrorKind} sessionExpired={sessionExpired} submitting={submitting} onSubmit={() => void login()} />;

  // Opened from Home or from "Cambiar beneficiario" on the transfer details step; any later step keeps priority.
  if (choosingBeneficiary && (!transferScreen || transferScreen === 'details')) return <BeneficiaryPickerScreen queryPending={beneficiariesQuery.isPending} error={beneficiariesQuery.error instanceof Error ? beneficiariesQuery.error.message : ''} beneficiaries={filteredBeneficiaries} total={beneficiaries.length} search={beneficiarySearch} setSearch={setBeneficiarySearch} userInitials={initials(session.user.fullName)} backLabel={transferScreen ? 'Volver a datos de transferencia' : 'Volver a inicio'} source={selected} accounts={accounts} onSelectSource={setSelectedId} onRetry={() => void beneficiariesQuery.refetch()} onClose={() => setChoosingBeneficiary(false)} onChoose={(beneficiary) => { setDestination(beneficiary); setChoosingBeneficiary(false); }} />;
  if (transferScreen) return <TransferFlow screen={transferScreen} policy={policyQuery.data ?? null} onOtpTimeout={otpTimedOut} confirmUncertain={confirmUncertain} sameAccount={destinationIsSource} originOpen={originOpen} setOriginOpen={setOriginOpen} onSelectSource={(id) => { setSelectedId(id); setTransferError(''); }} rejectedWarning={repeatsRejected && transferScreen === 'review' ? rejectedCombo?.reason ?? null : null} amount={amount} setAmount={setAmount} concept={concept} setConcept={setConcept} reference={reference} setReference={setReference} otp={otp} setOtp={setOtp} destination={destination} source={selected} transfer={transfer} demoOnlyCode={demoOnlyCode} error={transferError} busy={transferBusy} createRetry={Boolean(createAttempt && transferScreen === 'status' && !transfer)} confirmRetry={Boolean(confirmAttempt)} rejectionUnverified={rejectionUnverified} otpExpired={otpExpired} otpWrong={otpWrong} otpLocked={otpLocked} verifying={transferBusy && Boolean(confirmAttempt)} pendingPayload={createAttempt?.payload ?? null} accounts={accounts} postBalance={postBalance} userInitials={initials(session.user.fullName)} onChangeBeneficiary={() => { setBeneficiarySearch(''); setChoosingBeneficiary(true); }} onRequestNewCode={() => void requestNewCode()} onLeave={leaveUncertainTransfer} onMovements={showMovementsAfterTransfer} onEdit={editRejectedTransfer} onBack={() => { if (transferScreen === 'otp') void leaveOtp(); else setTransferScreen(transferScreen === 'review' ? 'details' : 'review'); }} onReview={() => { if (destinationIsSource) { setTransferError(SAME_ACCOUNT_MESSAGE); return; } setTransferError(''); setTransferScreen('review'); }} onCreate={() => void submitCreate()} onRetryCreate={() => void submitCreate(true)} onConfirm={() => void confirmOtp()} onRetryConfirm={() => void confirmOtp(true)} onCheck={() => void checkTransferStatus()} onDone={resetTransfer} />;

  if (movementDetailBusy || movementDetailError) return <View style={styles.page}><View style={styles.flowContent}><Pressable accessibilityRole="button" accessibilityLabel="Volver a movimientos" style={styles.backButton} onPress={() => { setMovementDetailError(''); setMovementDetailBusy(false); setMovementDetailId(''); }}><Ionicons name="arrow-back" size={22} color={colors.primary}/><Text style={styles.link}>Movimientos</Text></Pressable>{movementDetailBusy ? <Centered><ActivityIndicator color={colors.primary}/><Text style={styles.muted}>Cargando comprobante…</Text></Centered> : <View style={styles.notice}><Text accessibilityRole="alert" style={styles.errorText}>{movementDetailError}</Text><Button title="Reintentar" onPress={() => { const item = movementsQuery.data?.items.find((movement) => movement.transferId === movementDetailId); if (item) void openMovement(item); }}/></View>}</View></View>;
  const closeMovementDetail = () => { setMovementDetail(null); setMovementDetailId(''); setMovementDetailError(''); };
  if (movementDetail) return <MovementReceipt movement={movementDetail.movement} transfer={movementDetail.transfer} accountId={selected?.id} accounts={accounts} userInitials={initials(session.user.fullName)} onBack={closeMovementDetail} onHome={() => { closeMovementDetail(); setActiveTab('home'); }} />;

  if (activeTab === 'movements') return <MovementListScreen account={selected} movements={movementsQuery.data?.items ?? []} pending={movementsQuery.isPending} error={movementsQuery.error instanceof Error ? movementsQuery.error.message : ''} hasMore={Boolean(movementsQuery.data?.nextCursor)} loadingMore={movementsQuery.isFetching} onRetry={() => void movementsQuery.refetch()} onLoadMore={() => void loadMoreMovements()} onOpen={openMovement} onSelectAccount={setSelectedId} accounts={accounts} initials={initials(session.user.fullName)} onNavigate={setActiveTab} />;


  return <View style={styles.page}>
    <StatusBar barStyle="dark-content" />
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <AppTopbar section="INICIO" initials={initials(session.user.fullName)}/>
      <View testID="home-greeting-row" style={styles.greeting}><View style={styles.greetingCopy}><Text testID="home-greeting" numberOfLines={2} ellipsizeMode="tail" style={styles.title}>Hola, {session.user.fullName}</Text><Text numberOfLines={2} style={styles.greetingSub}>{updatedLabel ?? 'Tus cuentas y saldos'}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Cerrar sesión" hitSlop={4} style={styles.iconButton} onPress={() => { setSessionExpired(false); void endSession(); }}><Ionicons name="log-out-outline" size={20} color={colors.muted} /></Pressable></View>
      {accountsQuery.isPending ? <Centered><ActivityIndicator color={colors.primary} /><Text style={styles.muted}>Cargando tus cuentas…</Text></Centered> : accountsQuery.isError ? <View style={styles.notice}><Ionicons name="cloud-offline-outline" size={22} color={colors.error} /><Text style={styles.errorText}>{accountsQuery.error.message}</Text><Button title="Reintentar" onPress={() => void accountsQuery.refetch()} /></View> : accounts.length === 0 ? <View style={styles.notice}><Text style={styles.sectionTitle}>Aún no tienes cuentas</Text><Text style={styles.muted}>Cuando haya una cuenta disponible, aparecerá aquí.</Text></View> : <>
        <View style={styles.accountTabs}>{accounts.map((account) => <Pressable key={account.id} accessibilityRole="button" accessibilityLabel={`${account.name} •• ${lastDigits(account.clabeMasked)}`} accessibilityState={{ selected: selected?.id === account.id }} style={[styles.tab, selected?.id === account.id && styles.tabSelected]} onPress={() => setSelectedId(account.id)}><View style={[styles.tabDot, selected?.id === account.id && styles.tabDotSelected]}/><Text numberOfLines={1} style={[styles.tabText, selected?.id === account.id && styles.tabTextSelected]}>{accountTabLabel(account.name)}</Text><Text numberOfLines={1} style={styles.tabDigits}>•• {lastDigits(account.clabeMasked)}</Text></Pressable>)}</View>
        {selected && <View style={styles.balanceCard}><View style={styles.accountLabel}><Text style={styles.tag}>{selected.kind === 'checking' ? 'CUENTA PRINCIPAL' : 'CUENTA DE AHORRO'}</Text><Text style={styles.balanceDigits}>•• {lastDigits(selected.clabeMasked)}</Text></View><View><Text style={styles.balanceLabel}>Saldo disponible</Text><View style={styles.balanceLine}><Text adjustsFontSizeToFit numberOfLines={1} style={styles.balance}>{formatMoney(selected.availableBalanceMinor)}</Text><Text style={styles.currency}>MXN</Text></View></View></View>}
      </>}
        {pendingRecord ? <PendingTransferNotice amountMinor={pendingRecord.payload.amountMinor} reference={pendingRecord.payload.reference} awaitingCode={pendingRecord.status === 'awaiting_confirmation'} checking={pendingCheck === 'checking'} checkFailed={pendingCheck === 'failed'} onResume={() => { if (pendingCheckInFlight.current) return; setPendingCheck('idle'); setRecoveryReady(false); }}/> : null}
        {/* F-21: while an attempt of this user is unresolved or waits for its code, Home offers no way to start another
            one (no "Transferir dinero", destination card or "Continuar"): only resuming/verifying that attempt. */}
        {pendingRecord ? null : destination ? <View style={styles.destinationCard}><View style={styles.destinationIcon}><Ionicons name="person-outline" size={22} color={colors.primary} /></View><View style={{ flex: 1 }}><Text style={styles.tag}>DESTINO SELECCIONADO</Text><Text style={styles.rowTitle}>{destination.name}</Text><Text style={styles.muted}>{destination.alias} · {destination.clabeMasked}</Text>{destinationIsSource ? <Text accessibilityRole="alert" style={styles.inlineWarningText}>Es la misma cuenta de origen seleccionada.</Text> : null}</View><Pressable accessibilityRole="button" accessibilityLabel="Cambiar beneficiario" hitSlop={8} style={styles.homeChangeLink} onPress={() => setChoosingBeneficiary(true)}><Text style={styles.link}>Cambiar</Text></Pressable></View> : <Pressable accessibilityRole="button" accessibilityLabel="Transferir dinero, elegir beneficiario" style={({ pressed }) => [styles.transferAction, pressed && styles.buttonPressed]} onPress={() => { setChoosingBeneficiary(true); setBeneficiarySearch(''); }}><Ionicons name="paper-plane-outline" size={20} color={colors.white} /><Text style={styles.buttonText}>Transferir dinero</Text></Pressable>}
        {/* Round 7 · 1: an incompatible pair (destination = origin, by ownAccountId identity) never offers "Continuar":
            the action leads to M05, which explains the conflict and offers the origin selector when there is another
            own account. A valid pair (e.g. Principal -> Ahorro) keeps "Continuar con transferencia". */}
        {!pendingRecord && destination && !choosingBeneficiary && (destinationIsSource
          ? <Button title="Elegir otro destinatario" variant="secondary" leadingIcon="people-outline" onPress={() => { setBeneficiarySearch(''); setTransferError(''); setChoosingBeneficiary(true); }} />
          : <Button title="Continuar con transferencia" disabled={!selected} onPress={() => { if (sameAccountDestination(destination, selected?.id)) return; setTransferScreen('details'); setTransferError(''); }} />)}
      {accounts.length > 0 && <>
         <Pressable accessibilityRole="button" accessibilityLabel={`Última actualización de saldo, ${updatedLabel ? `${updatedLabel} • ` : ''}Saldo total ${formatMoney(totalBalanceMinor)} MXN`} accessibilityHint="Actualiza tus cuentas y saldos" style={styles.updateNotice} onPress={() => void accountsQuery.refetch()}><View style={styles.updateIcon}><Ionicons name="sync-outline" size={18} color={colors.primary} /></View><View style={{ flex: 1 }}><Text style={styles.updateTitle}>Última actualización de saldo</Text><Text style={styles.updateText}>{updatedLabel ? `${updatedLabel} • ` : ''}Saldo total {formatMoney(totalBalanceMinor)} MXN</Text></View></Pressable>
         <View style={styles.activityHeader}><Text style={styles.activityTitle}>Actividad reciente</Text><Text style={styles.captionUpper}>ÚLTIMOS MOVIMIENTOS</Text></View>
         {movementsQuery.isPending ? <Centered><ActivityIndicator color={colors.primary} /><Text style={styles.muted}>Cargando movimientos…</Text></Centered> : movementsQuery.isError ? <View style={styles.notice}><Ionicons name="cloud-offline-outline" size={22} color={colors.error} /><View style={{ flex: 1 }}><Text style={styles.errorText}>{movementsQuery.error.message || 'Sin conexión. Revisa tu conexión e inténtalo de nuevo.'}</Text><Button title="Reintentar" onPress={() => void movementsQuery.refetch()} /></View></View> : (movementsQuery.data?.items.length ?? 0) === 0 ? <View style={styles.emptyState}><Ionicons name="receipt-outline" size={28} color={colors.primary} /><Text style={styles.sectionTitle}>Aún no hay movimientos</Text><Text style={styles.muted}>Los movimientos de esta cuenta aparecerán aquí.</Text></View> : <>
           <View style={styles.movementCard}>{movementsQuery.data?.items.slice(0, 3).map((movement, index) => {
             const credit = movement.type === 'credit';
             return <React.Fragment key={movement.id}>{index > 0 ? <View style={styles.homeDivider}/> : null}<Pressable accessibilityRole="button" accessibilityLabel={movementLabel([movementTitle(movement), movementSubtitle(movement), formatMoney(movement.amountMinor, { sign: credit ? 'credit' : 'debit', currency: true }), movementStatusLabel(movement.status), formatBusinessShort(movement.occurredAt) ?? DATE_UNAVAILABLE], credit)} onPress={() => void openMovement(movement)} style={styles.movementRow}>
               <MovementIcon movement={movement}/>
               <View style={styles.movementCopy}><Text numberOfLines={1} style={styles.movementTitle}>{movementTitle(movement)}</Text><Text numberOfLines={1} style={styles.movementSub}>{movementSubtitle(movement)}</Text><Text numberOfLines={1} style={styles.movementMeta}>{formatBusinessShort(movement.occurredAt) ?? DATE_UNAVAILABLE}</Text></View>
               <View style={styles.movementAmountColumn}><Text adjustsFontSizeToFit numberOfLines={1} style={[styles.movementAmount, credit && styles.creditAmount]}>{formatMoney(movement.amountMinor, { sign: credit ? 'credit' : 'debit', currency: true })}</Text><Text style={[styles.homeStatus, movement.status === 'completed' && styles.homeStatusDone]}>{movementStatusLabel(movement.status)}</Text></View>
             </Pressable></React.Fragment>;
           })}</View>
           <Pressable accessibilityRole="button" style={styles.seeAll} onPress={() => setActiveTab('movements')}><Text style={styles.seeAllText}>Ver los últimos 20 movimientos</Text><Ionicons name="chevron-forward" size={18} color={colors.primary}/></Pressable>
         </>}
      </>}
     </ScrollView>
     <BottomNavigation active="home" onChange={setActiveTab}/>
   </View>;
}

function MovementListScreen(props: { account: Account | undefined; accounts: Account[]; initials: string; movements: Movement[]; pending: boolean; error: string; hasMore: boolean; loadingMore: boolean; onRetry: () => void; onLoadMore: () => void; onOpen: (movement: Movement) => void; onSelectAccount: (id: string) => void; onNavigate: (tab: 'home' | 'movements') => void }) {
  const [choosingAccount, setChoosingAccount] = useState(false);
  const groups = props.movements.reduce<{ key: string; label: string; items: Movement[] }[]>((result, movement) => {
    const key = businessDayKey(movement.occurredAt) ?? 'sin-fecha';
    const group = result.find((entry) => entry.key === key);
    if (group) group.items.push(movement);
    else result.push({ key, label: businessDayLabel(movement.occurredAt), items: [movement] });
    return result;
  }, []);
  const multipleAccounts = props.accounts.length > 1;
  return <View style={styles.page}><StatusBar barStyle="dark-content"/><ScrollView contentContainerStyle={styles.content}>
    <AppTopbar section="MOVIMIENTOS" initials={props.initials}/>
    {props.account && <View style={styles.movementAccountCard}>
      <View style={styles.movementAccountTop}>
        <View style={styles.bankIcon}><MaterialIcons name="account-balance" size={20} color={colors.primary}/></View>
        <Pressable accessibilityRole="button" accessibilityLabel={`${props.account.name} (•• ${lastDigits(props.account.clabeMasked)})${multipleAccounts ? ', cambiar cuenta' : ''}`} accessibilityState={{ expanded: choosingAccount, disabled: !multipleAccounts }} disabled={!multipleAccounts} onPress={() => setChoosingAccount(!choosingAccount)} style={styles.accountPicker}>
          <Text numberOfLines={3} style={styles.movementAccountName}>{props.account.name} (•• {lastDigits(props.account.clabeMasked)})</Text>
          {multipleAccounts && <Ionicons name={choosingAccount ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted}/>}
        </Pressable>
        <View style={styles.movementBalance}><Text style={styles.eyebrow}>SALDO DISPONIBLE</Text><Text adjustsFontSizeToFit numberOfLines={1} style={styles.movementBalanceAmount}>{formatMoney(props.account.availableBalanceMinor)}</Text><Text style={styles.movementCurrency}>MXN</Text></View>
      </View>
      {multipleAccounts && choosingAccount && <View style={styles.accountOptions}>{props.accounts.map((account) => <Pressable key={account.id} accessibilityRole="button" accessibilityLabel={`${account.name} (•• ${lastDigits(account.clabeMasked)}), ${formatMoney(account.availableBalanceMinor)} MXN, ver sus movimientos`} accessibilityState={{ selected: account.id === props.account?.id }} onPress={() => { props.onSelectAccount(account.id); setChoosingAccount(false); }} style={[styles.accountOption, account.id === props.account?.id && styles.accountOptionSelected]}><Text numberOfLines={1} style={[styles.rowTitle, styles.summaryCopy]}>{account.name} (•• {lastDigits(account.clabeMasked)})</Text><Text style={styles.muted}>{formatMoney(account.availableBalanceMinor)} MXN</Text></Pressable>)}</View>}
    </View>}
    <Text style={styles.movementsTitle}>Últimos movimientos</Text>
    {props.pending ? <Centered><ActivityIndicator color={colors.primary}/><Text style={styles.muted}>Cargando movimientos…</Text></Centered> : props.error ? <View style={styles.emptyState}><Ionicons name="cloud-offline-outline" size={28} color={colors.error}/><Text style={styles.errorText}>{props.error}</Text><Button title="Reintentar" onPress={props.onRetry}/></View> : props.movements.length === 0 ? <View style={styles.emptyState}><Ionicons name="receipt-outline" size={28} color={colors.primary}/><Text style={styles.sectionTitle}>Aún no hay movimientos</Text><Text style={styles.muted}>Los movimientos de esta cuenta aparecerán aquí.</Text></View> : <>
      {groups.map((group) => <View key={group.key} style={styles.movementGroup}>
        <View style={styles.movementGroupHeading}><Text style={styles.groupLabel}>{group.label.toLocaleUpperCase('es-MX')}</Text><Text style={styles.groupCount}>{group.items.length} {group.items.length === 1 ? 'transacción' : 'transacciones'}</Text></View>
        <View style={styles.movementCard}>{group.items.map((movement, index) => {
          const credit = movement.type === 'credit';
          return <React.Fragment key={movement.id}>{index > 0 ? <View style={styles.listDivider}/> : null}<Pressable accessibilityRole="button" accessibilityLabel={movementLabel([movementTitle(movement), `${movementSubtitle(movement)}${movement.status === 'completed' ? '' : ` · ${movementStatusLabel(movement.status)}`}`, `Ref: ${movement.reference}${formatBusinessTime(movement.occurredAt) ? ` • ${formatBusinessTime(movement.occurredAt)}` : ''}`, `${formatMoney(movement.amountMinor, { sign: credit ? 'credit' : 'debit' })} MXN`, movementStatusLabel(movement.status), group.label], credit)} onPress={() => props.onOpen(movement)} style={styles.movementRow}>
            <MovementIcon movement={movement} list/>
            <View style={styles.movementCopy}>
              <Text numberOfLines={1} style={styles.movementTitle}>{movementTitle(movement)}</Text>
              <Text numberOfLines={1} style={[styles.movementSub, credit && styles.movementSubCredit]}>{movementSubtitle(movement)}{movement.status === 'completed' ? '' : ` · ${movementStatusLabel(movement.status)}`}</Text>
              <Text numberOfLines={2} style={[styles.movementMeta, styles.movementMetaList]}>Ref: {movement.reference}{formatBusinessTime(movement.occurredAt) ? ` • ${formatBusinessTime(movement.occurredAt)}` : ''}</Text>
            </View>
            <View style={styles.movementAmountColumn}><Text adjustsFontSizeToFit numberOfLines={1} style={[styles.movementAmount, styles.movementAmountList, credit && styles.creditAmount, credit && styles.movementAmountCredit]}>{formatMoney(movement.amountMinor, { sign: credit ? 'credit' : 'debit' })}</Text><Text style={[styles.movementCurrency, credit && styles.creditAmount]}>MXN</Text></View>
            <Ionicons name="chevron-forward" size={20} color={colors.placeholder} style={styles.listChevron}/>
          </Pressable></React.Fragment>;
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
  if (status === 'expired') return 'Expirada';
  if (status === 'cancelled') return 'Cancelada';
  return 'En verificación de estado';
}

// M02/M03 rows: "A Carlos Ruiz" / "De Empresa Demo" / "Traspaso a Ahorro" from Movement.counterparty; the concept is
// the title only when an older API response has no counterparty.
function movementTitle(movement: Movement): string {
  const party = movement.counterparty;
  if (!party?.name) return movement.concept;
  const credit = movement.type === 'credit';
  if (party.ownAccountId) return `${credit ? 'Traspaso de' : 'Traspaso a'} ${party.name}`;
  return `${credit ? 'De' : 'A'} ${party.name}`;
}
function movementSubtitle(movement: Movement): string {
  const digits = lastDigits(movement.counterparty?.clabeMasked ?? '');
  if (!movement.counterparty?.name) return movement.type === 'credit' ? 'Abono' : 'Cargo';
  return digits ? `•• ${digits} · ${movement.concept}` : movement.concept;
}
// M02 rows: debit/own on surface-container with on-surface icon, credit on secondary-fixed. M03 rows: debit on
// surface-container-high, credit on secondary-container/40 with a secondary icon (Stitch).
function MovementIcon({ movement, list = false }: { movement: Movement; list?: boolean }) {
  const credit = movement.type === 'credit';
  const own = Boolean(movement.counterparty?.ownAccountId);
  const creditTone = credit && !own;
  const tint = creditTone ? (list ? colors.success : colors.onSecondaryFixedVariant) : own ? colors.primary : colors.text;
  return <View style={[styles.movementIcon, list && styles.movementIconList, creditTone && (list ? styles.creditIconList : styles.creditIcon)]}><MaterialIcons name={own ? 'swap-horiz' : credit ? 'south-west' : 'north-east'} size={20} color={tint}/></View>;
}

// F-20: the accessible name of a movement row carries every visible part (counterparty, account digits and concept,
// signed amount, status, date) in reading order, then the kind for screen readers.
function movementLabel(parts: string[], credit: boolean): string {
  return [...parts.filter(Boolean), credit ? 'Abono' : 'Cargo'].join(', ');
}
function movementStatusLabel(status: Movement['status']): string {
  return status === 'completed' ? 'Completado' : status === 'processing' ? 'En proceso' : 'Rechazado';
}

// Tab label as in the M02 reference ("Principal", "Ahorro"): drops a leading "Cuenta" so the name fits a half-width tab.
function accountTabLabel(name: string): string {
  const short = name.replace(/^cuenta\s+/i, '').trim();
  return short ? short.charAt(0).toLocaleUpperCase('es-MX') + short.slice(1) : name;
}
function lastDigits(masked: string): string { return masked.replace(/\D/g, '').slice(-4); }

// M02/M03 header: brand mark, "Billetera MXN" + section caption and the user's initials (Stitch h-16 bar).
function AppTopbar({ section, initials: userInitials }: { section: string; initials: string }) {
  return <View style={styles.topbar}><View style={styles.topbarBrand}><View style={styles.loginHeaderMark}><Ionicons name="wallet-outline" size={18} color={colors.white}/></View><View><Text style={styles.brand}>Billetera MXN</Text><Text style={styles.topbarSection}>{section}</Text></View></View><View style={styles.avatar}><Text style={styles.avatarText}>{userInitials}</Text></View></View>;
}

// F-21: Home's only transfer action while an attempt of this user is unresolved or still waits for its code. The action
// resumes that same attempt (same Idempotency-Key); nothing on Home can start another one until it is resolved.
function PendingTransferNotice({ amountMinor, reference, awaitingCode, checking, checkFailed, onResume }: { amountMinor: string; reference: string; awaitingCode: boolean; checking: boolean; checkFailed: boolean; onResume: () => void }) {
  return <View accessibilityRole="alert" testID="pending-transfer-notice" style={styles.pendingNotice}>
    <View style={styles.estimateLabel}><Ionicons name={awaitingCode ? 'shield-checkmark-outline' : 'hourglass-outline'} size={20} color={colors.primary}/><Text style={styles.pendingNoticeTitle}>{awaitingCode ? 'Transferencia pendiente de autorizar' : 'Transferencia en verificación'}</Text></View>
    {awaitingCode
      ? <Text style={styles.pendingNoticeText}>Tu operación de {formatMoney(amountMinor, { currency: true })} (Ref: {reference}) espera su código de autorización. Continúa con ella o cancélala antes de enviar otra.</Text>
      : <Text style={styles.pendingNoticeText}>Aún no confirmamos si se aplicó la operación de {formatMoney(amountMinor, { currency: true })} (Ref: {reference}). No la envíes de nuevo: verifica su estado. Podrás hacer otra transferencia cuando conozcamos su resultado.</Text>}
    {checking ? <Text accessibilityLiveRegion="polite" style={styles.pendingNoticeText}>Consultando el estado de esta operación…</Text>
      : checkFailed ? <Text accessibilityLiveRegion="polite" style={styles.pendingNoticeText}>Sin respuesta por ahora. La consultaremos de nuevo al volver a Inicio o a la app.</Text> : null}
    <Button title={awaitingCode ? 'Continuar con la transferencia pendiente' : 'Verificar estado de la transferencia'} leadingIcon={awaitingCode ? 'arrow-forward' : 'sync-outline'} loading={checking} disabled={checking} onPress={onResume}/>
  </View>;
}

function BottomNavigation({ active, onChange }: { active: 'home' | 'movements'; onChange: (tab: 'home' | 'movements') => void }) {
  return <View style={styles.bottomNavigation}>{(['home', 'movements'] as const).map((tab) => <Pressable key={tab} accessibilityRole="tab" accessibilityState={{ selected: active === tab }} onPress={() => onChange(tab)} style={styles.navigationItem}><Ionicons name={tab === 'home' ? (active === tab ? 'wallet' : 'wallet-outline') : (active === tab ? 'receipt' : 'receipt-outline')} size={24} color={active === tab ? colors.primary : colors.muted}/><Text style={[styles.navigationLabel, active === tab && styles.navigationLabelActive]}>{tab === 'home' ? 'Inicio' : 'Movimientos'}</Text></Pressable>)}</View>;
}

function BeneficiaryPickerScreen(props: { queryPending: boolean; error: string; beneficiaries: Beneficiary[]; total: number; search: string; setSearch: (value: string) => void; userInitials: string; backLabel: string; source: Account | undefined; accounts: Account[]; onSelectSource: (id: string) => void; onRetry: () => void; onClose: () => void; onChoose: (beneficiary: Beneficiary) => void }) {
  const empty = !props.queryPending && !props.error && props.total === 0;
  const incompatibleCount = props.beneficiaries.filter((beneficiary) => sameAccountDestination(beneficiary, props.source?.id)).length;
  // B/C: every destination is the origin account itself (e.g. Ahorro -> "Cuenta de ahorro demo").
  const noCompatible = !props.queryPending && !props.error && props.beneficiaries.length > 0 && incompatibleCount === props.beneficiaries.length;
  const sourceLabel = props.source ? `${props.source.name} •• ${lastDigits(props.source.clabeMasked)}` : '';
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
        : empty ? <><View style={styles.pickerMeta}><Text style={styles.captionLabel}>INFORMACIÓN DE GESTIÓN</Text><Text style={styles.captionMeta}>Billetera MXN</Text></View><View style={styles.pickerEmpty}><View style={styles.pickerEmptyIcon}><Ionicons name="person" size={24} color={colors.muted}/></View><Text style={styles.pickerEmptyTitle}>No tienes beneficiarios guardados</Text><Text style={styles.pickerEmptyText}>Los beneficiarios se registran y administran únicamente desde la plataforma web.</Text></View></>
        : props.beneficiaries.length === 0 ? <View style={styles.pickerEmpty}><Text style={styles.pickerEmptyTitle}>Sin resultados</Text><Text style={styles.pickerEmptyText}>Prueba con otro nombre o alias.</Text></View>
        : <>
          {incompatibleCount > 0 && <View style={styles.originNotice}>
            <View style={styles.estimateLabel}><Ionicons name="information-circle-outline" size={18} color={colors.primary}/><Text style={styles.originNoticeText}>{noCompatible ? `No hay destinos disponibles desde ${sourceLabel}: tu beneficiario es esta misma cuenta.` : `Enviando desde ${sourceLabel}. Un destino que es esta misma cuenta no está disponible.`}</Text></View>
            {props.accounts.length > 1 ? <><Text style={styles.originNoticeCaption}>Cuenta de origen</Text><OriginAccountOptions accounts={props.accounts} selectedId={props.source?.id} onSelect={props.onSelectSource}/></> : null}
          </View>}
          {props.beneficiaries.map((beneficiary) => {
            const incompatible = sameAccountDestination(beneficiary, props.source?.id);
            return <Pressable key={beneficiary.id} accessibilityRole="button" accessibilityLabel={`Seleccionar ${beneficiary.name}, ${beneficiary.alias}, Billetera MXN •• ${lastDigits(beneficiary.clabeMasked)}, CLABE ${beneficiary.clabeMasked}${incompatible ? `, no disponible: es la misma cuenta de origen. ${INCOMPATIBLE_DESTINATION_TEXT}` : ''}`} accessibilityState={{ disabled: incompatible }} disabled={incompatible} onPress={() => { if (!incompatible) props.onChoose(beneficiary); }} style={({ pressed }) => [styles.beneficiaryCard, pressed && styles.beneficiaryCardPressed, incompatible && styles.beneficiaryCardDisabled]}>
              <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.beneficiaryAvatar}><Text style={styles.beneficiaryInitials}>{initials(beneficiary.name)}</Text></View>
              <View style={styles.summaryCopy}>
                <View style={styles.beneficiaryNameLine}><Text numberOfLines={1} style={styles.beneficiaryName}>{beneficiary.name}</Text><Text numberOfLines={1} style={styles.aliasBadge}>{beneficiary.alias}</Text></View>
                <Text numberOfLines={1} style={styles.beneficiaryAccount}>Billetera MXN •• {lastDigits(beneficiary.clabeMasked)}</Text>
                {incompatible ? <Text style={styles.inlineWarningText}>{INCOMPATIBLE_DESTINATION_TEXT}</Text> : null}
              </View>
              {incompatible ? <Ionicons name="remove-circle-outline" size={20} color={colors.placeholder}/> : <Ionicons name="chevron-forward" size={20} color={colors.placeholder}/>}
            </Pressable>;
          })}
          {noCompatible && props.accounts.length <= 1 ? <Button title="Volver" variant="secondary" leadingIcon="arrow-back" onPress={props.onClose}/> : null}
        </>}
      {!empty && <View style={styles.pickerFooter}><Ionicons name="information-circle-outline" size={16} color={colors.placeholder}/><Text style={styles.pickerFooterText}>Los beneficiarios se registran y administran únicamente desde la versión web.</Text></View>}
    </ScrollView>
  </View>;
}

// C (documented exception to the M06 reference, which shows a single fixed origin): a compact list of the user's own
// accounts, reused on the details step and in the picker, so the origin can be changed where it caused a problem.
function OriginAccountOptions({ accounts, selectedId, destination, onSelect }: { accounts: Account[]; selectedId: string | undefined; destination?: Beneficiary | null; onSelect: (id: string) => void }) {
  return <View accessibilityRole="radiogroup" style={styles.originOptions}>{accounts.map((account) => {
    const selected = account.id === selectedId;
    const isDestination = sameAccountDestination(destination, account.id);
    const detail = `Disponible: ${formatMoney(account.availableBalanceMinor, { currency: true })}${isDestination ? ' · es el destino elegido' : ''}`;
    return <Pressable key={account.id} accessibilityRole="radio" accessibilityLabel={`Usar ${account.name} •• ${lastDigits(account.clabeMasked)} como cuenta de origen${isDestination ? ', es el destino elegido' : ''}, ${detail}`} accessibilityState={{ selected, checked: selected }} onPress={() => onSelect(account.id)} style={[styles.originOption, selected && styles.originOptionSelected]}>
      <View style={[styles.radio, selected && styles.radioSelected]}>{selected ? <View style={styles.radioDot}/> : null}</View>
      <View style={styles.summaryCopy}><Text numberOfLines={2} style={styles.rowTitle}>{account.name} •• {lastDigits(account.clabeMasked)}</Text><Text style={styles.originBalance}>{detail}</Text></View>
    </Pressable>;
  })}</View>;
}

function LoginScreen(props: { email: string; password: string; setEmail: (value: string) => void; setPassword: (value: string) => void; passwordVisible: boolean; setPasswordVisible: (value: boolean) => void; error: string; errorKind: 'validation' | 'credentials' | 'locked' | 'network' | 'other'; sessionExpired: boolean; submitting: boolean; onSubmit: () => void }) {
  const errorBox = props.error && props.errorKind !== 'validation'
    ? props.errorKind === 'credentials' ? { icon: 'alert-circle' as const, tint: colors.error, tone: null, title: 'Credenciales no válidas', text: 'Correo o contraseña incorrectos. Verifica tus datos e intenta nuevamente.' }
      : props.errorKind === 'locked' ? { icon: 'lock-closed-outline' as const, tint: colors.tertiaryContainer, tone: styles.loginErrorLocked, title: 'Acceso bloqueado temporalmente', text: props.error }
        : props.errorKind === 'network' ? { icon: 'cloud-offline-outline' as const, tint: colors.placeholder, tone: styles.loginErrorNetwork, title: 'Sin conexión a internet', text: 'Comprueba tu red móvil o señal Wi-Fi e inténtalo de nuevo.' }
          : { icon: 'alert-circle' as const, tint: colors.error, tone: null, title: 'No fue posible iniciar sesión', text: props.error }
    : null;
  return <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><StatusBar barStyle="dark-content" />
    <View style={styles.loginHeader}><View style={styles.loginHeaderMark}><Ionicons name="wallet-outline" size={18} color={colors.white}/></View><Text style={styles.headerTitle}>Billetera MXN</Text></View>
    <ScrollView contentContainerStyle={styles.loginContent} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}>
    {/* I: tapping outside a field closes the keyboard; nested buttons and inputs keep their own touches. */}
    <DismissKeyboardArea>
    {/* M12 "Sesión vencida": the expired-session card (icon, title, explanation) takes the place of the brand block. */}
    {props.sessionExpired ? <View accessibilityRole="alert" style={styles.expiredCard}><View style={styles.expiredIcon}><Ionicons name="timer-outline" size={32} color={colors.primary}/><View style={styles.expiredDot}><View style={styles.expiredDotInner}/></View></View><Text style={styles.expiredTitle}>Tu sesión ha expirado</Text><Text style={styles.expiredText}>Por tu seguridad cerramos la sesión. Inicia sesión nuevamente para continuar.</Text></View>
      : <View style={styles.loginBrand}><View style={styles.walletMark}><Ionicons name="wallet-outline" size={30} color={colors.primary} /></View><Text style={styles.loginEyebrow}>BILLETERA MXN</Text><Text style={styles.loginTitle}>Iniciar sesión</Text><Text style={styles.loginSubtitle}>Ingresa con tu correo y contraseña registrados en el panel web.</Text></View>}
    {errorBox ? <View accessibilityRole="alert" style={[styles.loginError, errorBox.tone]}><Ionicons name={errorBox.icon} size={20} color={errorBox.tint}/><View style={styles.summaryCopy}><Text style={styles.loginErrorTitle}>{errorBox.title}</Text><Text style={styles.loginErrorText}>{errorBox.text}</Text></View></View> : null}
    <View style={styles.formCard}><Text style={styles.label}>Correo electrónico</Text><View style={styles.inputWrap}><Ionicons name="mail-outline" size={20} color={colors.placeholder} /><TextInput accessibilityLabel="Correo electrónico" autoCapitalize="none" autoComplete="email" keyboardType="email-address" returnKeyType="next" value={props.email} onChangeText={props.setEmail} placeholder="tu@correo.com" placeholderTextColor={colors.placeholder} style={styles.input} /></View><Text style={[styles.label, { marginTop: 16 }]}>Contraseña</Text><View style={styles.inputWrap}><Ionicons name="lock-closed-outline" size={20} color={colors.placeholder} /><TextInput accessibilityLabel="Contraseña" autoCapitalize="none" autoComplete="password" secureTextEntry={!props.passwordVisible} returnKeyType="done" onSubmitEditing={props.onSubmit} value={props.password} onChangeText={props.setPassword} placeholder="Tu contraseña" placeholderTextColor={colors.placeholder} style={styles.input} /><Pressable accessibilityRole="button" accessibilityLabel={props.passwordVisible ? 'Ocultar contraseña' : 'Mostrar contraseña'} hitSlop={10} onPress={() => props.setPasswordVisible(!props.passwordVisible)}><Ionicons name={props.passwordVisible ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.placeholder} /></Pressable></View>
       {props.error && !errorBox ? <Text accessibilityRole="alert" style={styles.errorText}>{props.error}</Text> : null}<Button title={props.sessionExpired ? 'Iniciar sesión nuevamente' : 'Iniciar sesión'} trailingIcon="arrow-forward" iconSize={18} loading={props.submitting} disabled={props.submitting} onPress={props.onSubmit} style={styles.loginButton} /></View>
    <View style={styles.infoBox}><Ionicons name="information-circle-outline" size={20} color={colors.placeholder} /><View style={styles.summaryCopy}><Text style={styles.infoTitle}>¿No tienes cuenta?</Text><Text style={styles.infoText}>El registro se realiza exclusivamente desde la versión web de Billetera MXN.</Text></View></View>
    <Text style={styles.loginFooter}>Billetera MXN • Demostración técnica</Text>
    </DismissKeyboardArea>
  </ScrollView></KeyboardAvoidingView>;
}

function TransferFlow(props: { screen: FlowScreen; policy: TransferPolicy | null; onOtpTimeout: () => void; confirmUncertain: boolean; sameAccount: boolean; originOpen: boolean; setOriginOpen: (open: boolean) => void; onSelectSource: (id: string) => void; rejectedWarning: string | null; amount: string; setAmount: (value: string) => void; concept: string; setConcept: (value: string) => void; reference: string; setReference: (value: string) => void; otp: string; setOtp: (value: string) => void; destination: Beneficiary | null; source: Account | undefined; transfer: Transfer | null; demoOnlyCode: string; error: string; busy: boolean; createRetry: boolean; confirmRetry: boolean; rejectionUnverified: boolean; otpExpired: boolean; otpWrong: boolean; otpLocked: boolean; verifying: boolean; pendingPayload: TransferRequest | null; accounts: Account[]; postBalance: { accountName: string; minor: string } | null; userInitials: string; onChangeBeneficiary: () => void; onRequestNewCode: () => void; onLeave: () => void; onMovements: () => void; onEdit: () => void; onBack: () => void; onReview: () => void; onCreate: () => void; onRetryCreate: () => void; onConfirm: () => void; onRetryConfirm: () => void; onCheck: () => void; onDone: () => void }) {
  const minor = amountToMinor(props.amount);
  const insufficient = Boolean(minor && props.source && BigInt(minor) > BigInt(props.source.availableBalanceMinor));
  const formValid = Boolean(minor && props.concept.trim().length >= 1 && props.concept.trim().length <= 40 && /^\d{1,7}$/.test(props.reference));
  // H: compared as BigInt minor units against the server policy; the API still enforces both rules.
  const overDailyLimit = Boolean(minor && props.policy && BigInt(minor) > BigInt(props.policy.dailyRemainingMinor));
  const requiresOtp = Boolean(minor && props.policy && BigInt(minor) >= BigInt(props.policy.otpThresholdMinor));
  const thresholdLabel = props.policy ? formatMoney(props.policy.otpThresholdMinor, { currency: true }) : null;
  const expiresAtMs = props.screen === 'otp' ? parseTimestamp(props.transfer?.expiresAt) : null;
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (expiresAtMs === null || props.otpExpired) return;
    setNowMs(Date.now());
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expiresAtMs, props.otpExpired]);
  const remainingSeconds = expiresAtMs === null ? null : Math.max(0, Math.ceil((expiresAtMs - nowMs) / 1000));
  const { onOtpTimeout, otpExpired } = props;
  const otpBlocked = props.otpExpired || props.otpLocked;
  useEffect(() => { if (remainingSeconds === 0 && !otpExpired) onOtpTimeout(); }, [remainingSeconds, otpExpired, onOtpTimeout]);
  const statusTitle = props.busy ? 'Verificando resultado…' : 'Estamos verificando si tu transferencia se completó';
  const headerTitle = props.screen === 'status' || props.screen === 'receipt' || props.screen === 'sending' ? 'Detalle' : 'Transferir';
  const headerBack = props.screen === 'review' || props.screen === 'otp' ? props.onBack : props.screen === 'status' ? props.onLeave : props.onDone;
  const headerBackLabel = props.screen === 'otp' ? 'Cancelar y volver a revisar' : props.screen === 'status' ? 'Ir al inicio' : props.screen === 'receipt' || props.screen === 'rejected' ? 'Volver al inicio' : 'Volver';
  const trackedAmount = props.transfer?.amountMinor ?? props.pendingPayload?.amountMinor;
  const trackedReference = props.transfer?.reference ?? props.pendingPayload?.reference;
  const recipient = props.transfer ? `${props.transfer.destination.name} •• ${lastDigits(props.transfer.destination.clabeMasked)}` : props.destination ? `${props.destination.name} •• ${lastDigits(props.destination.clabeMasked)}` : '—';
  return <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}><StatusBar barStyle="dark-content"/><ScreenHeader title={headerTitle} backLabel={headerBackLabel} onBack={headerBack} backDisabled={props.screen === 'sending'} backInactive={props.screen === 'otp' && props.busy} userInitials={props.userInitials} tone={headerTitle === 'Detalle' ? 'pale' : 'solid'}/><ScrollView contentContainerStyle={[styles.flowContent, styles.steppedContent]} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}>
    <DismissKeyboardArea>
    {props.screen === 'details' && <View style={styles.progressHeader}><View style={styles.progressLabels}><Text style={styles.progressActive}>PASO 1 DE 2</Text><Text style={styles.progressPercent}>50% completado</Text></View><Text style={styles.progressTitle}>Datos de la operación</Text><View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 2, now: 1 }} style={styles.progressTrack}><View style={styles.progressFill}/></View></View>}
    {props.screen === 'review' && <View style={styles.reviewProgress}><View style={styles.progressLabels}><Text style={styles.reviewStep}>Paso 2 de 2</Text><Text style={styles.reviewStepLabel}>Revisar transferencia</Text></View><View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 2, now: 2 }} style={[styles.progressTrack, styles.progressTrackHigh]}><View style={[styles.progressFill, styles.progressComplete]}/></View></View>}
    {props.screen === 'details' && <>
      <View style={styles.formSection}>
        <View style={styles.cardHeaderRow}><Text style={styles.cardLabel}>Cuenta de origen</Text><View style={[styles.metaStatus, styles.headerTrailing]}>{props.accounts.length > 1 ? <Pressable accessibilityRole="button" accessibilityLabel={props.originOpen ? 'Listo, cerrar las cuentas de origen' : 'Cambiar cuenta de origen'} accessibilityState={{ expanded: props.originOpen }} hitSlop={8} style={styles.changeOriginLink} onPress={() => props.setOriginOpen(!props.originOpen)}><Text style={styles.changeLinkText}>{props.originOpen ? 'Listo' : 'Cambiar cuenta'}</Text></Pressable> : null}<Text style={styles.debitBadge}>Débito</Text></View></View>
        <View style={styles.accountSummary}><View style={styles.originIcon}><Ionicons name="wallet-outline" size={20} color={colors.primary}/></View><View style={styles.summaryCopy}><Text numberOfLines={2} style={styles.originName}>{props.source ? `${props.source.name} •• ${lastDigits(props.source.clabeMasked)}` : 'Selecciona una cuenta'}</Text><Text style={styles.originBalance}>Saldo disponible: <Text style={styles.strongText}>{props.source ? `${formatMoney(props.source.availableBalanceMinor)} MXN` : '—'}</Text></Text></View></View>
        {props.originOpen && props.accounts.length > 1 ? <OriginAccountOptions accounts={props.accounts} selectedId={props.source?.id} destination={props.destination} onSelect={props.onSelectSource}/> : null}
      </View>
      <View style={styles.formSection}>
        <View style={styles.cardHeaderRow}><Text style={styles.cardLabel}>Beneficiario destino</Text><Pressable accessibilityRole="button" accessibilityLabel="Cambiar beneficiario" hitSlop={8} style={styles.changeLink} onPress={props.onChangeBeneficiary}><Text style={styles.changeLinkText}>Cambiar beneficiario</Text></Pressable></View>
        {props.destination ? <View style={styles.destinationBox}><View style={[styles.beneficiaryNameLine, styles.wrapLine]}><Text numberOfLines={2} style={styles.destinationName}>{props.destination.name}</Text><Text numberOfLines={1} style={styles.aliasBadgeMuted}>{props.destination.alias}</Text></View><View style={styles.metaStatus}><Ionicons name="checkmark-circle-outline" size={14} color={colors.success}/><Text style={styles.destinationAccount}>Billetera MXN •• {lastDigits(props.destination.clabeMasked)}</Text></View></View> : null}
        {props.sameAccount ? <View accessibilityRole="alert" style={styles.sameAccountBox}><Ionicons name="alert-circle-outline" size={18} color={colors.warning}/><Text style={styles.sameAccountText}>{SAME_ACCOUNT_MESSAGE}</Text></View> : null}
        <View style={styles.inlineNote}><Ionicons name="information-circle-outline" size={16} color={colors.muted}/><Text style={styles.inlineNoteText}>Los beneficiarios se registran y administran únicamente desde la web.</Text></View>
      </View>
      <View style={[styles.formSection, styles.formFields]}>
        <View><Text style={styles.fieldLabel}>Monto a transferir <Text style={styles.required}>*</Text></Text><View style={styles.amountInputWrap}><Text style={styles.amountPrefix}>$</Text><TextInput accessibilityLabel="Monto a transferir" keyboardType="decimal-pad" value={props.amount} onChangeText={props.setAmount} placeholder="0.00" placeholderTextColor={colors.placeholder} style={styles.amountInput}/><Text style={styles.currencyBadge}>MXN</Text></View><View style={styles.fieldHintRow}><Text style={styles.fieldHint}>Disponible: <Text style={styles.strongText}>{props.source ? `${formatMoney(props.source.availableBalanceMinor)} MXN` : '—'}</Text></Text>{props.policy ? <Text style={styles.fieldHint}>Límite diario: {formatMoney(props.policy.dailyLimitMinor, { currency: true })}</Text> : null}</View>{props.policy ? <Text style={[styles.fieldHint, styles.fieldHintTight]}>Disponible hoy: <Text style={styles.strongText}>{formatMoney(props.policy.dailyRemainingMinor, { currency: true })}</Text> · límites de demostración</Text> : null}</View>
        <View><View style={styles.fieldLabelRow}><Text style={styles.fieldLabel}>Concepto de pago <Text style={styles.required}>*</Text></Text><Text style={styles.fieldCounter}>{props.concept.length}/40</Text></View><TextInput accessibilityLabel="Concepto de pago" value={props.concept} onChangeText={props.setConcept} maxLength={40} placeholder="Ej. Pago servicio, renta" placeholderTextColor={colors.placeholder} style={styles.flowInput}/></View>
        <View><Text style={styles.fieldLabel}>Referencia numérica (hasta 7 dígitos) <Text style={styles.required}>*</Text></Text><View style={styles.referenceWrap}><TextInput accessibilityLabel="Referencia numérica (hasta 7 dígitos)" keyboardType="number-pad" value={props.reference} onChangeText={(value) => props.setReference(value.replace(/\D/g, '').slice(0, 7))} maxLength={7} placeholder="Ej. 1234567" placeholderTextColor={colors.placeholder} style={styles.referenceInput}/><MaterialIcons name="tag" size={18} color={colors.muted}/></View></View>
      </View>
      {insufficient && <Text accessibilityRole="alert" style={styles.errorText}>Saldo insuficiente para este importe.</Text>}
      {!insufficient && overDailyLimit && props.policy && <Text accessibilityRole="alert" style={styles.errorText}>El monto supera lo disponible hoy según el límite diario de demostración ({formatMoney(props.policy.dailyRemainingMinor, { currency: true })}).</Text>}
      {!insufficient && props.amount && !minor && <Text accessibilityRole="alert" style={styles.errorText}>Escribe un importe positivo con máximo dos decimales.</Text>}
    </>}
    {props.screen === 'review' && <>
      {/* F-15: the threshold variant adds a two-line pill; its hero and the gap above the actions are 8 + 12 px tighter so
          "Continuar a verificación" and "Modificar datos" both stay visible at 390x844, like the other variants. */}
      <View testID="review-hero" style={[styles.reviewHero, requiresOtp && thresholdLabel ? styles.reviewHeroCompact : null]}>
        <View style={styles.heroIcon}><Ionicons name="arrow-forward-circle-outline" size={24} color={colors.primary}/></View>
        <Text style={styles.reviewHeroLabel}>Monto a transferir</Text>
        <View style={styles.reviewAmountLine}><Text adjustsFontSizeToFit numberOfLines={1} style={styles.reviewAmount}>{minor ? formatMoney(minor) : '—'}</Text><Text style={styles.amountCurrency}>MXN</Text></View>
        {requiresOtp && thresholdLabel ? <View style={styles.thresholdPill}><Ionicons name="shield-checkmark-outline" size={14} color={colors.primary}/><Text style={styles.thresholdPillText}>{`Operación mayor o igual a ${thresholdLabel} requiere código de autorización (umbral de demostración)`}</Text></View> : null}
      </View>
      <View style={styles.reviewCard}>
        <View style={styles.reviewParty}>
          <View style={styles.reviewPartyIcon}><Ionicons name="wallet-outline" size={20} color={colors.muted}/></View>
          <View style={styles.summaryCopy}>
            <Text style={styles.reviewCaption}>CUENTA DE ORIGEN</Text>
            <Text numberOfLines={2} style={styles.reviewPartyName}>{props.source ? `${props.source.name} •• ${lastDigits(props.source.clabeMasked)}` : '—'}</Text>
            {props.source ? <Text style={styles.reviewPartySub}>Saldo disponible: <Text style={styles.mediumText}>{formatMoney(props.source.availableBalanceMinor)} MXN</Text></Text> : null}
          </View>
        </View>
        <View style={styles.reviewDirection}><View style={styles.reviewDirectionLine}/><Ionicons name="arrow-down" size={16} color={colors.primary}/><Text style={styles.reviewDirectionText}>TRANSFERENCIA INTERNA</Text><View style={styles.reviewDirectionLine}/></View>
        <View style={styles.reviewParty}>
          <View style={[styles.reviewPartyIcon, styles.reviewPartyIconDestination]}><Ionicons name="person-outline" size={20} color={colors.primary}/></View>
          <View style={styles.summaryCopy}>
            <Text style={styles.reviewCaption}>DESTINATARIO</Text>
            <Text numberOfLines={2} style={styles.reviewPartyName}>{props.destination ? `${props.destination.name} (${props.destination.alias}) •• ${lastDigits(props.destination.clabeMasked)}` : '—'}</Text>
            <Text style={styles.reviewPartySub}>Billetera MXN</Text>
          </View>
        </View>
        <View style={styles.reviewMeta}>
          <MetaRow label="Concepto" value={props.concept.trim()}/>
          <MetaRow label="Referencia numérica" value={props.reference}/>
          <View style={styles.metaRow}><Text style={styles.metaLabel}>Tipo de operación</Text><View style={[styles.metaStatus, styles.rowValue, styles.metaStatusValue]}><View style={styles.metaStatusDot}/><Text style={styles.metaStatusText}>Transferencia interna</Text></View></View>
        </View>
      </View>
      {props.sameAccount ? <View accessibilityRole="alert" style={styles.sameAccountBox}><Ionicons name="alert-circle-outline" size={18} color={colors.warning}/><Text style={styles.sameAccountText}>{SAME_ACCOUNT_MESSAGE}</Text></View> : null}
      {props.rejectedWarning ? <View accessibilityRole="alert" style={styles.sameAccountBox}><Ionicons name="alert-circle-outline" size={18} color={colors.warning}/><Text style={styles.sameAccountText}>Estos datos son iguales a los del intento rechazado ({props.rejectedWarning}). Cambia el monto o la cuenta antes de reintentar, o continúa si la situación ya cambió.</Text></View> : null}
      {/* D: the estimate is shown only for a valid combination with enough balance (BigInt minor units). */}
      {!props.sameAccount && minor && props.source && BigInt(props.source.availableBalanceMinor) >= BigInt(minor) ? <EstimatedBalance availableMinor={props.source.availableBalanceMinor} amountMinor={minor} compact={Boolean(requiresOtp && thresholdLabel)}/> : null}
      {props.error ? <Text accessibilityRole="alert" style={styles.errorText}>{props.error}</Text> : null}
      {/* F-13: compact as in Stitch (p-4 cards, caption-size captions) so both actions fit at the reference height. */}
      <View style={styles.actions}>
        <Button title={requiresOtp ? 'Continuar a verificación' : 'Confirmar transferencia'} trailingIcon="arrow-forward" loading={props.busy} disabled={props.busy || props.sameAccount} onPress={props.onCreate}/>
        <Pressable accessibilityRole="button" style={styles.modifyAction} onPress={props.onBack}><Text style={styles.modifyText}>Modificar datos</Text></Pressable>
      </View>
    </>}
    {props.screen === 'otp' && <>
      <View style={styles.otpContext}>
        <View style={styles.otpContextTop}><View style={styles.estimateLabel}><Ionicons name="shield-checkmark-outline" size={20} color={colors.primary}/><Text style={styles.otpContextLabel}>Confirmación de seguridad</Text></View><Text style={styles.otpContextBadge}>Monto extraordinario</Text></View>
        <View style={styles.otpContextBody}>
          <View style={styles.summaryCopy}><Text style={styles.reviewCaption}>DESTINATARIO</Text><Text numberOfLines={2} style={styles.otpContextName}>{recipient}</Text><Text style={styles.originBalance}>(Billetera MXN)</Text></View>
          <View style={styles.otpContextAmount}><Text style={styles.reviewCaption}>IMPORTE</Text><View testID="otp-amount-line" style={styles.otpAmountLine}><Text adjustsFontSizeToFit numberOfLines={1} style={styles.otpContextValue}>{props.transfer ? formatMoney(props.transfer.amountMinor) : '—'}</Text><Text style={styles.otpContextUnit}>MXN</Text></View></View>
        </View>
        <View style={styles.otpContextNote}><Ionicons name="information-circle-outline" size={16} color={colors.placeholder}/><Text style={[styles.estimateNoteText, styles.captionLeading]}>{thresholdLabel ? `Operación mayor o igual a ${thresholdLabel} (umbral de demostración)` : 'Operación sobre el umbral de verificación configurado (escenario ilustrativo de demostración)'}</Text></View>
      </View>
      <View style={styles.otpCard}>
        <View style={styles.otpBadge}><View style={styles.otpBadgeDot}/><Text style={styles.otpBadgeText}>CÓDIGO DE DEMOSTRACIÓN</Text></View>
        <Text style={styles.otpTitle}>Código de confirmación</Text>
        <Text style={styles.otpDescription}>Ingresa el código de demostración de 6 dígitos para autorizar el traspaso por <Text style={styles.strongText}>{props.transfer ? `${formatMoney(props.transfer.amountMinor)} MXN` : '—'}</Text> a {recipient}.</Text>
        {props.demoOnlyCode && !otpBlocked ? <View style={styles.demoCodeBox}><Ionicons name="information-circle-outline" size={16} color={colors.muted}/><Text style={styles.demoCodeLabel}>Código asignado para esta prueba: <Text style={styles.demoCodeValue}>{props.demoOnlyCode}</Text></Text></View> : null}
        {/* Round 7 · 4: six visual boxes over ONE hidden native input (accessible name, one-time-code autofill, paste of
            the 6 digits, delete, digits only). The boxes are decorative for assistive technologies. F-24: no maxLength —
            the control would cut a pasted "12 34-56" to "12 34-" BEFORE the digit filter; the filter keeps the first 6
            digits and the controlled value never exceeds 6. */}
        <View style={styles.otpDigits} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">{Array.from({ length: 6 }, (_, index) => <View key={index} style={[styles.otpDigit, index < props.otp.length && styles.otpDigitFilled, props.otpWrong && styles.otpDigitWrong, otpBlocked && styles.otpDigitExpired]}>{props.otp[index] ? <View style={styles.otpDot}/> : <View style={styles.otpDash}/>}</View>)}</View>
        <TextInput accessibilityLabel="Código de confirmación" accessibilityHint="Código de 6 dígitos" keyboardType="number-pad" inputMode="numeric" autoComplete="one-time-code" textContentType="oneTimeCode" editable={!otpBlocked && !props.verifying} value={props.otp} onChangeText={(value) => props.setOtp(value.replace(/\D/g, '').slice(0, 6))} style={styles.otpInput}/>
        {props.verifying ? <View accessibilityLiveRegion="polite" style={styles.otpVerifying}><ActivityIndicator size="small" color={colors.primary}/><Text style={styles.otpStateText}>Verificando código…</Text></View>
          : props.otpWrong && !otpBlocked ? <View accessibilityRole="alert" style={styles.otpWrongBanner}><Ionicons name="alert-circle-outline" size={20} color={colors.error}/><Text style={styles.otpWrongText}>Código incorrecto. Verifica los 6 dígitos e inténtalo de nuevo.{props.policy ? ` Tras ${props.policy.otpMaxAttempts} intentos fallidos tendrás que solicitar un código nuevo.` : ''}</Text></View>
            : !otpBlocked && props.otp.length > 0 && props.otp.length < 6 ? <Text accessibilityLiveRegion="polite" style={styles.otpStateText}>{6 - props.otp.length === 1 ? 'Falta 1 dígito' : `Faltan ${6 - props.otp.length} dígitos`}</Text>
              : !otpBlocked && props.otp.length === 6 ? <Text accessibilityLiveRegion="polite" style={styles.otpStateText}>Código completo. Ya puedes autorizar.</Text> : null}
        {otpBlocked ? <View style={styles.otpExpiredBlock}>
          <View accessibilityRole="alert" style={styles.otpExpiredBanner}><Ionicons name={props.otpLocked ? 'lock-closed-outline' : 'timer-outline'} size={20} color={colors.warning}/><Text style={styles.otpExpiredText}>{props.otpLocked ? 'Se agotaron los intentos para este código. Este intento no se autorizó y no movió dinero; solicita un código nuevo o vuelve a revisar.' : 'El código ha expirado. Por seguridad solicita uno nuevo para continuar.'}</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel="Solicitar un código nuevo" accessibilityHint="Cancela este intento y crea uno nuevo con otro código" accessibilityState={{ disabled: props.busy, busy: props.busy }} disabled={props.busy} onPress={props.onRequestNewCode} style={({ pressed }) => [styles.newCodeButton, (pressed || props.busy) && styles.buttonPressed]}>{props.busy ? <ActivityIndicator color={colors.primary}/> : <><Ionicons name="refresh" size={20} color={colors.primary}/><Text style={styles.newCodeButtonText}>Solicitar un código nuevo</Text></>}</Pressable>
        </View> : <View style={styles.otpStatus}>
          {remainingSeconds !== null ? <View accessibilityLiveRegion="polite" style={styles.countdown}><Ionicons name="time-outline" size={18} color={colors.muted}/><Text style={styles.countdownText}>El código expira en <Text style={styles.strongText}>{`${String(Math.floor(remainingSeconds / 60)).padStart(2, '0')}:${String(remainingSeconds % 60).padStart(2, '0')}`}</Text></Text></View> : null}
          {!props.confirmUncertain ? <Pressable accessibilityRole="button" accessibilityLabel="Solicitar un código nuevo" accessibilityHint="Cancela este intento y crea uno nuevo con otro código" disabled={props.busy} onPress={props.onRequestNewCode} style={styles.newCodeLink}><Ionicons name="refresh" size={18} color={props.busy ? colors.placeholder : 'rgba(0,55,176,0.8)'}/><Text style={[styles.newCodeText, props.busy && styles.newCodeTextDisabled]}>Solicitar un código nuevo</Text></Pressable> : null}
        </View>}
      </View>
      {!otpBlocked && !props.otpWrong && props.error ? <Text accessibilityRole="alert" style={styles.errorText}>{props.error}</Text> : null}
    </>}
    {props.screen === 'sending' && <>
      <View style={styles.statusSection}>
        <View style={styles.sendingRing}><View style={styles.sendingInner}><ActivityIndicator size="large" color={colors.primary}/></View></View>
        <View style={styles.sendingPill}><View style={styles.otpBadgeDot}/><Text style={styles.sendingPillText}>Envío en curso</Text></View>
        <Text style={styles.statusTitle}>Enviando transferencia…</Text>
        <Text style={styles.sendingMessage}>Enviando <Text style={styles.strongText}>{trackedAmount ? `${formatMoney(trackedAmount)} MXN` : '—'}</Text>{recipient !== '—' ? <> a <Text style={styles.strongText}>{recipient}</Text></> : null}. Por favor no cierres la aplicación.</Text>
      </View>
      <View style={styles.statusDetails}>
        <StatusRow label="Destinatario" value={props.destination?.name ?? '—'}/>
        <StatusRow label="Monto" value={trackedAmount ? `${formatMoney(trackedAmount)} MXN` : '—'}/>
        <StatusRow label="Referencia" value={trackedReference ?? '—'} mono/>
        <StatusRow label="Estado actual" value="Enviando" badge/>
      </View>
      <Button title="Procesando transferencia..." variant="muted" size="lg" leadingIcon="sync-outline" disabled onPress={() => undefined}/>
      <Text style={styles.sendingCaption}>Esta acción previene duplicados accidentales</Text>
    </>}
    {props.screen === 'closed' && props.transfer && (() => {
      const expired = props.transfer.status === 'expired';
      return <>
        <View style={styles.rejectedHero}>
          <View style={[styles.rejectedIcon, styles.closedIcon]}><Ionicons name={expired ? 'timer-outline' : 'close'} size={32} color={colors.primary}/></View>
          <Text style={styles.rejectedTitle}>{expired ? 'El código de esta operación expiró' : 'Operación cancelada'}</Text>
          <Text style={styles.rejectedReason}>{expired ? 'El intento se cerró sin autorizarse.' : 'Cancelaste este intento antes de autorizarlo.'}</Text>
        </View>
        <View style={styles.intactBox}><View style={styles.intactIcon}><Ionicons name="shield-checkmark-outline" size={18} color={colors.onSecondaryContainer}/></View><View style={styles.summaryCopy}><Text style={styles.intactTitle}>No se movió dinero</Text><Text style={styles.intactText}>Un intento {expired ? 'expirado' : 'cancelado'} no genera cargo ni abono.</Text></View></View>
        <View style={styles.rejectedCard}>
          <View style={styles.rejectedRow}><Text style={styles.rejectedLabel}>Destinatario</Text><Text numberOfLines={1} style={styles.rejectedAccount}>{props.transfer.destination.name}</Text></View>
          <View style={styles.rejectedRow}><Text style={styles.rejectedLabel}>Monto</Text><Text style={styles.rejectedValue}>{formatMoney(props.transfer.amountMinor)} MXN</Text></View>
          <View style={styles.rejectedRow}><Text style={styles.rejectedLabel}>Referencia</Text><Text style={styles.rejectedAccount}>{props.transfer.reference}</Text></View>
          <View style={styles.rejectedRow}><Text style={styles.rejectedLabel}>Estado actual</Text><Text style={styles.statusState}>{transferStatusLabel(props.transfer.status)}</Text></View>
        </View>
        <Button title="Volver al inicio" leadingIcon="home-outline" onPress={props.onDone}/>
      </>;
    })()}
    {props.screen === 'status' && <>
      <View style={styles.statusSection}>
        <View style={styles.statusIcon}>
          <View style={styles.statusIconInner}><Ionicons name={props.busy ? 'sync-outline' : 'cloud-offline-outline'} size={28} color={colors.muted}/></View>
          <View style={styles.statusIconBadge}><Ionicons name="hourglass-outline" size={16} color={colors.primary}/></View>
        </View>
        <View style={styles.statusPill}><Ionicons name="shield-checkmark-outline" size={15} color={colors.primary}/><Text style={styles.statusPillText}>Protección contra duplicados activa</Text></View>
      </View>
      <Text style={styles.statusTitle}>{statusTitle}</Text>
      <View style={styles.statusCard}>
        <Text style={styles.statusMessage}>{props.busy || !trackedAmount
          ? 'Estamos comprobando el estado del intento para evitar una operación duplicada.'
          : <>No pudimos confirmar el resultado de la operación de <Text style={styles.strongText}>{formatMoney(trackedAmount)} MXN</Text>{recipient !== '—' ? <> a <Text style={styles.strongText}>{recipient}</Text></> : null}. Para evitar cobros duplicados, consultamos el estado del intento original{trackedReference ? <> (Ref: <Text style={[styles.mediumText, styles.mono]}>{trackedReference}</Text>)</> : null}.</>}</Text>
        {props.error ? <Text accessibilityRole="alert" style={[styles.errorText, styles.statusError]}>{props.error}</Text> : null}
        <View style={styles.warningBox}><Ionicons name="information-circle-outline" size={20} color={colors.primary}/><View style={styles.summaryCopy}><Text style={styles.warningTitle}>No intentes enviar el dinero nuevamente</Text><Text style={styles.warningText}>Verificar el estado consulta el intento original con su misma clave, sin duplicar el cargo.</Text></View></View>
      </View>
      <View style={styles.statusDetails}>
        <StatusRow label="Destinatario" value={props.transfer?.destination.name ?? props.destination?.name ?? '—'}/>
        <StatusRow label="Monto en verificación" value={trackedAmount ? `${formatMoney(trackedAmount)} MXN` : '—'}/>
        <StatusRow label="Referencia de seguimiento" value={trackedReference ?? '—'} mono/>
        <StatusRow label="Estado actual" value={transferStatusLabel(props.transfer?.status)} badge/>
      </View>
      <View style={styles.actions}>
        <Button title="Verificar estado de la transferencia" size="lg" leadingIcon="sync-outline" loading={props.busy} disabled={props.busy || (!props.transfer && !props.createRetry)} onPress={props.transfer ? props.onCheck : props.onRetryCreate}/>
        <Button title="Ir al inicio (revisar saldo después)" size="lg" variant="surfaceLow" disabled={props.busy} onPress={props.onLeave}/>
      </View>
      <View style={styles.statusFooter}>
        {/* The real attempt id (when the API already answered) and the reference; no mock IDs. */}
        <Text selectable style={styles.statusFooterId}>{props.transfer ? `ID de operación: ${props.transfer.id} • ` : ''}Referencia: {trackedReference ?? '—'}</Text>
        <View style={styles.statusFooterBrand}><View style={styles.otpBadgeDot}/><Text style={styles.statusFooterText}>Billetera MXN • Validación interna de operación</Text></View>
      </View>
    </>}
    {props.screen === 'receipt' && props.transfer && (() => {
      const receipt = props.transfer;
      const origin = props.accounts.find((account) => account.id === receipt.sourceAccountId);
      const when = formatBusinessDateTime(receipt.completedAt ?? receipt.createdAt);
      const alias = 'alias' in receipt.destination ? receipt.destination.alias : undefined;
      return <>
        <View style={styles.receiptHero}>
          <View style={styles.receiptSuccessRing}><View style={styles.receiptSuccessIcon}><Ionicons name="checkmark" size={28} color={colors.white}/></View><View style={styles.receiptVerified}><Ionicons name="checkmark-circle-outline" size={16} color={colors.success}/></View></View>
          <Text style={styles.detailTitle}>Transferencia completada</Text>
          <View style={styles.receiptAmountLine}><Text adjustsFontSizeToFit numberOfLines={1} style={styles.receiptAmount}>{formatMoney(receipt.amountMinor, { sign: 'debit' })}</Text><Text style={styles.receiptCurrency}>MXN</Text></View>
          <View style={styles.receiptDatePill}><Ionicons name="time-outline" size={14} color={colors.muted}/><Text style={styles.receiptDateText}>{when ? `${when} (${BUSINESS_ZONE_LABEL})` : DATE_UNAVAILABLE}</Text></View>
        </View>
        <View style={styles.receiptCard}>
          <View style={styles.receiptCardHeader}><View style={styles.estimateLabel}><Ionicons name="receipt-outline" size={18} color={colors.muted}/><Text style={styles.receiptHeadingInline}>DETALLE DE OPERACIÓN</Text></View><View style={styles.appliedPill}><View style={styles.metaStatusDot}/><Text style={styles.appliedPillText}>Confirmada y aplicada</Text></View></View>
          <ReceiptRow label="Cuenta origen" value={origin?.name ?? '—'} detail={origin ? `•• ${lastDigits(origin.clabeMasked)}` : undefined}/>
          <ReceiptRow label="Para" value={receipt.destination.name} detail={alias} shaded/>
          <ReceiptRow label="Cuenta destino" value="Billetera MXN" detail={`•• ${lastDigits(receipt.destination.clabeMasked)}`}/>
          <ReceiptRow label="Concepto" value={receipt.concept} shaded/>
          <ReceiptRow label="Referencia" value={receipt.reference} strong/>
          <ReceiptRow label="Folio interno" value={receipt.receiptReference ?? receipt.id} shaded folio/>
          <ReceiptRow label="Tipo de operación" value="Transferencia interna"/>
          <ReceiptShareActions transfer={receipt} accounts={props.accounts}/>
        </View>
        {props.postBalance ? <View style={styles.newBalanceCard}>
          <View style={[styles.estimateLabel, styles.newBalanceHeader]}><Ionicons name="wallet-outline" size={20} color={colors.primary}/><Text style={styles.newBalanceLabel}>Nuevo saldo disponible en {props.postBalance.accountName}:</Text></View>
          <View style={[styles.reviewAmountLine, styles.amountLineStart]}><Text adjustsFontSizeToFit numberOfLines={1} style={styles.reviewAmount}>{formatMoney(props.postBalance.minor)}</Text><Text style={styles.newBalanceCurrency}>MXN</Text></View>
          <View style={styles.estimateNote}><Ionicons name="checkmark-circle-outline" size={16} color={colors.success}/><Text style={[styles.estimateNoteText, styles.captionLeading]}>Tu saldo se actualizó tras confirmarse la operación.</Text></View>
        </View> : null}
        <View style={styles.receiptActions}>
          <Button title="Ir al inicio" variant="strong" size="lg" leadingIcon="home-outline" onPress={props.onDone}/>
          <Button title="Ver últimos movimientos" variant="secondary" size="lg" leadingIcon="list-outline" onPress={props.onMovements}/>
        </View>
        <Text style={styles.detailFootnote}>Comprobante de demostración técnica interna de Billetera MXN</Text>
      </>;
    })()}
    {props.screen === 'rejected' && (() => {
      const requested = props.pendingPayload?.amountMinor ?? props.transfer?.amountMinor ?? minor;
      const rejectedSource = props.accounts.find((account) => account.id === (props.pendingPayload?.sourceAccountId ?? props.transfer?.sourceAccountId)) ?? props.source;
      const insufficientReason = /saldo insuficiente/i.test(props.error) && !props.rejectionUnverified;
      const limitReason = DAILY_LIMIT_PATTERN.test(props.error) && !props.rejectionUnverified;
      return <>
        <View style={styles.rejectedHero}>
          <View style={styles.rejectedIcon}><Ionicons name="close" size={32} color={colors.error}/></View>
          <Text style={styles.rejectedTitle}>No se pudo completar la transferencia</Text>
          <Text style={styles.rejectedReason}>{insufficientReason && requested ? <>El monto solicitado (<Text style={styles.rejectedReasonStrong}>{formatMoney(requested, { currency: true })}</Text>) supera el saldo disponible actual en tu cuenta.</>
            : limitReason && requested ? <>El monto solicitado (<Text style={styles.rejectedReasonStrong}>{formatMoney(requested, { currency: true })}</Text>) supera lo disponible hoy según el límite diario de demostración{props.policy ? <> (<Text style={styles.rejectedReasonStrong}>{formatMoney(props.policy.dailyRemainingMinor, { currency: true })}</Text> disponibles hoy)</> : null}.</>
              : props.error || 'La transferencia fue rechazada. No se completó el movimiento.'}</Text>
        </View>
        {props.rejectionUnverified
          ? <View style={styles.intactBox}><View style={[styles.intactIcon, styles.neutralIcon]}><Ionicons name="information-circle-outline" size={18} color={colors.primary}/></View><View style={styles.summaryCopy}><Text style={styles.intactTitle}>Revisa tu saldo antes de reintentar</Text><Text style={styles.intactText}>No pudimos confirmar el efecto de este intento en tu cuenta. Consulta tus movimientos antes de volver a enviar.</Text></View></View>
          : <View style={styles.intactBox}><View style={styles.intactIcon}><Ionicons name="shield-checkmark-outline" size={18} color={colors.onSecondaryContainer}/></View><View style={styles.summaryCopy}><Text style={styles.intactTitle}>Tu dinero está intacto</Text><Text style={styles.intactText}>No se aplicó ningún cargo a tu cuenta por este intento.</Text></View></View>}
        <View style={styles.rejectedCard}>
          <View style={styles.rejectedRow}><Text style={styles.rejectedLabel}>Cuenta de origen</Text><View style={[styles.metaStatus, styles.shrinkRow]}><Ionicons name="card-outline" size={16} color={colors.muted}/><Text numberOfLines={1} style={styles.rejectedAccount}>{rejectedSource ? `${accountTabLabel(rejectedSource.name)} •• ${lastDigits(rejectedSource.clabeMasked)}` : '—'}</Text></View></View>
          <View style={styles.rejectedRow}><Text style={styles.rejectedLabel}>Saldo disponible</Text><Text style={styles.rejectedValue}>{rejectedSource ? `${formatMoney(rejectedSource.availableBalanceMinor)} MXN` : '—'}</Text></View>
          {limitReason && props.policy ? <View style={styles.rejectedRow}><Text style={styles.rejectedLabel}>Disponible hoy (límite diario)</Text><Text style={styles.rejectedValue}>{`${formatMoney(props.policy.dailyRemainingMinor)} MXN`}</Text></View> : null}
          <View style={styles.rejectedRow}><Text style={styles.rejectedLabel}>Monto solicitado</Text><Text style={[styles.rejectedValue, styles.rejectedRequested]}>{requested ? `${formatMoney(requested)} MXN` : '—'}</Text></View>
          {props.rejectionUnverified ? null : <View style={styles.debitedBox}><View style={styles.summaryCopy}><Text style={styles.debitedTitle}>Importe debitado</Text><Text style={styles.debitedNote}>Ningún dinero fue retirado</Text></View><Text style={styles.debitedValue}>$0.00 MXN</Text></View>}
        </View>
        <View style={styles.actions}>
          <Button title="Modificar monto o cuenta" leadingIcon="pencil" onPress={props.onEdit}/>
          <Button title="Volver al inicio" variant="secondary" leadingIcon="home-outline" onPress={props.onDone}/>
        </View>
      </>;
    })()}
  </DismissKeyboardArea></ScrollView>{props.screen === 'details' && <View style={styles.stickyFooter}><Button title="Continuar" size="lg" trailingIcon="arrow-forward" disabled={!formValid || insufficient || overDailyLimit || !props.source || !props.destination || props.sameAccount} onPress={props.onReview}/></View>}
    {/* I: like the M08 reference, the actions stay anchored above the keyboard instead of scrolling under it. */}
    {props.screen === 'otp' && <View style={styles.stickyFooter}>
      <Button title="Autorizar transferencia" leadingIcon={/^\d{6}$/.test(props.otp) ? 'lock-closed-outline' : 'lock-open-outline'} loading={props.verifying} disabled={props.busy || otpBlocked || !/^\d{6}$/.test(props.otp)} onPress={props.onConfirm}/>
      {props.confirmRetry && !otpBlocked && <Button title="Reintentar envío del mismo código" variant="secondary" loading={props.busy} disabled={props.busy} onPress={props.onRetryConfirm}/>}
      {/* F-12: no exit while the confirm is in flight; the screen only changes once its outcome is known. */}
      <Button title="Cancelar y volver a revisar" variant="surface" leadingIcon="arrow-back" iconSize={18} disabled={props.busy} onPress={props.onBack}/>
    </View>}</KeyboardAvoidingView>;
}

// M10 "Opciones de comprobante (opcional)": real share sheet actions over the confirmed transfer (src/receiptShare.ts).
// Only a completed transfer yields a document; otherwise nothing is offered.
function ReceiptShareActions({ transfer, accounts }: { transfer: Transfer; accounts: Account[] }) {
  const doc = useMemo(() => receiptFromTransfer(transfer, accounts), [transfer, accounts]);
  const { busy, error, run } = useReceiptShare(doc);
  if (!doc) return null;
  return <View style={styles.receiptShare}>
    <Text style={styles.receiptShareCaption}>Opciones de comprobante (opcional)</Text>
    <View style={styles.receiptShareRow}>
      <Button title={RECEIPT_ACTION_LABELS.text} variant="secondary" leadingIcon="share-outline" iconSize={18} loading={busy === 'text'} disabled={busy !== null} onPress={() => void run('text')} style={styles.receiptShareButton}/>
      <Button title={RECEIPT_ACTION_LABELS.pdf} variant="secondary" leadingIcon={Platform.OS === 'ios' ? 'download-outline' : 'document-outline'} iconSize={18} loading={busy === 'pdf'} disabled={busy !== null} onPress={() => void run('pdf')} style={styles.receiptShareButton}/>
    </View>
    {busy ? <Text accessibilityLiveRegion="polite" style={styles.receiptShareStatus}>{RECEIPT_BUSY_LABELS[busy]}</Text> : null}
    {error ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.receiptShareError}>{error}</Text> : null}
  </View>;
}

// M04. Built from the movement itself (amount, concept, reference, counterparty, time) so a RECEIVED transfer from
// another user, whose GET /transfers/{id} is sender-only, still shows who sent it. A sent movement is enriched with
// the transfer (source account, status, receipt folio) when that read succeeded.
function MovementReceipt({ movement, transfer, accounts, accountId, userInitials, onBack, onHome }: { movement: Movement; transfer: Transfer | null; accounts: Account[]; accountId: string | undefined; userInitials: string; onBack: () => void; onHome: () => void }) {
  const status = transfer?.status ?? movement.status;
  const completed = status === 'completed';
  const rejected = status === 'rejected';
  const credit = movement.type === 'credit';
  const own = accounts.find((account) => account.id === (credit ? accountId : transfer?.sourceAccountId ?? accountId));
  const counterparty = movement.counterparty;
  const counterpartyName = counterparty?.name ?? transfer?.destination.name;
  const counterpartyDigits = lastDigits(counterparty?.clabeMasked ?? transfer?.destination.clabeMasked ?? '');
  const ownTransfer = Boolean(counterparty?.ownAccountId);
  const when = formatBusinessDateTime(transfer?.completedAt ?? movement.occurredAt);
  const title = !completed ? (rejected ? 'Transferencia rechazada' : 'Transferencia en proceso') : credit ? 'Transferencia recibida' : 'Transferencia enviada';
  const pill = !completed ? (rejected ? 'Rechazada' : 'En proceso') : credit ? 'Recibida' : 'Enviada';
  const party = counterpartyName ? <View style={styles.detailDestination}><Ionicons name="person-circle-outline" size={16} color={colors.primary}/><Text style={styles.detailStackedValue}>{counterpartyName}{counterpartyDigits ? ` •• ${counterpartyDigits}` : ''}</Text></View> : <Text style={styles.detailStackedValue}>—</Text>;
  const ownLine = own ? <Text style={styles.detailStackedValue}>{own.name} •• {lastDigits(own.clabeMasked)}</Text> : null;
  const folio = transfer?.receiptReference ?? movement.transferId ?? movement.id;
  return <View style={styles.page}><StatusBar barStyle="dark-content"/>
    <ScreenHeader title="Detalle" backLabel="Volver a movimientos" onBack={onBack} userInitials={userInitials} tone="pale"/>
    <ScrollView contentContainerStyle={styles.detailContent}>
      <View style={styles.detailHero}>
        <View style={[styles.detailStatusIcon, !completed && styles.detailStatusIconPending, rejected && styles.detailStatusIconRejected]}><Ionicons name={completed ? 'checkmark-circle' : rejected ? 'close-circle' : 'time'} size={36} color={completed ? colors.success : rejected ? colors.error : colors.primary}/>{completed ? <View style={styles.detailLiveDot}/> : null}</View>
        <View style={styles.detailPill}><View style={[styles.detailPillDot, !completed && { backgroundColor: rejected ? colors.error : colors.primary }]}/><Text style={styles.detailPillText}>{pill}</Text></View>
        <Text style={styles.detailTitle}>{title}</Text>
        <View testID="detail-amount-line" style={styles.detailAmountLine}><Text adjustsFontSizeToFit numberOfLines={1} style={[styles.detailAmount, credit && styles.creditAmount]}>{formatMoney(movement.amountMinor, { sign: credit ? 'credit' : 'debit' })}</Text><Text style={styles.detailCurrency}>MXN</Text></View>
        <Text style={styles.detailDate}>{when ?? DATE_UNAVAILABLE}</Text>
        {when ? <Text style={styles.detailZone}>({BUSINESS_ZONE_LABEL})</Text> : null}
      </View>
      <View style={styles.detailCard}>
        <Text style={styles.receiptHeading}>DETALLES DE LA TRANSACCIÓN</Text>
        {credit ? <>
          <View style={styles.detailStacked}><Text style={styles.detailLabel}>De</Text>{party}</View>
          {ownLine ? <View style={styles.detailStacked}><Text style={styles.detailLabel}>Cuenta destino</Text>{ownLine}</View> : null}
        </> : <>
          {ownLine ? <View style={styles.detailStacked}><Text style={styles.detailLabel}>Cuenta origen</Text>{ownLine}</View> : null}
          <View style={styles.detailStacked}><Text style={styles.detailLabel}>Para</Text>{party}</View>
        </>}
        <DetailRow label="Concepto" value={movement.concept}/>
        <DetailRow label="Referencia" value={movement.reference} emphasis/>
        <View style={styles.detailRow}><Text style={styles.detailLabel}>Folio interno</Text><FolioText value={folio} style={[styles.folioValue, styles.rowValue, styles.detailRowAccent]}/></View>
        <DetailRow label="Tipo de operación" value={ownTransfer ? 'Entre cuentas propias' : 'Transferencia interna'} small/>
      </View>
      <Text style={styles.detailFootnote}>Comprobante de demostración técnica interna de Billetera MXN</Text>
      <View style={styles.detailActions}>
        <Button title="Volver a movimientos" variant="strong" size="lg" leadingIcon="arrow-back" onPress={onBack}/>
        <Button title="Ir al inicio" variant="secondaryHigh" leadingIcon="home-outline" iconSize={18} onPress={onHome}/>
      </View>
    </ScrollView>
  </View>;
}

// Folio = the real transfer id (UUID), never shortened or replaced by a mock value. Full value, wraps at its hyphens,
// selectable (long-press copy on device) and read in full by screen readers.
function FolioText({ value, style }: { value: string; style: StyleProp<TextStyle> }) {
  return <Text selectable accessibilityLabel={`Folio ${value}`} testID="folio-value" style={style}>{value}</Text>;
}

function ReceiptRow({ label, value, detail, shaded = false, strong = false, folio = false }: { label: string; value: string; detail?: string; shaded?: boolean; strong?: boolean; folio?: boolean }) {
  return <View style={[styles.receiptRow, shaded && styles.receiptRowShaded]}><Text style={styles.receiptLabel}>{label}</Text><View style={styles.receiptRowValue}>{folio ? <FolioText value={value} style={styles.folioValue}/> : <Text style={[styles.receiptValue, strong && styles.receiptValueStrong]}>{value}</Text>}{detail ? <Text style={styles.receiptDetail}>{detail}</Text> : null}</View></View>;
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return <View style={styles.metaRow}><Text style={styles.metaLabel}>{label}</Text><Text numberOfLines={1} style={styles.metaValue}>{value}</Text></View>;
}

// M09/M11-closed detail rows (label-sm): long names ellipsize, the label keeps its width.
function StatusRow({ label, value, mono = false, badge = false }: { label: string; value: string; mono?: boolean; badge?: boolean }) {
  return <View style={styles.statusRow}><Text style={styles.statusRowLabel}>{label}</Text>{badge ? <Text numberOfLines={1} style={styles.statusState}>{value}</Text> : <Text numberOfLines={1} style={[styles.statusRowValue, mono && styles.mono]}>{value}</Text>}</View>;
}

function EstimatedBalance({ availableMinor, amountMinor, compact = false }: { availableMinor: string; amountMinor: string; compact?: boolean }) {
  const available = BigInt(availableMinor);
  const amount = BigInt(amountMinor);
  const after = available - amount;
  // Integer basis points keep the money arithmetic in BigInt; only the bar width becomes a number.
  const remainingBasisPoints = available > 0n ? Number((after * 10_000n) / available) : 0;
  return <View testID="estimate-card" style={[styles.estimateCard, compact && styles.estimateCardCompact]}>
    <View style={styles.estimateHeader}>
      <View style={styles.estimateLabel}><Ionicons name="calculator-outline" size={18} color={colors.primary}/><Text style={styles.estimateLabelText}>Saldo posterior estimado</Text></View>
      <Text adjustsFontSizeToFit numberOfLines={1} style={styles.estimateValue}>{formatMoney(after.toString())} MXN</Text>
    </View>
    <View style={styles.estimateMath}><Text style={styles.estimateMathText}>Cálculo:</Text><Text adjustsFontSizeToFit numberOfLines={1} style={[styles.estimateMathText, styles.estimateMathValue]}>{formatMoney(availableMinor)} - {formatMoney(amountMinor)} = {formatMoney(after.toString())} MXN</Text></View>
    {/* Round 7 · 3: the bar is the same real computation as the text above (Stitch: 93.17 % / 6.83 % = $11,600 / $850 of
        $12,450): blue = balance left after this transfer, neutral = share of the current balance this transfer uses. It is
        not a limit or a risk level, so the used share is neutral grey instead of the reference's salmon (red reads as an
        alarm). The text already states every figure, so the bar is decorative for assistive technologies. */}
    <View testID="estimate-bar" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.estimateTrack}><View style={[styles.estimateRemaining, { width: `${remainingBasisPoints / 100}%` }]}/><View style={styles.estimateSpent}/></View>
    <View style={styles.estimateNote}><Ionicons name="information-circle-outline" size={15} color={colors.muted}/><Text style={styles.estimateNoteText}>El envío aún no está confirmado. El saldo final se actualizará en tu cuenta una vez procesada la operación por el sistema.</Text></View>
  </View>;
}

function DetailRow({ label, value, emphasis = false, small = false }: { label: string; value: string; emphasis?: boolean; small?: boolean }) {
  return <View style={styles.detailRow}><Text style={styles.detailLabel}>{label}</Text><Text style={[styles.detailRowValue, emphasis && styles.detailRowEmphasis, small && styles.detailRowSmall]}>{value}</Text></View>;
}

function ScreenHeader({ title, backLabel, onBack, userInitials, tone = 'solid', backDisabled = false, backInactive = false }: { title: string; backLabel: string; onBack: () => void; userInitials: string; tone?: 'pale' | 'solid'; backDisabled?: boolean; backInactive?: boolean }) {
  return <View style={styles.screenHeader}>
    {backDisabled ? <View style={styles.headerBack}/> : <Pressable accessibilityRole="button" accessibilityLabel={backLabel} accessibilityState={{ disabled: backInactive }} disabled={backInactive} hitSlop={8} style={styles.headerBack} onPress={onBack}><Ionicons name="arrow-back" size={24} color={backInactive ? colors.placeholder : colors.text}/></Pressable>}
    <Text numberOfLines={1} style={styles.headerTitle}>{title}</Text>
    <View style={styles.flowHeaderSpacer}/>
    <View style={[styles.headerAvatar, tone === 'solid' && styles.headerAvatarSolid]}><Text style={[styles.headerAvatarText, tone === 'solid' && styles.headerAvatarSolidText]}>{userInitials}</Text></View>
  </View>;
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

function PrivacyScreen() {
  return <View style={styles.privacyPage}>
    <View style={styles.privacyTopbar}><View style={styles.privacyBrandMark}><Ionicons name="wallet-outline" size={18} color={colors.white}/></View><Text style={styles.headerTitle}>Billetera MXN</Text><View style={styles.flowHeaderSpacer}/><Ionicons name="shield-outline" size={20} color={colors.placeholder}/></View>
    <View style={styles.privacy}>
      <View style={styles.privacyCenter}><View style={styles.privacyCard}>
        <View style={styles.privacyIcon}><View style={styles.privacyIconInner}><Ionicons name="wallet-outline" size={32} color={colors.primary}/></View><View style={styles.privacyShield}><Ionicons name="shield-outline" size={18} color={colors.primary}/></View></View>
        <Text style={styles.privacyTitle}>Billetera MXN</Text>
        <View style={styles.privacyPill}><Ionicons name="eye-off-outline" size={15} color={colors.primary}/><Text style={styles.privacyPillText}>Contenido oculto por privacidad</Text></View>
        <Text style={styles.privacyCopy}>La información confidencial y los saldos están ocultos mientras la aplicación está en segundo plano.</Text>
      </View></View>
      <View style={styles.privacyNote}><View style={styles.privacyNoteIcon}><Ionicons name="layers-outline" size={22} color={colors.primary}/></View><View style={styles.summaryCopy}><Text style={styles.privacyNoteTitle}>Privacidad en segundo plano</Text><Text style={styles.privacyNoteText}>Esta vista protege tus saldos y datos de cuenta en el selector de aplicaciones de tu dispositivo móvil.</Text></View></View>
    </View>
  </View>;
}
// I: a tap on empty space closes the keyboard. A responder View (not a Pressable) so inner buttons and inputs keep
// their own touches and the ScrollView can still take over a drag.
function DismissKeyboardArea({ children }: { children: React.ReactNode }) {
  return <View testID="dismiss-keyboard" style={styles.dismissArea} onStartShouldSetResponder={() => true} onResponderRelease={() => Keyboard.dismiss()}>{children}</View>;
}
function Centered({ children }: { children: React.ReactNode }) { return <View style={styles.centered}>{children}</View>; }
type IconName = React.ComponentProps<typeof Ionicons>['name'];
type ButtonVariant = 'primary' | 'secondary' | 'secondaryHigh' | 'surface' | 'surfaceLow' | 'strong' | 'muted';
// Stitch buttons: h-12 (48), rounded-xl (12); label-md 14 semibold by default, headline-sm 16 where the reference uses it.
function Button({ title, onPress, disabled, loading = false, variant = 'primary', size = 'md', leadingIcon, trailingIcon, iconSize = 20, style }: { title: string; onPress: () => void; disabled?: boolean; loading?: boolean; variant?: ButtonVariant; size?: 'md' | 'lg'; leadingIcon?: IconName; trailingIcon?: IconName; iconSize?: number; style?: StyleProp<ViewStyle> }) {
  const tint = variant === 'secondary' || variant === 'secondaryHigh' ? colors.primary : variant === 'surface' || variant === 'surfaceLow' ? colors.text : variant === 'muted' ? 'rgba(67,70,85,0.6)' : colors.white;
  const iconTint = variant === 'surface' ? colors.muted : tint;
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled, busy: loading }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.button, variant === 'secondary' && styles.buttonSecondary, variant === 'secondaryHigh' && styles.buttonSecondaryHigh, variant === 'surface' && styles.buttonSurface, variant === 'surfaceLow' && styles.buttonSurfaceLow, variant === 'strong' && styles.buttonStrong, variant === 'muted' && styles.buttonMuted, (pressed || disabled) && styles.buttonPressed, disabled && (variant === 'primary' || variant === 'strong') && styles.buttonDisabled, style]}>{loading ? <ActivityIndicator color={tint} accessibilityLabel={title} /> : <View style={styles.buttonContent}>{leadingIcon ? <Ionicons name={leadingIcon} size={iconSize} color={iconTint}/> : null}<Text style={[styles.buttonText, size === 'lg' && styles.buttonTextLarge, (variant === 'secondary' || variant === 'secondaryHigh') && styles.buttonTextSecondary, variant === 'surface' && styles.buttonTextSurface, variant === 'surfaceLow' && styles.buttonTextDark, variant === 'muted' && styles.buttonTextMuted]}>{title}</Text>{trailingIcon ? <Ionicons name={trailingIcon} size={iconSize} color={iconTint}/> : null}</View>}</Pressable>;
}

function initials(name: string) { return name.split(/\s+/).slice(0, 2).map((part) => part[0] ?? '').join('').toUpperCase(); }

const colors = { surfaceHighest: '#dbe2f9', onPrimaryFixed: '#001551', tertiaryContainer: '#b22217', onSecondaryFixedVariant: '#00522f', onSecondaryContainer: '#007345', bg: '#f9f9ff', white: '#ffffff', primaryFixed: '#dce1ff', paleHigh: '#e0e8ff', primaryContainer: '#1d4ed8', errorPale: '#ffdad6', text: '#141b2c', muted: '#434655', placeholder: '#747686', primary: '#0037b0', pale: '#e9edff', input: '#f1f3ff', border: '#c4c5d7', error: '#ba1a1a', success: '#006d40', successPale: '#98f6bb', pending: '#8f0001', pendingPale: '#ffdad5', pendingDim: '#ffb4a8', warning: '#b54708' };
// Stitch uses font-mono for balances in M03 and operation IDs in M09.
const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, Menlo, monospace' });
const cardShadow = { shadowColor: '#141b2c', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 } as const;
const baseStyles = StyleSheet.create({
  flowContent: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 48, maxWidth: 600, width: '100%', alignSelf: 'center', flexGrow: 1 }, backButton: { minHeight: 48, minWidth: 48, flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }, flowHeaderSpacer: { flex: 1 }, flowTitle: { color: colors.text, fontSize: 30, lineHeight: 38, fontWeight: '700', marginTop: 12, marginBottom: 24, letterSpacing: -0.5 }, flowCard: { backgroundColor: colors.white, borderRadius: 20, borderWidth: 1, borderColor: colors.border, padding: 20, marginBottom: 16, gap: 12 }, flowInput: { minHeight: 48, borderRadius: 12, paddingHorizontal: 12, backgroundColor: colors.bg, color: colors.text, fontSize: 14 }, flowAmount: { color: colors.text, fontSize: 36, lineHeight: 44, fontWeight: '700', marginTop: 6, marginBottom: 12, fontVariant: ['tabular-nums'], letterSpacing: -0.7 }, receiptHeading: { color: colors.muted, fontSize: 12, lineHeight: 16, fontWeight: '500', letterSpacing: 0.6, paddingBottom: 8 }, successIcon: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center', marginBottom: 12, borderWidth: 10, borderColor: colors.successPale }, movementStateIcon: { backgroundColor: colors.primary, borderColor: colors.pale }, successPill: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: colors.pale, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 7, marginBottom: 12 }, successDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success }, successPillText: { color: colors.muted, fontSize: 14, fontWeight: '600' }, demoCode: { color: colors.primary, fontWeight: '700', fontSize: 16, marginVertical: 8 },
  progressHeader: { marginBottom: 12 }, progressPercent: { color: colors.muted, fontSize: 12, lineHeight: 16, fontWeight: '500', letterSpacing: 0.2 }, progressTitle: { color: colors.text, fontSize: 16, lineHeight: 24, fontWeight: '600', marginBottom: 4 }, steppedContent: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 24 }, formSection: { backgroundColor: colors.white, borderRadius: 12, padding: 16, marginBottom: 12, ...cardShadow }, formFields: { gap: 16 }, cardHeaderRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: 8, marginBottom: 8 }, headerTrailing: { marginLeft: 'auto', flexShrink: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }, cardLabel: { flexShrink: 1, color: colors.muted, fontSize: 12, lineHeight: 16, fontWeight: '500' }, debitBadge: { overflow: 'hidden', borderRadius: 4, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: colors.pale, color: colors.muted, fontSize: 12, lineHeight: 16, fontWeight: '500' }, originIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primaryFixed, alignItems: 'center', justifyContent: 'center' }, originName: { color: colors.text, fontSize: 16, lineHeight: 24, fontWeight: '600' }, originBalance: { color: colors.muted, fontSize: 12, lineHeight: 16 }, strongText: { color: colors.text, fontWeight: '600' }, changeLink: { minHeight: 44, justifyContent: 'center', marginLeft: 'auto', flexShrink: 1 }, changeLinkText: { color: colors.primaryContainer, fontSize: 12, lineHeight: 16, fontWeight: '600', textAlign: 'right' }, destinationBox: { backgroundColor: colors.bg, borderRadius: 8, padding: 8, marginBottom: 8 }, destinationName: { flexShrink: 1, color: colors.text, fontSize: 16, lineHeight: 24, fontWeight: '600' }, aliasBadgeMuted: { flexShrink: 0, maxWidth: '45%', overflow: 'hidden', borderRadius: 4, paddingHorizontal: 6, backgroundColor: colors.pale, color: colors.muted, fontSize: 12, lineHeight: 16, fontWeight: '500' }, destinationAccount: { color: colors.muted, fontSize: 12, lineHeight: 16, marginTop: 2 }, inlineNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, backgroundColor: colors.input, borderRadius: 8, padding: 8 }, inlineNoteText: { flex: 1, color: colors.muted, fontSize: 12, lineHeight: 17, letterSpacing: 0.2 }, fieldLabel: { color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '600', marginBottom: 6 }, fieldLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, fieldCounter: { color: colors.muted, fontSize: 12, lineHeight: 16, fontWeight: '500', marginBottom: 6 }, required: { color: colors.pending }, fieldHint: { color: colors.muted, fontSize: 12, lineHeight: 16, letterSpacing: 0.2, marginTop: 6, paddingHorizontal: 4 }, fieldHintTight: { marginTop: 2 }, fieldHintRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: 8 }, thresholdPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.paleHigh, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4, marginTop: 4 }, thresholdPillText: { flexShrink: 1, color: colors.primary, fontSize: 12, lineHeight: 16, fontWeight: '500', textAlign: 'center' }, countdown: { flexDirection: 'row', alignItems: 'center', gap: 6 }, countdownText: { color: colors.muted, fontSize: 14, lineHeight: 20, fontWeight: '500', fontVariant: ['tabular-nums'] }, newCodeLink: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12 }, newCodeText: { color: 'rgba(0,55,176,0.8)', fontSize: 14, lineHeight: 20, fontWeight: '500' }, newCodeTextDisabled: { color: colors.placeholder }, currencyBadge: { overflow: 'hidden', borderRadius: 4, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: colors.pale, color: colors.muted, fontSize: 14, lineHeight: 20, fontWeight: '600' }, referenceWrap: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, paddingHorizontal: 12, backgroundColor: colors.bg }, referenceInput: { flex: 1, minWidth: 0, minHeight: 48, color: colors.text, fontSize: 14, letterSpacing: 0.5, fontVariant: ['tabular-nums'] }, stickyFooter: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16, gap: 8, backgroundColor: colors.bg }, progressLabels: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, gap: 10 }, progressActive: { color: colors.primary, fontSize: 12, lineHeight: 16, fontWeight: '600', letterSpacing: 0.3 }, progressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.pale, overflow: 'hidden' }, progressFill: { height: 6, width: '50%', backgroundColor: colors.primaryContainer, borderRadius: 3 }, progressComplete: { width: '100%' }, accountSummary: { flexDirection: 'row', alignItems: 'center', gap: 12 }, summaryCopy: { flex: 1 }, amountInputWrap: { minHeight: 60, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bg }, amountPrefix: { fontSize: 28, lineHeight: 36, color: colors.text, fontWeight: '600' }, amountInput: { flex: 1, minWidth: 0, color: colors.text, fontSize: 36, lineHeight: 44, fontWeight: '700', fontVariant: ['tabular-nums'], paddingHorizontal: 6 }, amountCurrency: { color: colors.muted, fontSize: 14, lineHeight: 20, fontWeight: '600' }, fieldMeta: { color: colors.muted, fontSize: 12, textAlign: 'right', marginTop: -8, marginBottom: 12 }, amountHero: { alignItems: 'center', padding: 20, backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.border, marginBottom: 14 }, heroIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.input, marginBottom: 4 }, internalBadge: { color: colors.success, backgroundColor: colors.successPale, overflow: 'hidden', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, fontSize: 13, fontWeight: '600' }, summaryRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14 }, summaryValue: { color: colors.text, fontSize: 15, fontWeight: '600', textAlign: 'right', flexShrink: 1 }, summaryDetail: { color: colors.muted, fontSize: 12, marginTop: 3 }, flowDivider: { height: 1, backgroundColor: colors.input, marginVertical: 3 }, modifyAction: { minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, otpIntro: { alignItems: 'center', backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 20, marginBottom: 16 }, otpBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.input, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 12, marginBottom: 12 }, otpBadgeText: { color: colors.primary, fontSize: 12, lineHeight: 16, fontWeight: '600', letterSpacing: 0.3 }, otpDigits: { width: '100%', flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 20, marginBottom: 16 }, otpDigit: { width: 44, height: 52, borderRadius: 8, backgroundColor: colors.input, alignItems: 'center', justifyContent: 'center' }, otpDigitFilled: { backgroundColor: colors.paleHigh }, otpDigitText: { color: colors.primary, fontSize: 22, fontWeight: '600' }, otpInput: { width: '100%', height: 52, marginTop: -68, marginBottom: 16, color: 'transparent', opacity: 0.02 }, statusIcon: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paleHigh, marginBottom: 12, ...cardShadow }, statusIconInner: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceHighest }, statusIconBadge: { position: 'absolute', right: -4, bottom: -4, width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white, ...cardShadow }, statusTitle: { color: colors.text, fontSize: 20, lineHeight: 28, fontWeight: '600', textAlign: 'center', letterSpacing: -0.5, marginBottom: 8, paddingHorizontal: 4 }, statusCard: { backgroundColor: colors.white, borderRadius: 12, padding: 12, marginBottom: 16, ...cardShadow }, statusDetails: { backgroundColor: colors.white, borderRadius: 12, padding: 12, marginBottom: 24, ...cardShadow }, statusState: { overflow: 'hidden', borderRadius: 4, paddingHorizontal: 4, paddingVertical: 2, backgroundColor: colors.paleHigh, color: colors.muted, fontSize: 12, lineHeight: 16, fontWeight: '600' }, statusPill: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, alignSelf: 'center', backgroundColor: colors.paleHigh, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, marginBottom: 4 }, statusPillText: { color: colors.muted, fontSize: 12, lineHeight: 16, fontWeight: '500' }, statusMessage: { color: colors.muted, fontSize: 14, lineHeight: 22, marginBottom: 12 }, warningText: { color: colors.muted, fontSize: 14, lineHeight: 20, marginTop: 2 }, warningBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: colors.input, borderRadius: 8, padding: 8 }, resultHero: { alignItems: 'center', gap: 14, paddingVertical: 22 }, rejectedIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(255,218,214,0.6)', alignItems: 'center', justifyContent: 'center', marginBottom: 12, ...cardShadow }, rejectedHero: { alignItems: 'center', marginTop: 8, marginBottom: 24 }, rejectedReason: { color: colors.muted, fontSize: 14, lineHeight: 20, textAlign: 'center', maxWidth: 320 }, intactBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: colors.input, borderRadius: 12, padding: 12, marginBottom: 16, ...cardShadow }, intactIcon: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.successPale, marginTop: 2 }, neutralIcon: { backgroundColor: colors.pale }, closedIcon: { backgroundColor: colors.paleHigh }, rejectedLabel: { flexShrink: 0, color: colors.muted, fontSize: 14, lineHeight: 20 }, rejectedValue: { flexGrow: 1, flexShrink: 1, flexBasis: 0, color: colors.text, fontSize: 16, lineHeight: 24, fontWeight: '600', textAlign: 'right', fontVariant: ['tabular-nums'] }, rejectedRequested: { color: colors.error }, debitedBox: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.input, borderRadius: 8, padding: 12 }, debitedNote: { color: colors.success, fontSize: 12, lineHeight: 16, fontWeight: '500' }, debitedValue: { color: colors.success, fontSize: 16, lineHeight: 24, fontWeight: '700', fontVariant: ['tabular-nums'] },
  reviewStep: { color: colors.primary, fontSize: 12, lineHeight: 16, fontWeight: '600' }, reviewStepLabel: { color: colors.muted, fontSize: 12, lineHeight: 16, fontWeight: '500' }, reviewHero: { alignItems: 'center', padding: 16, backgroundColor: colors.white, borderRadius: 12, marginBottom: 12, ...cardShadow }, reviewHeroCompact: { paddingVertical: 12 }, reviewHeroLabel: { color: colors.muted, fontSize: 14, lineHeight: 20, fontWeight: '500' }, reviewAmountLine: { maxWidth: '100%', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'center', gap: 4, marginTop: 2 }, amountLineStart: { justifyContent: 'flex-start' }, reviewAmount: { flexShrink: 1, minWidth: 0, color: colors.text, fontSize: 36, lineHeight: 44, fontWeight: '700', letterSpacing: -0.9, fontVariant: ['tabular-nums'] }, reviewCard: { backgroundColor: colors.white, borderRadius: 12, overflow: 'hidden', marginBottom: 12, ...cardShadow }, reviewParty: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 12 }, reviewPartyIcon: { width: 40, height: 40, borderRadius: 8, backgroundColor: colors.input, alignItems: 'center', justifyContent: 'center', marginTop: 2 }, reviewPartyIconDestination: { backgroundColor: colors.paleHigh }, reviewCaption: { color: colors.muted, fontSize: 12, lineHeight: 16, fontWeight: '500', letterSpacing: 0.5 }, reviewPartyName: { color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '600', marginTop: 2 }, reviewDirection: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 4, backgroundColor: 'rgba(241,243,255,0.5)' }, reviewDirectionLine: { flex: 1, height: 1, backgroundColor: colors.paleHigh }, reviewDirectionText: { color: colors.primary, fontSize: 12, lineHeight: 16, fontWeight: '600', letterSpacing: 0.5 }, reviewMeta: { backgroundColor: 'rgba(241,243,255,0.6)', padding: 12, gap: 8 }, metaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: 12, rowGap: 2 }, rowValue: { flexGrow: 1, flexShrink: 1, flexBasis: 0 }, metaStatusValue: { justifyContent: 'flex-end' }, metaLabel: { color: colors.muted, fontSize: 14, lineHeight: 20 }, metaValue: { flexGrow: 1, flexShrink: 1, flexBasis: 0, color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '500', textAlign: 'right', fontVariant: ['tabular-nums'] }, metaStatus: { flexDirection: 'row', alignItems: 'center', gap: 6 },
shrinkRow: { flexShrink: 1, minWidth: 0 }, metaStatusText: { flexShrink: 1, color: colors.success, fontSize: 12, lineHeight: 16, fontWeight: '500' }, estimateCard: { backgroundColor: colors.white, borderRadius: 12, padding: 12, marginBottom: 24, ...cardShadow }, estimateCardCompact: { marginBottom: 12 }, estimateHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }, estimateLabel: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }, estimateLabelText: { color: colors.muted, fontSize: 12, lineHeight: 16, fontWeight: '500' }, estimateValue: { flexShrink: 1, color: colors.primary, fontSize: 16, lineHeight: 24, fontWeight: '700', fontVariant: ['tabular-nums'] }, estimateMath: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, backgroundColor: colors.input, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, marginVertical: 4 }, estimateMathText: { color: colors.muted, fontSize: 12, lineHeight: 16 }, estimateMathValue: { flexShrink: 1, fontWeight: '500', textAlign: 'right', fontVariant: ['tabular-nums'] }, estimateTrack: { height: 6, borderRadius: 3, overflow: 'hidden', flexDirection: 'row', backgroundColor: colors.paleHigh, marginVertical: 4 }, estimateRemaining: { height: 6, backgroundColor: colors.primary }, estimateSpent: { flex: 1, height: 6, backgroundColor: colors.border }, estimateNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 4 }, estimateNoteText: { flex: 1, color: colors.muted, fontSize: 12, lineHeight: 18 },
  otpContext: { backgroundColor: colors.white, borderRadius: 12, padding: 12, marginTop: -8, marginBottom: 16, ...cardShadow }, otpContextTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, otpContextLabel: { color: colors.muted, fontSize: 12, lineHeight: 16, fontWeight: '500' }, otpContextBadge: { flexShrink: 0, overflow: 'hidden', borderRadius: 4, paddingHorizontal: 4, paddingVertical: 2, backgroundColor: colors.pale, color: colors.primary, fontSize: 12, lineHeight: 16, fontWeight: '600' }, otpContextBody: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', columnGap: 12, rowGap: 8, marginTop: 8 }, otpContextName: { color: colors.text, fontSize: 16, lineHeight: 24, fontWeight: '600' }, otpContextAmount: { alignItems: 'flex-end', maxWidth: '100%', flexShrink: 1, marginLeft: 'auto' }, otpAmountLine: { maxWidth: '100%', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'flex-end', columnGap: 4 }, otpContextValue: { flexShrink: 1, minWidth: 0, color: colors.text, fontSize: 20, lineHeight: 28, fontWeight: '600', fontVariant: ['tabular-nums'] }, otpContextNote: { flexDirection: 'row', alignItems: 'center', gap: 6, borderTopWidth: 1, borderTopColor: colors.paleHigh, marginTop: 8, paddingTop: 4 }, otpCard: { alignItems: 'center', backgroundColor: colors.white, borderRadius: 12, padding: 16, marginBottom: 16, ...cardShadow }, otpBadgeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary }, otpTitle: { color: colors.text, fontSize: 20, lineHeight: 28, fontWeight: '600', textAlign: 'center', marginBottom: 4 }, otpDescription: { color: colors.muted, fontSize: 14, lineHeight: 20, textAlign: 'center', maxWidth: 320 }, demoCodeBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.input, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, marginTop: 12 }, demoCodeLabel: { flexShrink: 1, color: colors.muted, fontSize: 14, lineHeight: 20 }, demoCodeValue: { color: colors.text, fontWeight: '700', fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }), letterSpacing: 1 }, otpDigitExpired: { opacity: 0.6, backgroundColor: colors.pale, borderWidth: 1, borderColor: 'rgba(196,197,215,0.6)' }, otpDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary }, otpDash: { width: 12, height: 3, borderRadius: 2, backgroundColor: 'rgba(116,118,134,0.4)' }, otpExpiredBlock: { width: '100%', alignItems: 'center', gap: 12 }, otpExpiredBanner: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 8, borderRadius: 8, borderWidth: 1, borderColor: colors.errorPale, backgroundColor: 'rgba(255,218,214,0.4)' }, otpExpiredText: { flexShrink: 1, color: colors.warning, fontSize: 14, lineHeight: 20, fontWeight: '500', textAlign: 'center' },
  receiptHero: { alignItems: 'center', paddingTop: 4 }, receiptSuccessRing: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(152,246,187,0.5)', marginBottom: 12, ...cardShadow }, receiptSuccessIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.success, ...cardShadow }, receiptDatePill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.input, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4, marginTop: 4, maxWidth: '100%' }, receiptDateText: { flexShrink: 1, color: colors.muted, fontSize: 14, lineHeight: 20, textAlign: 'center' }, receiptCard: { backgroundColor: colors.white, borderRadius: 12, padding: 16, gap: 8, marginTop: 16, ...cardShadow }, receiptCardHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingBottom: 4 }, receiptHeadingInline: { color: colors.muted, fontSize: 12, lineHeight: 16, fontWeight: '600', letterSpacing: 0.6 }, appliedPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.successPale, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }, appliedPillText: { color: colors.onSecondaryContainer, fontSize: 12, lineHeight: 16, fontWeight: '600' }, receiptRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, paddingVertical: 4 }, receiptRowShaded: { backgroundColor: 'rgba(241,243,255,0.6)', borderRadius: 8, paddingHorizontal: 8 }, receiptRowValue: { flexShrink: 1, alignItems: 'flex-end' }, receiptValue: { color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '600', textAlign: 'right' }, receiptValueStrong: { fontVariant: ['tabular-nums'] }, receiptDetail: { color: colors.muted, fontSize: 12, lineHeight: 16, fontWeight: '500', textAlign: 'right' }, newBalanceCard: { backgroundColor: 'rgba(224,232,255,0.8)', borderRadius: 12, padding: 16, marginTop: 16, ...cardShadow }, newBalanceLabel: { flexShrink: 1, color: colors.muted, fontSize: 12, lineHeight: 16, fontWeight: '500' },
  updateNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: colors.input, borderRadius: 12, padding: 12 }, updateIcon: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.pale }, homeStatus: { color: colors.muted, fontSize: 12, lineHeight: 16, fontWeight: '500', marginTop: 2 }, homeStatusDone: { overflow: 'hidden', borderRadius: 4, paddingHorizontal: 6, backgroundColor: colors.successPale, color: colors.onSecondaryFixedVariant, fontWeight: '600' }, seeAll: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 8, paddingVertical: 8 }, seeAllText: { color: colors.primary, fontSize: 14, lineHeight: 20, fontWeight: '600' },
  page: { flex: 1, backgroundColor: colors.bg }, content: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 24, maxWidth: 600, width: '100%', alignSelf: 'center' },
  topbar: { minHeight: 64, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: -16 }, topbarBrand: { flexDirection: 'row', alignItems: 'center', gap: 8 }, topbarSection: { color: colors.muted, fontSize: 12, lineHeight: 16, fontWeight: '500', letterSpacing: 0.25 }, brand: { color: colors.text, fontSize: 14, lineHeight: 16, fontWeight: '500', letterSpacing: -0.35 }, eyebrow: { color: colors.muted, fontSize: 12, lineHeight: 16, fontWeight: '500', letterSpacing: 0.5 }, avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.paleHigh, alignItems: 'center', justifyContent: 'center', marginRight: 6 }, avatarText: { color: colors.primary, fontSize: 14, lineHeight: 20, fontWeight: '600' },
  greeting: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, paddingTop: 4, marginBottom: 16 },
greetingCopy: { flex: 1, minWidth: 0 }, title: { fontSize: 20, lineHeight: 28, fontWeight: '600', color: colors.text, letterSpacing: -0.5 }, greetingSub: { color: colors.muted, fontSize: 12, lineHeight: 16, marginTop: 2 }, muted: { color: colors.muted, fontSize: 14, lineHeight: 20 }, iconButton: { width: 44, height: 44, flexShrink: 0, marginRight: -8, alignItems: 'center', justifyContent: 'center' },
  accountTabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 4, borderRadius: 12, backgroundColor: colors.pale, marginBottom: 8 }, tab: { minHeight: 44, minWidth: 100, flex: 1, flexDirection: 'row', gap: 4, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 8 }, tabDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.placeholder }, tabDotSelected: { backgroundColor: colors.primary }, tabDigits: { flexShrink: 0, color: colors.muted, fontSize: 12, lineHeight: 16, fontWeight: '500' }, tabSelected: { backgroundColor: colors.white, ...cardShadow }, tabText: { flexShrink: 1, color: colors.muted, fontSize: 14, lineHeight: 20, fontWeight: '500' }, tabTextSelected: { color: colors.text, fontWeight: '600' },
  balanceCard: { backgroundColor: colors.white, borderRadius: 12, padding: 16, gap: 12, marginBottom: 16, ...cardShadow }, accountLabel: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4 }, tag: { overflow: 'hidden', paddingHorizontal: 8, paddingVertical: 2, backgroundColor: colors.paleHigh, borderRadius: 4, color: colors.primary, fontSize: 12, lineHeight: 16, fontWeight: '600', letterSpacing: 0.25 }, balanceLine: { flexDirection: 'row', alignItems: 'baseline', gap: 4, marginTop: 2 }, balance: { flexShrink: 1, color: colors.text, fontSize: 36, lineHeight: 44, fontWeight: '700', letterSpacing: -0.9, fontVariant: ['tabular-nums'] }, selectedBalanceLine: { flexDirection: 'row', alignItems: 'baseline' }, selectedBalance: { flexShrink: 1, color: colors.text, fontSize: 20, lineHeight: 28, fontWeight: '600', fontVariant: ['tabular-nums'] }, balanceDivider: { height: 1, backgroundColor: colors.border, marginTop: 14 }, currency: { color: colors.muted, fontSize: 14, lineHeight: 20, fontWeight: '600' },
    notice: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.input, borderRadius: 16, padding: 16, marginVertical: 8 }, sectionTitle: { color: colors.text, fontSize: 20, lineHeight: 28, fontWeight: '600' }, activityHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 20, marginBottom: 8, paddingHorizontal: 2 }, activityTitle: { color: colors.text, fontSize: 16, lineHeight: 24, fontWeight: '600' }, captionUpper: { color: colors.muted, fontSize: 12, lineHeight: 16, fontWeight: '600', letterSpacing: 0.5 }, listCard: { backgroundColor: colors.white, borderRadius: 16, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border }, accountRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 }, divider: { borderTopWidth: 1, borderTopColor: colors.border }, accountIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.pale, alignItems: 'center', justifyContent: 'center' }, rowTitle: { color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '600', marginBottom: 3 }, rowBalance: { color: colors.text, fontSize: 16, lineHeight: 24, fontWeight: '600', fontVariant: ['tabular-nums'] }, loadMore: { borderTopWidth: 1, borderTopColor: colors.border, paddingBottom: 16 },
  transferAction: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.primary, borderRadius: 12, paddingHorizontal: 16, marginBottom: 16, shadowColor: '#141b2c', shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 4 }, destinationCard: { minHeight: 92, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16, marginBottom: 16 }, destinationIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.pale, alignItems: 'center', justifyContent: 'center' }, beneficiarySection: { marginTop: 4, marginBottom: 20 }, beneficiaryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }, searchWrap: { minHeight: 48, borderRadius: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.white, marginTop: 12, marginBottom: 12, ...cardShadow }, searchInput: { flex: 1, minWidth: 0, minHeight: 48, color: colors.text, fontSize: 14 }, emptyState: { alignItems: 'center', gap: 10, backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 24, marginVertical: 8 }, link: { color: colors.primary, fontSize: 14, fontWeight: '700' }, offlineHint: { color: colors.muted, fontSize: 13, marginTop: 8 },
  loginContent: { flexGrow: 1, paddingHorizontal: 16, paddingTop: 24, paddingBottom: 24, width: '100%', maxWidth: 520, alignSelf: 'center' }, dismissArea: { flexGrow: 1 }, loginHeader: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, backgroundColor: colors.bg, ...cardShadow, shadowOpacity: 0.03 }, loginHeaderMark: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryContainer }, loginBrand: { alignItems: 'center', marginBottom: 20 }, walletMark: { width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paleHigh, marginBottom: 8, ...cardShadow }, loginEyebrow: { color: colors.placeholder, fontSize: 12, lineHeight: 16, fontWeight: '500', letterSpacing: 0.6 }, loginTitle: { color: colors.text, fontSize: 28, lineHeight: 36, fontWeight: '600', marginTop: 4, textAlign: 'center', letterSpacing: -0.28 }, loginSubtitle: { color: colors.muted, fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 4, maxWidth: 320 }, loginNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: colors.pale, borderRadius: 16, padding: 16, marginBottom: 16 }, loginError: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: colors.errorPale, borderRadius: 12, padding: 12, marginBottom: 12, ...cardShadow }, loginErrorTitle: { color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '600' }, loginErrorText: { color: colors.muted, fontSize: 12, lineHeight: 16, marginTop: 2 }, formCard: { backgroundColor: colors.white, borderRadius: 12, padding: 16, ...cardShadow }, label: { color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '500', marginBottom: 4 }, inputWrap: { minHeight: 48, borderRadius: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.input }, input: { flex: 1, minWidth: 0, minHeight: 46, color: colors.text, fontSize: 14 }, button: { minHeight: 48, borderRadius: 12, backgroundColor: colors.primaryContainer, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, ...cardShadow }, buttonPressed: { opacity: 0.86 }, buttonSecondary: { backgroundColor: colors.pale, shadowOpacity: 0, elevation: 0 }, buttonContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, flexShrink: 1 }, buttonText: { flexShrink: 1, color: colors.white, fontSize: 14, lineHeight: 20, fontWeight: '600', textAlign: 'center' }, buttonTextSecondary: { color: colors.primary }, buttonSurface: { backgroundColor: colors.white, shadowOpacity: 0, elevation: 0 }, buttonStrong: { backgroundColor: colors.primary }, buttonTextSurface: { color: colors.text, fontWeight: '500' }, buttonDisabled: { opacity: 0.5 }, errorText: { color: colors.error, fontSize: 14, lineHeight: 20, marginTop: 12 }, infoBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: colors.input, borderRadius: 12, padding: 12, marginTop: 16 }, infoText: { color: colors.muted, fontSize: 12, lineHeight: 16, marginTop: 2 }, infoTitle: { color: colors.text, fontSize: 12, lineHeight: 16, fontWeight: '600' }, loginFooter: { color: colors.placeholder, fontSize: 12, lineHeight: 16, fontWeight: '500', letterSpacing: 0.2, textAlign: 'center', marginTop: 24 }, bold: { fontWeight: '700', color: colors.text },
  movementAccountCard: { padding: 16, backgroundColor: colors.white, borderRadius: 12, marginBottom: 16, ...cardShadow }, movementAccountTop: { flexDirection: 'row', alignItems: 'center', gap: 8 }, bankIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.pale, alignItems: 'center', justifyContent: 'center' }, accountPicker: { flex: 1, minWidth: 0, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 4 }, movementAccountName: { flexShrink: 1, color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '600' }, movementBalance: { alignItems: 'flex-end', maxWidth: '50%', flexShrink: 0 }, movementBalanceAmount: { color: colors.text, fontSize: 16, lineHeight: 24, fontWeight: '700', letterSpacing: -0.4, fontFamily: MONO, fontVariant: ['tabular-nums'] }, accountOptions: { marginTop: 12, gap: 6 }, accountOption: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12, paddingHorizontal: 12, backgroundColor: colors.input }, accountOptionSelected: { backgroundColor: colors.pale }, movementsTitle: { color: colors.text, fontSize: 20, lineHeight: 28, fontWeight: '700', letterSpacing: -0.5, marginBottom: 16 }, movementGroup: { marginBottom: 24, gap: 4 }, movementGroupHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 4 }, groupLabel: { color: colors.muted, fontSize: 12, lineHeight: 16, fontWeight: '600', letterSpacing: 0.5 }, groupCount: { color: colors.placeholder, fontSize: 12, lineHeight: 16, fontWeight: '500' }, movementCard: { backgroundColor: colors.white, borderRadius: 12, overflow: 'hidden', ...cardShadow }, movementRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 12 }, movementIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.pale, alignItems: 'center', justifyContent: 'center' }, movementCopy: { flex: 1, minWidth: 0 }, movementTitle: { color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '600' }, movementSub: { color: colors.muted, fontSize: 12, lineHeight: 16 }, movementMeta: { color: colors.muted, fontSize: 12, lineHeight: 16, fontWeight: '500', marginTop: 1 }, movementAmountColumn: { alignItems: 'flex-end', maxWidth: '46%', flexShrink: 0 }, movementAmount: { color: colors.text, fontSize: 16, lineHeight: 24, fontWeight: '700', letterSpacing: -0.4, fontVariant: ['tabular-nums'] }, movementsFooter: { color: colors.placeholder, fontSize: 12, lineHeight: 16, fontWeight: '500', textAlign: 'center', marginTop: 0, marginBottom: 16 }, creditIcon: { backgroundColor: colors.successPale }, creditAmount: { color: colors.success }, bottomNavigation: { minHeight: 64, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', backgroundColor: colors.bg, paddingHorizontal: 24, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 12, shadowOffset: { width: 0, height: -2 }, elevation: 6 }, navigationItem: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', gap: 2, paddingVertical: 8 }, navigationLabel: { color: colors.muted, fontSize: 13, lineHeight: 18, fontWeight: '500', letterSpacing: -0.3 }, navigationLabelActive: { color: colors.primary, fontWeight: '600' },
  pickerContent: { flexGrow: 1, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 24, maxWidth: 600, width: '100%', alignSelf: 'center' }, pickerTitle: { color: colors.text, fontSize: 20, lineHeight: 28, fontWeight: '600', letterSpacing: -0.1 }, pickerDescription: { color: colors.muted, fontSize: 12, lineHeight: 16, marginTop: 4 }, filterRow: { flexDirection: 'row', gap: 8, marginBottom: 12 }, filterChip: { minHeight: 28, borderRadius: 14, paddingHorizontal: 12, justifyContent: 'center', backgroundColor: colors.primary }, filterChipText: { color: colors.white, fontSize: 12, lineHeight: 16, fontWeight: '500' }, pickerMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, paddingBottom: 4 }, captionLabel: { color: colors.placeholder, fontSize: 12, lineHeight: 16, fontWeight: '500', letterSpacing: 0.5 }, captionMeta: { color: colors.placeholder, fontSize: 12, lineHeight: 16, fontWeight: '500' }, beneficiaryCard: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, backgroundColor: colors.white, borderRadius: 12, marginBottom: 8, ...cardShadow }, beneficiaryCardPressed: { backgroundColor: colors.input }, beneficiaryCardDisabled: { opacity: 0.6 }, inlineWarningText: { color: colors.warning, fontSize: 14, lineHeight: 20, marginTop: 4 }, originNotice: { backgroundColor: colors.pale, borderRadius: 12, padding: 12, gap: 8, marginBottom: 8 }, originNoticeText: { flex: 1, color: colors.text, fontSize: 14, lineHeight: 20 }, originNoticeCaption: { color: colors.muted, fontSize: 12, lineHeight: 16, fontWeight: '500' }, originOptions: { gap: 6, marginTop: 8 }, originOption: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.bg }, originOptionSelected: { borderColor: colors.primaryContainer, backgroundColor: colors.white }, radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.placeholder, alignItems: 'center', justifyContent: 'center' }, radioSelected: { borderColor: colors.primaryContainer }, radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primaryContainer }, sameAccountBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: 8, padding: 10, marginBottom: 8, backgroundColor: '#fff1ef', borderWidth: 1, borderColor: colors.errorPale }, sameAccountText: { flex: 1, color: colors.warning, fontSize: 14, lineHeight: 20, fontWeight: '500' }, changeOriginLink: { minHeight: 32, justifyContent: 'center' }, pendingNotice: { gap: 8, backgroundColor: colors.paleHigh, borderRadius: 12, padding: 12, marginBottom: 12 }, pendingNoticeTitle: { color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '600' }, pendingNoticeText: { color: colors.muted, fontSize: 14, lineHeight: 20 }, homeChangeLink: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' }, otpVerifying: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 8 }, otpStateText: { color: colors.muted, fontSize: 14, lineHeight: 20, fontWeight: '500', textAlign: 'center', marginBottom: 8 }, otpWrongBanner: { width: '100%', flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: colors.errorPale, borderRadius: 8, padding: 12, marginBottom: 8 }, otpWrongText: { flex: 1, color: colors.error, fontSize: 14, lineHeight: 20, fontWeight: '500' }, otpDigitWrong: { borderWidth: 1, borderColor: colors.error }, beneficiaryAvatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paleHigh }, beneficiaryInitials: { color: colors.primary, fontSize: 16, lineHeight: 24, fontWeight: '600' }, beneficiaryNameLine: { flexDirection: 'row', alignItems: 'center', gap: 6 }, wrapLine: { flexWrap: 'wrap', rowGap: 2 }, beneficiaryName: { flexShrink: 1, color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '500' }, aliasBadge: { flexShrink: 0, maxWidth: '45%', overflow: 'hidden', borderRadius: 4, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: colors.pale, color: colors.primary, fontSize: 12, lineHeight: 16, fontWeight: '500', letterSpacing: 0.2 }, beneficiaryAccount: { color: colors.muted, fontSize: 12, lineHeight: 16, marginTop: 2 }, pickerEmpty: { alignItems: 'center', padding: 16, borderRadius: 12, backgroundColor: colors.input, ...cardShadow }, pickerEmptyIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.pale, marginBottom: 12 }, pickerEmptyTitle: { color: colors.text, fontSize: 16, lineHeight: 24, fontWeight: '600', textAlign: 'center', marginBottom: 4 }, pickerEmptyText: { color: colors.muted, fontSize: 12, lineHeight: 16, textAlign: 'center', maxWidth: 280 }, pickerFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: colors.input, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12, marginTop: 'auto' }, pickerFooterText: { flex: 1, color: colors.muted, fontSize: 12, lineHeight: 16, letterSpacing: 0.2, textAlign: 'center' },
  screenHeader: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, backgroundColor: colors.bg, ...cardShadow, shadowOpacity: 0.03 }, headerBack: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, headerTitle: { color: colors.text, fontSize: 16, lineHeight: 24, fontWeight: '600', flexShrink: 1 }, headerAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primaryFixed, alignItems: 'center', justifyContent: 'center', marginRight: 4 }, headerAvatarSolid: { backgroundColor: colors.primaryContainer }, headerAvatarSolidText: { color: colors.white, fontSize: 12, lineHeight: 16, fontWeight: '600' },
  detailContent: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32, maxWidth: 600, width: '100%', alignSelf: 'center' }, detailHero: { alignItems: 'center', marginBottom: 16 }, detailStatusIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.successPale, alignItems: 'center', justifyContent: 'center', marginBottom: 12, ...cardShadow }, detailStatusIconPending: { backgroundColor: colors.pale }, detailStatusIconRejected: { backgroundColor: colors.errorPale }, detailPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.paleHigh, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4, marginBottom: 4 }, detailTitle: { color: colors.text, fontSize: 20, lineHeight: 28, fontWeight: '600', textAlign: 'center', letterSpacing: -0.1 }, detailAmountLine: { maxWidth: '100%', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'center', columnGap: 8, marginTop: 8, marginBottom: 4 }, detailAmount: { flexShrink: 1, minWidth: 0, color: colors.text, fontSize: 36, lineHeight: 44, fontWeight: '700', letterSpacing: -0.9, fontVariant: ['tabular-nums'] }, detailCurrency: { color: colors.muted, fontSize: 16, lineHeight: 24, fontWeight: '600', letterSpacing: 0 }, detailDate: { color: colors.muted, fontSize: 14, lineHeight: 20, textAlign: 'center' }, detailZone: { color: colors.placeholder, fontSize: 12, lineHeight: 16, fontWeight: '500', textAlign: 'center' }, detailCard: { backgroundColor: colors.white, borderRadius: 12, padding: 16, gap: 8, ...cardShadow }, detailStacked: { gap: 4, paddingVertical: 4 }, detailStackedValue: { color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '500', flexShrink: 1 }, detailDestination: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }, detailRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: 12, rowGap: 2, paddingVertical: 4 }, detailRowValue: { color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '500', textAlign: 'right', flexGrow: 1, flexShrink: 1, flexBasis: 0 }, detailRowEmphasis: { fontSize: 16, lineHeight: 24, fontWeight: '600', fontVariant: ['tabular-nums'] }, detailRowAccent: { color: colors.primary, fontWeight: '600', letterSpacing: 0.35 }, detailFootnote: { color: colors.placeholder, fontSize: 12, lineHeight: 16, fontWeight: '500', textAlign: 'center', paddingVertical: 8, marginTop: 12 },
  centered: { flex: 1, minHeight: 180, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, backgroundColor: colors.bg }, privacyPage: { flex: 1, backgroundColor: colors.bg }, privacyTopbar: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, backgroundColor: colors.bg, ...cardShadow, shadowOpacity: 0.03 }, privacyBrandMark: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryContainer }, privacy: { flex: 1, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 16, backgroundColor: colors.bg }, privacyCard: { minHeight: 460, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(196,197,215,0.3)', ...cardShadow }, privacyIcon: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.input, marginBottom: 16 }, privacyIconInner: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.pale }, privacyShield: { position: 'absolute', right: -4, bottom: -4, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceHighest, ...cardShadow }, privacyTitle: { color: colors.text, fontSize: 20, lineHeight: 28, fontWeight: '600', letterSpacing: -0.5, marginBottom: 8 }, privacyCopy: { color: colors.muted, fontSize: 14, lineHeight: 22, textAlign: 'center', maxWidth: 280 }, privacyNoteTitle: { color: colors.text, fontSize: 16, lineHeight: 24, fontWeight: '600' }, privacyPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.paleHigh, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4, marginBottom: 12 }, privacyPillText: { color: colors.muted, fontSize: 12, lineHeight: 16, fontWeight: '500' }, privacyNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 12, marginTop: 12, backgroundColor: colors.white, borderWidth: 1, borderColor: 'rgba(196,197,215,0.3)', borderRadius: 12, ...cardShadow }, center: { textAlign: 'center', maxWidth: 320, marginTop: 16 }, privacyFooter: { position: 'absolute', bottom: 36, color: colors.muted, fontSize: 14, fontWeight: '600' },
buttonSurfaceLow: { backgroundColor: colors.input, shadowOpacity: 0, elevation: 0 },
buttonSecondaryHigh: { backgroundColor: colors.paleHigh, shadowOpacity: 0, elevation: 0 },
buttonMuted: { backgroundColor: colors.surfaceHighest, shadowOpacity: 0, elevation: 0 },
buttonTextLarge: { fontSize: 16, lineHeight: 24, fontWeight: '600' },
buttonTextMuted: { color: 'rgba(67,70,85,0.6)' },
actions: { gap: 8 },
headerAvatarText: { color: colors.onPrimaryFixed, fontSize: 12, lineHeight: 16, fontWeight: '600' },
loginErrorNetwork: { backgroundColor: colors.paleHigh },
loginErrorLocked: { backgroundColor: colors.surfaceHighest },
loginButton: { marginTop: 20 },
expiredCard: { alignItems: 'center', backgroundColor: colors.white, borderRadius: 12, padding: 16, marginBottom: 16, ...cardShadow },
expiredIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.pale, marginBottom: 16 },
expiredDot: { position: 'absolute', top: 0, right: 0, width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.tertiaryContainer },
expiredDotInner: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.white },
expiredTitle: { color: colors.text, fontSize: 20, lineHeight: 28, fontWeight: '600', letterSpacing: -0.5, textAlign: 'center', marginBottom: 4 },
expiredText: { color: colors.muted, fontSize: 14, lineHeight: 22, textAlign: 'center' },
balanceDigits: { color: colors.muted, fontSize: 12, lineHeight: 16 },
balanceLabel: { color: colors.muted, fontSize: 12, lineHeight: 16 },
updateTitle: { color: colors.text, fontSize: 12, lineHeight: 16, fontWeight: '600' },
updateText: { color: colors.muted, fontSize: 12, lineHeight: 17 },
homeDivider: { height: 1, backgroundColor: colors.pale, marginHorizontal: 12 },
listDivider: { height: 1, backgroundColor: colors.pale },
movementIconList: { backgroundColor: colors.paleHigh },
creditIconList: { backgroundColor: 'rgba(152,246,187,0.4)' },
movementSubCredit: { color: colors.success, fontWeight: '500' },
movementMetaList: { color: colors.placeholder, fontVariant: ['tabular-nums'] },
movementAmountList: { fontWeight: '600' },
movementCurrency: { color: colors.muted, fontSize: 12, lineHeight: 16, fontWeight: '500' },
listChevron: { marginLeft: -4 },
detailLiveDot: { position: 'absolute', top: -4, right: -4, width: 16, height: 16, borderRadius: 8, backgroundColor: colors.success },
detailPillDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success },
detailPillText: { color: colors.muted, fontSize: 12, lineHeight: 16, fontWeight: '500' },
detailLabel: { flexShrink: 0, color: colors.muted, fontSize: 12, lineHeight: 16 },
detailRowSmall: { fontSize: 12, lineHeight: 16, fontWeight: '400' },
detailActions: { gap: 8, marginTop: 8 },
folioValue: { flexShrink: 1, color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '600', letterSpacing: 0.35, textAlign: 'right', fontVariant: ['tabular-nums'] },
progressTrackHigh: { backgroundColor: colors.paleHigh },
reviewProgress: { marginTop: -4, marginBottom: 12, gap: 4 },
reviewPartySub: { color: colors.muted, fontSize: 12, lineHeight: 16, marginTop: 2 },
metaStatusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success },
modifyText: { color: colors.primary, fontSize: 14, lineHeight: 20, fontWeight: '500' },
otpContextUnit: { color: colors.muted, fontSize: 12, lineHeight: 16, fontWeight: '500' },
otpStatus: { width: '100%', alignItems: 'center', gap: 8 },
newCodeButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: 'rgba(220,225,255,0.5)' },
newCodeButtonText: { flexShrink: 1, color: colors.primary, fontSize: 14, lineHeight: 20, fontWeight: '600', textAlign: 'center' },
statusSection: { alignItems: 'center', paddingTop: 12, marginBottom: 16 },
sendingRing: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,55,176,0.1)', marginBottom: 24 },
sendingInner: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white, ...cardShadow },
sendingPill: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', backgroundColor: colors.paleHigh, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, marginBottom: 8 },
sendingPillText: { color: colors.muted, fontSize: 12, lineHeight: 16, fontWeight: '500' },
sendingMessage: { color: colors.muted, fontSize: 14, lineHeight: 20, textAlign: 'center', alignSelf: 'center', maxWidth: 320, marginBottom: 24 },
sendingCaption: { color: 'rgba(67,70,85,0.7)', fontSize: 12, lineHeight: 16, fontWeight: '500', textAlign: 'center', marginTop: 8 },
warningTitle: { color: colors.text, fontSize: 12, lineHeight: 16, fontWeight: '600' },
statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 4 },
statusRowLabel: { flexShrink: 0, color: colors.muted, fontSize: 12, lineHeight: 16, fontWeight: '500' },
statusRowValue: { flexShrink: 1, color: colors.text, fontSize: 12, lineHeight: 16, fontWeight: '600', textAlign: 'right', fontVariant: ['tabular-nums'] },
statusFooter: { alignItems: 'center', gap: 4, paddingTop: 16 },
statusFooterId: { color: 'rgba(67,70,85,0.8)', fontSize: 12, lineHeight: 16, fontFamily: MONO, letterSpacing: 0.25, textAlign: 'center' },
statusFooterBrand: { flexDirection: 'row', alignItems: 'center', gap: 6 },
statusFooterText: { color: 'rgba(67,70,85,0.6)', fontSize: 12, lineHeight: 16, fontWeight: '500' },
mono: { fontFamily: MONO },
receiptVerified: { position: 'absolute', right: -4, bottom: -4, borderRadius: 10, padding: 2, backgroundColor: colors.white, ...cardShadow },
receiptAmountLine: { maxWidth: '100%', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'center', gap: 4, marginTop: 4 },
receiptAmount: { flexShrink: 1, minWidth: 0, color: colors.text, fontSize: 36, lineHeight: 44, fontWeight: '700', letterSpacing: -0.9, fontVariant: ['tabular-nums'] },
receiptCurrency: { color: colors.muted, fontSize: 14, lineHeight: 20, fontWeight: '500' },
receiptLabel: { flexShrink: 0, color: colors.muted, fontSize: 12, lineHeight: 20 },
newBalanceCurrency: { color: colors.muted, fontSize: 16, lineHeight: 24, fontWeight: '600' },
receiptActions: { gap: 8, marginTop: 24 },
receiptShare: { gap: 6, marginTop: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(196,197,215,0.3)' },
receiptShareCaption: { color: colors.muted, fontSize: 12, lineHeight: 16, fontWeight: '500', textAlign: 'center' },
receiptShareRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
receiptShareButton: { flexGrow: 1, flexBasis: 140, minHeight: 44, backgroundColor: colors.input, borderWidth: 1, borderColor: 'rgba(196,197,215,0.4)' },
receiptShareStatus: { color: colors.muted, fontSize: 14, lineHeight: 20, textAlign: 'center' },
receiptShareError: { color: colors.error, fontSize: 14, lineHeight: 20, textAlign: 'center' },
rejectedTitle: { color: colors.text, fontSize: 20, lineHeight: 28, fontWeight: '600', textAlign: 'center', marginBottom: 4 },
rejectedReasonStrong: { color: colors.text, fontWeight: '500' },
intactTitle: { color: colors.text, fontSize: 12, lineHeight: 16, fontWeight: '600' },
intactText: { color: colors.muted, fontSize: 14, lineHeight: 20 },
rejectedCard: { backgroundColor: colors.white, borderRadius: 12, padding: 16, gap: 12, marginBottom: 24, ...cardShadow },
rejectedRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: 12, rowGap: 2, paddingBottom: 8 },
rejectedAccount: { flexShrink: 1, color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '500', textAlign: 'right' },
debitedTitle: { color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '600' },
privacyCenter: { flex: 1, justifyContent: 'center' },
privacyNoteIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.pale },
privacyNoteText: { color: colors.muted, fontSize: 12, lineHeight: 19, marginTop: 2 },
movementAmountCredit: { fontWeight: '700' },
mediumText: { color: colors.text, fontWeight: '500' },
captionLeading: { lineHeight: 16 },
statusError: { marginTop: 0, marginBottom: 12 },
newBalanceHeader: { marginBottom: 4 },
buttonTextDark: { color: colors.text },
});

// Inter (Stitch typeface) per weight; the system font with fontWeight is the fallback when Inter cannot be loaded.
const interStyles = StyleSheet.create(withInter(baseStyles));
let activeTypeface: Exclude<Typeface, 'loading'> = 'inter';
const styles: typeof baseStyles = new Proxy(interStyles, { get: (target, key: string) => (activeTypeface === 'system' ? baseStyles : target)[key as keyof typeof baseStyles] });

export default function App() {
  // The app waits (branded "Preparando" view) until Inter is ready or the safe system-font fallback is chosen.
  const typeface = useInterTypeface((settled) => { activeTypeface = settled; });
  return <SafeAreaProvider><SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>{typeface === 'loading'
    ? <View accessibilityLabel="Cargando" style={baseStyles.centered}><ActivityIndicator color={colors.primary} /></View>
    : <QueryClientProvider client={queryClient}><Wallet /></QueryClientProvider>}</SafeAreaView></SafeAreaProvider>;
}
