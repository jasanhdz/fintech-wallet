const h = require('./lib.cjs'); const { L } = h;
(async () => {
  const run = 'a' + Date.now().toString().slice(-6);
  const u = await h.seedUsers(run);
  const expSent = h.psql(`select to_char(t.created_at at time zone 'America/Mexico_City','DD/MM/YYYY HH24:MI') from transfers t join users x on x.id=t.owner_id where x.email='${u.ana.email}' and t.reference='131126'`);
  L('expected local (America/Mexico_City) of sent transfer:', expSent, '| raw UTC:', h.psql(`select t.created_at from transfers t join users x on x.id=t.owner_id where x.email='${u.ana.email}' and t.reference='131126'`));
  const browser = await h.chromium.launch();
  const variants = {
    'normal-tz-Tokyo': { tz: 'Asia/Tokyo' },
    'normal-tz-LosAngeles': { tz: 'America/Los_Angeles' },
    'hermes-parts-literal-only': { init: () => { const o = Intl.DateTimeFormat.prototype.formatToParts; Intl.DateTimeFormat.prototype.formatToParts = function (d) { return [{ type: 'literal', value: '8/11/2026' }]; }; } },
    'hermes-parts-undefined-values': { init: () => { Intl.DateTimeFormat.prototype.formatToParts = function (d) { return ['day', 'month', 'year', 'hour', 'minute'].map((t) => ({ type: t, value: undefined })); }; } },
    'hermes-parts-reordered-and-wrongzone': { init: () => { const o = Intl.DateTimeFormat.prototype.formatToParts; Intl.DateTimeFormat.prototype.formatToParts = function (d) { return o.call(this, d).reverse(); }; const ro = Intl.DateTimeFormat.prototype.resolvedOptions; Intl.DateTimeFormat.prototype.resolvedOptions = function () { const r = ro.call(this); r.timeZone = 'UTC'; return r; }; } },
    'hermes-parts-garbage-values': { init: () => { Intl.DateTimeFormat.prototype.formatToParts = function (d) { return [{ type: 'day', value: 'de' }, { type: 'month', value: 'xx' }, { type: 'year', value: '2026' }, { type: 'hour', value: '99' }, { type: 'minute', value: 'NaN' }]; }; } },
    'intl-formatToParts-throws': { init: () => { Intl.DateTimeFormat.prototype.formatToParts = function () { throw new RangeError('x'); }; } },
    'intl-absent': { init: () => { try { delete globalThis.Intl; } catch {} Object.defineProperty(globalThis, 'Intl', { value: undefined, configurable: true }); } },
  };
  let first = true;
  for (const [name, opts] of Object.entries(variants)) {
    const p = await h.newPage(browser, { h: 1000, ...opts });
    try {
      await h.login(p, u.ana.email);
      await p.getByRole('tab', { name: /Movimientos/ }).click(); await p.waitForTimeout(1200);
      await h.fs.writeFileSync(`${h.SP}/shots/A-${name}-list.txt`, await p.text());
      await p.getByRole('button', { name: /^Abono \$1,000\.00/ }).first().click(); await p.waitForTimeout(1200);
      const recv = await p.shot(`A-${name}-recibida`);
      await p.btn('Volver a movimientos').click(); await p.waitForTimeout(800);
      await p.getByRole('button', { name: /^Cargo \$850\.00/ }).first().click(); await p.waitForTimeout(1500);
      const sent = await p.shot(`A-${name}-enviada`);
      const pick = (t) => t.split('\n').filter((l) => /hrs|\d{1,2}:\d\d|Fecha|nov/i.test(l)).join(' / ');
      L(`A ${name} RECIBIDA dates: ${pick(recv)}`); L(`A ${name} ENVIADA dates: ${pick(sent)}`);
    } catch (e) { L(`A ${name} ERROR ${e.message.split('\n')[0]}`); }
    await p.context().close();
    await new Promise((r) => setTimeout(r, 7000));
  }
  // list view dates (day headings) for normal tz
  L('list text sample:', h.fs.readFileSync(`${h.SP}/shots/A-normal-tz-Tokyo-list.txt`, 'utf8').split('\n').filter(Boolean).slice(0, 25).join(' | '));
  // Invalid / absent timestamps via response rewriting
  const bads = { 'invalid-string': 'not-a-date', 'null': null, 'absent': undefined, 'feb30': '2026-02-30T10:00:00.000Z', 'empty': '' };
  for (const [name, val] of Object.entries(bads)) {
    const p = await h.newPage(browser, { h: 1000 });
    await p.route(/\/v1\/accounts\/[^/]+\/movements/, async (route) => { const r = await route.fetch(); const j = await r.json(); j.items.forEach((m) => { if (val === undefined) delete m.occurredAt; else m.occurredAt = val; }); await route.fulfill({ response: r, json: j }); });
    await p.route(/\/v1\/transfers\/[0-9a-f-]{36}$/, async (route) => { const r = await route.fetch(); const j = await r.json(); for (const k of ['createdAt', 'completedAt']) { if (val === undefined) delete j[k]; else j[k] = val; } await route.fulfill({ response: r, json: j }); });
    try {
      await h.login(p, u.ana.email);
      await p.getByRole('tab', { name: /Movimientos/ }).click(); await p.waitForTimeout(1200);
      const list = await p.shot(`A-bad-${name}-list`);
      await p.getByRole('button', { name: /^Cargo \$850\.00/ }).first().click(); await p.waitForTimeout(1500);
      const sent = await p.shot(`A-bad-${name}-enviada`);
      L(`A bad ${name}: sent lines: ${sent.split('\n').filter((l) => /hrs|Fecha|nov|Invalid/i.test(l)).join(' / ') || '(none)'} | list headings: ${list.split('\n').filter((l) => /Hoy|Ayer|Fecha|nov|Invalid/i.test(l)).slice(0,3).join(' / ')}`);
    } catch (e) { L(`A bad ${name} ERROR ${e.message.split('\n')[0]}`); }
    await p.context().close(); await new Promise((r) => setTimeout(r, 7000));
  }
  // Receipt (M10) after a fresh transfer
  const p = await h.newPage(browser, { h: 1150, tz: 'Asia/Tokyo' }); await h.login(p, u.ana.email);
  await h.toDetails(p, 'Carlos'); await h.fill(p, '120.50', 'Libros', '552211');
  await p.getByRole('button', { name: /^Continuar[^a-zA-Z]*$/ }).click(); await p.waitForTimeout(800);
  await p.btn('Confirmar transferencia').click(); await p.waitForTimeout(3000);
  const rc = await p.shot('A-M10-recibo');
  L('A M10 receipt lines:', rc.split('\n').filter(Boolean).join(' | ').slice(0, 700));
  L('A DB local time of that transfer:', h.psql(`select to_char(t.completed_at at time zone 'America/Mexico_City','DD/MM/YYYY HH24:MI') from transfers t join users x on x.id=t.owner_id where x.email='${u.ana.email}' and t.reference='552211'`));
  L('errors:', p.errs.length);
  await browser.close();
  h.fs.writeFileSync(`${h.SP}/ev/s1-dates.txt`, h.log.join('\n'));
})().catch((e) => { console.error(e); process.exit(1); });
