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
const REFRESH_KEY = 'wallet.refresh-token';
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
  const [createAttempt, setCreateAttempt] = useState<{ key: string; payload: TransferRequest } | null>(null);
  const [otp, setOtp] = useState('');
  const [confirmAttempt, setConfirmAttempt] = useState<{ key: string; payload: { code: string } } | null>(null);
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
      setSession(null);
      setDestination(null);
      setTransfer(null);
      setCreateAttempt(null);
      setConfirmAttempt(null);
      setOtp('');
      setTransferScreen(null);
      setChoosingBeneficiary(false);
      setBeneficiarySearch('');
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
  const amountMinor = amountToMinor(amount);
  const transferPayload: TransferRequest | null = destination && selected && amountMinor && concept.trim() && reference
    ? { sourceAccountId: selected.id, destinationType: 'beneficiary', beneficiaryId: destination.id, amountMinor, concept: concept.trim(), reference }
    : null;

  async function submitCreate(retry = false) {
    if (!session || !transferPayload || transferBusy) return;
    const attempt = retry && createAttempt ? createAttempt : { key: newIdempotencyKey(), payload: transferPayload };
    if (!retry) setCreateAttempt(attempt);
    setTransferBusy(true); setTransferError(''); setTransferScreen('status');
    try {
      const result = await request<Transfer>('/transfers', session.accessToken, { method: 'POST', headers: { 'Idempotency-Key': attempt.key }, body: JSON.stringify(attempt.payload) });
      const finalResult = result.status === 'completed' ? await request<Transfer>(`/transfers/${result.id}`, session.accessToken) : result;
      setTransfer(finalResult);
      setTransferScreen(finalResult.status === 'awaiting_confirmation' ? 'otp' : finalResult.status === 'rejected' ? 'rejected' : 'receipt');
    } catch (error) {
      setTransferError(error instanceof Error ? error.message : 'No se pudo confirmar el resultado.');
      setTransferScreen(error instanceof ApiError && error.status >= 400 && error.status < 500 ? 'rejected' : 'status');
    } finally { setTransferBusy(false); }
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
    setTransferScreen(null); setAmount(''); setConcept(''); setReference(''); setTransfer(null); setCreateAttempt(null); setConfirmAttempt(null); setOtp(''); setTransferError('');
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

  if (transferScreen) return <TransferFlow screen={transferScreen} amount={amount} setAmount={setAmount} concept={concept} setConcept={setConcept} reference={reference} setReference={setReference} otp={otp} setOtp={setOtp} destination={destination} source={selected} transfer={transfer} error={transferError} busy={transferBusy} demoOnlyCode={transfer?.demoOnlyCode} createRetry={Boolean(createAttempt && transferScreen === 'status' && !transfer)} confirmRetry={Boolean(confirmAttempt)} onBack={() => setTransferScreen(transferScreen === 'review' ? 'details' : 'review')} onReview={() => { setTransferError(''); setTransferScreen('review'); }} onCreate={() => void submitCreate()} onRetryCreate={() => void submitCreate(true)} onConfirm={() => void confirmOtp()} onRetryConfirm={() => void confirmOtp(true)} onCheck={() => void checkTransferStatus()} onDone={resetTransfer} />;

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
        {selected && <View style={styles.balanceCard}><View style={styles.accountLabel}><Text style={styles.tag}>{selected.kind === 'checking' ? 'CUENTA PRINCIPAL' : 'CUENTA DE AHORRO'}</Text><Text style={styles.muted}>{selected.clabeMasked}</Text></View><Text style={styles.muted}>Saldo disponible</Text><View style={styles.balanceLine}><Text adjustsFontSizeToFit numberOfLines={1} style={styles.balance}>{formatBalance(selected.availableBalanceMinor)}</Text><Text style={styles.currency}> MXN</Text></View></View>}
        <View style={styles.notice}><Ionicons name="time-outline" size={23} color={colors.primary} /><View style={{ flex: 1 }}><Text style={styles.sectionTitle}>Saldo actualizado</Text><Text style={styles.muted}>Consulta el saldo disponible de tu cuenta.</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Actualizar cuentas" hitSlop={10} onPress={() => void accountsQuery.refetch()}><Ionicons name="refresh" size={21} color={colors.primary} /></Pressable></View>
        <View style={styles.activityHeader}><Text style={styles.sectionTitle}>Tus cuentas</Text><Text style={styles.eyebrow}>{accounts.length} {accounts.length === 1 ? 'CUENTA' : 'CUENTAS'}</Text></View>
        <View style={styles.listCard}>{accounts.map((account, index) => <Pressable key={account.id} accessibilityRole="button" accessibilityLabel={`${account.name}, saldo ${formatBalance(account.availableBalanceMinor)} pesos`} accessibilityState={{ selected: selected?.id === account.id }} onPress={() => setSelectedId(account.id)} style={[styles.accountRow, index > 0 && styles.divider]}><View style={styles.accountIcon}><Ionicons name={account.kind === 'checking' ? 'wallet-outline' : 'bookmark-outline'} size={22} color={colors.primary} /></View><View style={{ flex: 1 }}><Text style={styles.rowTitle}>{account.name}</Text><Text style={styles.muted}>{account.clabeMasked} · MXN</Text></View><Text style={styles.rowBalance}>{formatBalance(account.availableBalanceMinor)}</Text></Pressable>)}</View>
      </>}
    </ScrollView>
  </View>;
}

