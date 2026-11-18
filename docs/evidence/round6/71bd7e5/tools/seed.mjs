// Seeds coherent TEST data in wallet_test through the isolated API. Test-only credentials, never real data.
// G4: ports from G4_API_PORT / G4_WEB_PORT; the seed file (it holds the test password) goes to G4_SEED_DIR, outside the repo.
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const API = `http://127.0.0.1:${process.env.G4_API_PORT || '3793'}/v1`; const ORIGIN = `http://localhost:${process.env.G4_WEB_PORT || '8793'}`;
const run = process.argv[2] ?? String(Date.now()).slice(-6);
const PASSWORD = process.env.G4_TEST_PASSWORD; if (!PASSWORD) throw new Error('Set G4_TEST_PASSWORD (any test-only value)');
const SEED_DIR = process.env.G4_SEED_DIR; if (!SEED_DIR) throw new Error('Set G4_SEED_DIR (a directory outside the repository)');
async function register(fullName, email) {
  const csrf = await fetch(`${API}/auth/csrf`, { headers: { origin: ORIGIN } });
  const cookie = csrf.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const { csrfToken } = await csrf.json();
  const res = await fetch(`${API}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken, origin: ORIGIN, cookie }, body: JSON.stringify({ fullName, email, password: PASSWORD }) });
  if (!res.ok) throw new Error(`register ${res.status} ${await res.text()}`);
  return (await res.json()).accessToken;
}
const api = async (token, path, init = {}) => {
  const res = await fetch(`${API}${path}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...init.headers } });
  const body = res.status === 204 ? null : await res.json();
  if (!res.ok) throw new Error(`${path} ${res.status} ${JSON.stringify(body)}`);
  return body;
};
const transfer = (token, body) => api(token, '/transfers', { method: 'POST', headers: { 'Idempotency-Key': randomUUID() }, body: JSON.stringify(body) });
const ana = { email: `ana.g4.${run}@example.test` }; const carlos = { email: `carlos.g4.${run}@example.test` };
ana.token = await register('Ana López', ana.email); carlos.token = await register('Carlos Ruiz', carlos.email);
const aAcc = (await api(ana.token, '/accounts')).items; const cAcc = (await api(carlos.token, '/accounts')).items;
const principal = aAcc.find((a) => a.kind === 'checking'); const savings = aAcc.find((a) => a.kind === 'savings');
const carlosMain = cAcc.find((a) => a.kind === 'checking') ?? cAcc[0];
const own = await api(ana.token, '/beneficiaries', { method: 'POST', body: JSON.stringify({ name: 'Cuenta de ahorro demo', alias: 'Ahorro demo', clabe: savings.clabe }) });
const toCarlos = await api(ana.token, '/beneficiaries', { method: 'POST', body: JSON.stringify({ name: 'Carlos Ruiz', alias: 'Carlos', clabe: carlosMain.clabe }) });
const toAna = await api(carlos.token, '/beneficiaries', { method: 'POST', body: JSON.stringify({ name: 'Ana López', alias: 'Ana', clabe: principal.clabe }) });
await transfer(carlos.token, { sourceAccountId: carlosMain.id, destinationType: 'beneficiary', beneficiaryId: toAna.id, amountMinor: '100000', concept: 'Abono honorarios', reference: '994012' });
await transfer(ana.token, { sourceAccountId: principal.id, destinationType: 'beneficiary', beneficiaryId: toCarlos.id, amountMinor: '85000', concept: 'Comida', reference: '131126' });
await transfer(ana.token, { sourceAccountId: principal.id, destinationType: 'beneficiary', beneficiaryId: own.id, amountMinor: '150000', concept: 'Ahorro mensual', reference: '661099' });
const after = (await api(ana.token, '/accounts')).items.map((a) => ({ id: a.id, name: a.name, kind: a.kind, balance: a.availableBalanceMinor }));
const out = { run, ana: { email: ana.email }, carlos: { email: carlos.email }, password: PASSWORD, principalId: principal.id, savingsId: savings.id, ownBeneficiaryId: own.id, ownAccountIdOnBeneficiary: own.ownAccountId ?? null, carlosBeneficiaryId: toCarlos.id, after };
writeFileSync(`${SEED_DIR}/seed-${run}.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ ...out, password: '(test-only, in seed file)' }));
