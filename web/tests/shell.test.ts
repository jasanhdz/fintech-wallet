import assert from 'node:assert/strict';
import { test } from 'node:test';
import { titleForPath } from '../src/App.js';
import { clabeTail, initialsOf } from '../src/components.js';

test('SH-08 maps every route to its document title', () => {
  const id = '9c4a0000-0000-4000-8000-000000000401';
  assert.equal(titleForPath('/login'), 'Iniciar sesión · Billetera MXN');
  assert.equal(titleForPath('/register'), 'Crear cuenta · Billetera MXN');
  assert.equal(titleForPath('/accounts'), 'Inicio · Billetera MXN');
  assert.equal(titleForPath(`/accounts/${id}/movements`), 'Movimientos · Billetera MXN');
  assert.equal(titleForPath(`/transfers/${id}/movement-receipt`), 'Comprobante · Billetera MXN');
  assert.equal(titleForPath(`/transfers/${id}/receipt`), 'Comprobante · Billetera MXN');
  assert.equal(titleForPath('/beneficiaries'), 'Beneficiarios · Billetera MXN');
  assert.equal(titleForPath('/beneficiaries/new'), 'Nuevo beneficiario · Billetera MXN');
  assert.equal(titleForPath('/transfers/new'), 'Transferir · Billetera MXN');
  assert.equal(titleForPath(`/transfers/${id}/status`), 'Transferir · Billetera MXN');
  assert.equal(titleForPath('/session-expired'), 'Sesión vencida · Billetera MXN');
  assert.equal(titleForPath('/access-denied'), 'Acceso no disponible · Billetera MXN');
  assert.equal(titleForPath('/otra'), 'Página no encontrada · Billetera MXN');
});

test('SH-04 initials use two letters and the account tail never exposes the full CLABE', () => {
  assert.equal(initialsOf('Persona Prueba Uno'), 'PP');
  assert.equal(initialsOf('ana'), 'AN');
  assert.equal(initialsOf('  '), '');
  assert.equal(clabeTail('646•••••••••••7316'), '7316');
  assert.equal(clabeTail(undefined), '');
});