function LoginScreen(props: { email: string; password: string; setEmail: (value: string) => void; setPassword: (value: string) => void; passwordVisible: boolean; setPasswordVisible: (value: boolean) => void; error: string; submitting: boolean; onSubmit: () => void }) {
  return <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><StatusBar barStyle="dark-content" /><ScrollView contentContainerStyle={styles.loginContent} keyboardShouldPersistTaps="handled">
    <View style={styles.loginBrand}><View style={styles.walletMark}><Ionicons name="wallet-outline" size={28} color={colors.primary} /></View><Text style={styles.eyebrow}>BILLETERA MXN</Text><Text style={styles.loginTitle}>Inicia sesión</Text><Text style={styles.loginSubtitle}>Ingresa con tu correo y contraseña registrados en el panel web.</Text></View>
    <View style={styles.formCard}><Text style={styles.label}>Correo electrónico</Text><View style={styles.inputWrap}><Ionicons name="mail-outline" size={20} color={colors.muted} /><TextInput accessibilityLabel="Correo electrónico" autoCapitalize="none" autoComplete="email" keyboardType="email-address" returnKeyType="next" value={props.email} onChangeText={props.setEmail} placeholder="tu@correo.com" placeholderTextColor={colors.placeholder} style={styles.input} /></View><Text style={[styles.label, { marginTop: 18 }]}>Contraseña</Text><View style={styles.inputWrap}><Ionicons name="lock-closed-outline" size={20} color={colors.muted} /><TextInput accessibilityLabel="Contraseña" autoCapitalize="none" autoComplete="password" secureTextEntry={!props.passwordVisible} returnKeyType="done" onSubmitEditing={props.onSubmit} value={props.password} onChangeText={props.setPassword} placeholder="Tu contraseña" placeholderTextColor={colors.placeholder} style={styles.input} /><Pressable accessibilityRole="button" accessibilityLabel={props.passwordVisible ? 'Ocultar contraseña' : 'Mostrar contraseña'} hitSlop={10} onPress={() => props.setPasswordVisible(!props.passwordVisible)}><Ionicons name={props.passwordVisible ? 'eye-off-outline' : 'eye-outline'} size={21} color={colors.muted} /></Pressable></View>
      {props.error ? <Text accessibilityRole="alert" style={styles.errorText}>{props.error}</Text> : null}<Button title={props.submitting ? 'Ingresando…' : 'Ingresar'} disabled={props.submitting} onPress={props.onSubmit} /></View>
    <View style={styles.infoBox}><Ionicons name="information-circle-outline" size={22} color={colors.muted} /><Text style={styles.infoText}><Text style={styles.bold}>¿No tienes cuenta? </Text>El registro se realiza exclusivamente desde el panel web.</Text></View>
  </ScrollView></KeyboardAvoidingView>;
}

function TransferFlow(props: { screen: 'details' | 'review' | 'otp' | 'status' | 'receipt' | 'rejected'; amount: string; setAmount: (value: string) => void; concept: string; setConcept: (value: string) => void; reference: string; setReference: (value: string) => void; otp: string; setOtp: (value: string) => void; destination: Beneficiary | null; source: Account | undefined; transfer: Transfer | null; error: string; busy: boolean; demoOnlyCode?: string; createRetry: boolean; confirmRetry: boolean; onBack: () => void; onReview: () => void; onCreate: () => void; onRetryCreate: () => void; onConfirm: () => void; onRetryConfirm: () => void; onCheck: () => void; onDone: () => void }) {
  const minor = amountToMinor(props.amount);
  const insufficient = Boolean(minor && props.source && BigInt(minor) > BigInt(props.source.availableBalanceMinor));
  const formValid = Boolean(minor && props.concept.trim().length >= 1 && props.concept.trim().length <= 40 && /^\d{1,7}$/.test(props.reference));
  let title = 'Datos de transferencia';
  if (props.screen === 'review') title = 'Revisa tu transferencia';
  if (props.screen === 'otp') title = 'Confirma tu identidad';
  if (props.screen === 'status') title = props.busy ? 'Consultando operación…' : 'Estamos verificando';
  if (props.screen === 'receipt') title = 'Transferencia completada';
  if (props.screen === 'rejected') title = 'Transferencia no completada';
  return <View style={styles.page}><StatusBar barStyle="dark-content"/><ScrollView contentContainerStyle={styles.flowContent} keyboardShouldPersistTaps="handled">
    <Pressable accessibilityRole="button" accessibilityLabel="Volver" style={styles.backButton} onPress={props.screen === 'details' ? props.onDone : props.onBack}><Ionicons name="arrow-back" size={22} color={colors.primary}/><Text style={styles.link}>Volver</Text></Pressable>
    <Text style={styles.eyebrow}>TRANSFERENCIA INTERNA</Text><Text style={styles.flowTitle}>{title}</Text>
    {props.destination && <View style={styles.flowCard}><Text style={styles.label}>Para</Text><Text style={styles.rowTitle}>{props.destination.name}</Text><Text style={styles.muted}>{props.destination.alias} · {props.destination.clabeMasked}</Text></View>}
    {props.screen === 'details' && <>
      <View style={styles.flowCard}><Text style={styles.label}>Cuenta de origen</Text><Text style={styles.rowTitle}>{props.source?.name ?? 'Selecciona una cuenta'}</Text><Text style={styles.muted}>Disponible {props.source ? formatBalance(props.source.availableBalanceMinor) : '—'} MXN</Text></View>
      <View style={styles.flowCard}><Text style={styles.label}>Importe (MXN)</Text><TextInput accessibilityLabel="Importe" keyboardType="decimal-pad" value={props.amount} onChangeText={props.setAmount} placeholder="0.00" placeholderTextColor={colors.placeholder} style={styles.flowInput}/><Text style={styles.label}>Concepto</Text><TextInput accessibilityLabel="Concepto" value={props.concept} onChangeText={props.setConcept} maxLength={40} placeholder="¿Para qué es?" placeholderTextColor={colors.placeholder} style={styles.flowInput}/><Text style={styles.label}>Referencia numérica</Text><TextInput accessibilityLabel="Referencia" keyboardType="number-pad" value={props.reference} onChangeText={(value) => props.setReference(value.replace(/\D/g, '').slice(0, 7))} maxLength={7} placeholder="1 a 7 dígitos" placeholderTextColor={colors.placeholder} style={styles.flowInput}/></View>
      {insufficient && <Text accessibilityRole="alert" style={styles.errorText}>Saldo insuficiente para este importe.</Text>}
      {!insufficient && props.amount && !minor && <Text accessibilityRole="alert" style={styles.errorText}>Escribe un importe positivo con máximo dos decimales.</Text>}
      <Button title="Revisar transferencia" disabled={!formValid || insufficient || !props.source} onPress={props.onReview}/>
    </>}
    {props.screen === 'review' && <><View style={styles.flowCard}><Text style={styles.label}>Desde</Text><Text style={styles.rowTitle}>{props.source?.name}</Text><Text style={styles.label}>Importe</Text><Text style={styles.flowAmount}>{minor ? formatBalance(minor) : '—'} MXN</Text><Text style={styles.label}>Concepto</Text><Text style={styles.rowTitle}>{props.concept.trim()}</Text><Text style={styles.label}>Referencia</Text><Text style={styles.rowTitle}>{props.reference}</Text></View>{props.error ? <Text accessibilityRole="alert" style={styles.errorText}>{props.error}</Text> : null}<Button title={props.busy ? 'Enviando…' : 'Confirmar transferencia'} disabled={props.busy} onPress={props.onCreate}/></>}
    {props.screen === 'otp' && <><View style={styles.flowCard}><Text style={styles.muted}>Ingresa el código de confirmación asociado a esta operación.</Text>{props.demoOnlyCode ? <Text style={styles.demoCode}>Código de prueba local: {props.demoOnlyCode}</Text> : null}<TextInput accessibilityLabel="Código de confirmación" keyboardType="number-pad" maxLength={6} value={props.otp} onChangeText={(value) => props.setOtp(value.replace(/\D/g, '').slice(0, 6))} placeholder="6 dígitos" placeholderTextColor={colors.placeholder} style={styles.flowInput}/></View>{props.error ? <Text accessibilityRole="alert" style={styles.errorText}>{props.error}</Text> : null}<Button title={props.busy ? 'Confirmando…' : 'Confirmar código'} disabled={props.busy || !/^\d{6}$/.test(props.otp)} onPress={props.onConfirm}/>{props.confirmRetry && <Button title="Reintentar envío del mismo código" disabled={props.busy} onPress={props.onRetryConfirm}/>}</>}
    {props.screen === 'status' && <><View style={styles.flowCard}><Text style={styles.muted}>{props.error || 'El resultado puede tardar. Consulta el estado o reintenta de forma segura.'}</Text>{props.transfer && <Text style={styles.rowTitle}>Estado: {props.transfer.status}</Text>}</View><Button title="Consultar estado" disabled={props.busy || !props.transfer} onPress={props.onCheck}/>{props.createRetry && <Button title="Reintentar el mismo envío" disabled={props.busy} onPress={props.onRetryCreate}/>}</>}
    {props.screen === 'receipt' && <><View style={styles.flowCard}><Text style={styles.flowAmount}>{formatBalance(props.transfer?.amountMinor ?? '0')} MXN</Text><Text style={styles.muted}>Enviada a {props.destination?.name}</Text><Text style={styles.label}>Concepto</Text><Text style={styles.rowTitle}>{props.transfer?.concept}</Text><Text style={styles.label}>Folio interno</Text><Text style={styles.rowTitle}>{props.transfer?.receiptReference ?? props.transfer?.id}</Text></View><Button title="Listo" onPress={props.onDone}/></>}
    {props.screen === 'rejected' && <><View style={styles.flowCard}><Text style={styles.muted}>{props.error || 'La transferencia fue rechazada. No se completó el movimiento.'}</Text></View><Button title="Volver a mis cuentas" onPress={props.onDone}/></>}
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

function PrivacyScreen() { return <View style={styles.privacy}><View style={styles.privacyIcon}><Ionicons name="shield-checkmark-outline" size={34} color={colors.primary} /></View><Text style={styles.sectionTitle}>Información protegida</Text><Text style={[styles.muted, styles.center]}>Tu información se oculta mientras la app está en segundo plano.</Text><Text style={styles.privacyFooter}>Billetera MXN</Text></View>; }
function Centered({ children }: { children: React.ReactNode }) { return <View style={styles.centered}>{children}</View>; }
function Button({ title, onPress, disabled }: { title: string; onPress: () => void; disabled?: boolean }) { return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.button, (pressed || disabled) && styles.buttonPressed]}><Text style={styles.buttonText}>{disabled ? <ActivityIndicator color="#fff" /> : title}</Text></Pressable>; }
function initials(name: string) { return name.split(/\s+/).slice(0, 2).map((part) => part[0] ?? '').join('').toUpperCase(); }

const colors = { bg: '#f9f9ff', white: '#ffffff', text: '#141b2c', muted: '#434655', placeholder: '#747686', primary: '#0037b0', pale: '#e9edff', border: '#e0e8ff', error: '#ba1a1a' };
const styles = StyleSheet.create({
  flowContent: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 48, maxWidth: 720, width: '100%', alignSelf: 'center' }, backButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 24 }, flowTitle: { color: colors.text, fontSize: 28, lineHeight: 36, fontWeight: '700', marginTop: 8, marginBottom: 20 }, flowCard: { backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 18, marginBottom: 14, gap: 8 }, flowInput: { minHeight: 50, borderRadius: 10, paddingHorizontal: 12, backgroundColor: '#f1f3ff', borderWidth: 1, borderColor: colors.border, color: colors.text, fontSize: 17, marginBottom: 8 }, flowAmount: { color: colors.text, fontSize: 30, fontWeight: '700', marginBottom: 12 }, demoCode: { color: colors.primary, fontWeight: '700', fontSize: 17, marginVertical: 8 },
  page: { flex: 1, backgroundColor: colors.bg }, content: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 36, maxWidth: 720, width: '100%', alignSelf: 'center' },
  topbar: { minHeight: 56, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, brand: { color: colors.text, fontSize: 20, fontWeight: '700' }, eyebrow: { color: colors.muted, fontSize: 12, fontWeight: '600', letterSpacing: 1 }, avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.pale, alignItems: 'center', justifyContent: 'center' }, avatarText: { color: colors.primary, fontWeight: '700' },
  greeting: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 22, marginBottom: 24 }, title: { fontSize: 26, lineHeight: 34, fontWeight: '700', color: colors.text }, muted: { color: colors.muted, fontSize: 15, lineHeight: 22 }, iconButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  accountTabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 6, borderRadius: 16, backgroundColor: colors.pale, marginBottom: 16 }, tab: { minHeight: 48, minWidth: 100, flex: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 }, tabSelected: { backgroundColor: colors.white }, tabText: { color: colors.muted, fontSize: 15, fontWeight: '600' }, tabTextSelected: { color: colors.primary },
  balanceCard: { backgroundColor: colors.white, borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: 20, marginBottom: 16 }, accountLabel: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 22 }, tag: { paddingHorizontal: 10, paddingVertical: 6, backgroundColor: colors.pale, borderRadius: 7, color: colors.primary, fontSize: 12, fontWeight: '700' }, balanceLine: { flexDirection: 'row', alignItems: 'baseline', marginTop: 4 }, balance: { flexShrink: 1, color: colors.text, fontSize: 38, fontWeight: '700', letterSpacing: -1.2, fontVariant: ['tabular-nums'] }, currency: { color: colors.muted, fontSize: 15, fontWeight: '600' },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#f1f3ff', borderRadius: 16, padding: 16, marginVertical: 8 }, sectionTitle: { color: colors.text, fontSize: 17, fontWeight: '700' }, activityHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 24, marginBottom: 12 }, listCard: { backgroundColor: colors.white, borderRadius: 16, paddingHorizontal: 16, borderWidth: 1, borderColor: colors.border }, accountRow: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 12 }, divider: { borderTopWidth: 1, borderTopColor: colors.border }, accountIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.pale, alignItems: 'center', justifyContent: 'center' }, rowTitle: { color: colors.text, fontSize: 15, fontWeight: '600', marginBottom: 3 }, rowBalance: { color: colors.text, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  transferEntry: { minHeight: 82, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 16, marginBottom: 16 }, destinationCard: { minHeight: 92, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16, marginBottom: 16 }, destinationIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.pale, alignItems: 'center', justifyContent: 'center' }, beneficiarySection: { marginTop: 4, marginBottom: 20 }, beneficiaryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }, searchWrap: { minHeight: 52, borderRadius: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, marginBottom: 12 }, emptyState: { alignItems: 'center', gap: 10, backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 24, marginVertical: 8 }, link: { color: colors.primary, fontSize: 14, fontWeight: '700' }, offlineHint: { color: colors.muted, fontSize: 13, marginTop: 8 },
  loginContent: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 28, width: '100%', maxWidth: 600, alignSelf: 'center' }, loginBrand: { alignItems: 'center', marginBottom: 28 }, walletMark: { width: 62, height: 62, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.pale, marginBottom: 14 }, loginTitle: { color: colors.text, fontSize: 34, fontWeight: '700', marginTop: 18, textAlign: 'center' }, loginSubtitle: { color: colors.muted, fontSize: 16, lineHeight: 24, textAlign: 'center', marginTop: 8, maxWidth: 360 }, formCard: { backgroundColor: colors.white, borderRadius: 18, padding: 20, borderWidth: 1, borderColor: colors.border }, label: { color: colors.text, fontSize: 15, fontWeight: '600', marginBottom: 8 }, inputWrap: { minHeight: 52, borderRadius: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#f1f3ff', borderWidth: 1, borderColor: colors.border }, input: { flex: 1, minWidth: 0, minHeight: 48, color: colors.text, fontSize: 16 }, button: { minHeight: 50, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 22 }, buttonPressed: { opacity: 0.78 }, buttonText: { color: colors.white, fontSize: 16, fontWeight: '700' }, errorText: { color: colors.error, fontSize: 14, lineHeight: 20, marginTop: 12 }, infoBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: '#f1f3ff', borderRadius: 16, padding: 16, marginTop: 20 }, infoText: { flex: 1, color: colors.muted, fontSize: 14, lineHeight: 21 }, bold: { fontWeight: '700', color: colors.text },
  centered: { flex: 1, minHeight: 180, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, backgroundColor: colors.bg }, privacy: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: colors.bg }, privacyIcon: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.pale, marginBottom: 24 }, center: { textAlign: 'center', maxWidth: 320, marginTop: 10 }, privacyFooter: { position: 'absolute', bottom: 36, color: colors.muted, fontSize: 14, fontWeight: '600' },
});

export default function App() { return <SafeAreaProvider><SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}><QueryClientProvider client={queryClient}><Wallet /></QueryClientProvider></SafeAreaView></SafeAreaProvider>; }
