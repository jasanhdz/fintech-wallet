# Ronda 7 · tanda H3 (pasada 8) — evidencia del Generator (código `ed4945e`)

Hallazgos corregidos: F-21 (major), F-22, F-24, F-25, F-15; F-23 sólo documentación (`docs/round7-notes.md` §1). Commits:
`9a74e05` (F-21, F-22), `69edf36` (F-24), `fb7a2ca` (F-25), `ed4945e` (F-15), `890b371` (docs F-23 y notas).
"Antes" = bundle de `261decc` (= `1302862` en `mobile/`), "después" = bundle de `ed4945e` (mismo hash de bundle web
`index-25b0a1a0…` que el export de verificación de `ed4945e`).

**No es evidencia nativa** (sin simulador/iPhone; F-05): todo lo visual es el export web de Expo (RN-Web) en Chromium
390 px @2x; el 200 % es la aproximación CSS de `fontScale` usada por el evaluador.

## Niveles y resultados

| Nivel | Qué | Resultado |
|---|---|---|
| Unit (jest, RN) | raíz `npm run lint`, `npm run typecheck`, `npm test` | exit 0 los tres; mobile **160/160** (151 previas + 9 nuevas; `logs/jest-mobile.txt`), web 20/20, api 7/7, shared 4/4 (`logs/root-*.txt`). |
| Pruebas que fallan sin el cambio | las 11 pruebas nuevas/cambiadas de H3 contra `mobile/App.tsx` de `261decc` | **11/11 fallan** (`logs/jest-new-tests-on-261decc.txt`). |
| Integración real (API + PostgreSQL `wallet_test`) | `tools/h3-f21.cjs`, `tools/h3-threshold.cjs` sobre API propia | ver abajo; BD consultada con `psql` en `wallet_test`. |
| Render web (RN-Web) | `tools/h3-f21.cjs`, `tools/h3-layout.cjs`, `tools/h3-compose.cjs` | ver abajo; 0 desbordes horizontales, texto mínimo 12 px. |
| Exports | `expo export --platform web` y `--platform ios` de `ed4945e` | exit 0 (`logs/export-*.txt`); el `.hbc` de iOS contiene las cadenas nuevas (`logs/ios-bundle-strings.txt`). |
| Nativo | Hermes/SecureStore/AppState/teclado/Dynamic Type/safe area reales | **no verificado** (F-05). |

## F-21 / F-22 (`logs/h3-f21-antes.txt`, `logs/h3-f21-despues.txt`)

Escenario del evaluador (`eval-1302862/tools/ui-m02-m09.cjs`, segundo bloque): Principal → "Cuenta de ahorro demo",
$300.25, la respuesta del `POST /transfers` se pierde **después** de aplicarse (Playwright `route.fetch` + `abort`).

- **Antes**: Inicio muestra el aviso y además "Continuar con transferencia" (`continuar:1`); el segundo intento usa otra llave
  (`distinct 2`): BD `completed:30025 | completed:30025`, 4 asientos, Principal 1,000,000 → 939,950 (**débito 60,050**).
- **Después, A** (sólo se pierde la respuesta original): al mostrarse Inicio la app consulta el intento con la **misma llave**
  (2 `POST`, `distinct 1`), muestra el comprobante real y borra el registro; al volver a Inicio el flujo está otra vez
  disponible (`continuar:1`). BD `completed:30025`, 2 asientos suma 0, **débito 30,025**.
- **Después, B** (también se pierden las consultas de Inicio): Inicio bloqueado — `continuar:0, transferir:0, cambiar:0,
  verificar:1`, "Sin respuesta por ahora"; ir a Movimientos y volver mantiene el bloqueo; **"Cerrar sesión" conserva el
  registro**; al reentrar se reanuda con la misma llave y llega al comprobante. 4 `POST`, 1 llave, 1 transferencia, débito 30,025.
- **Después, C (F-22)**: A deja un intento sin resolver y cierra sesión; B entra en el mismo navegador (no ve nada de A),
  transfiere $10.00 y cierra sesión: el registro de A (`wallet.transfer-recovery.<idA>`) queda **idéntico**; A entra, se
  reanuda con su llave original y termina con 1 transferencia y 1 débito (30,025); B con la suya (1,000).

Regla elegida (documentada en `docs/round7-notes.md` §6 y §10): ningún cierre de sesión borra registros de recuperación; un
registro por usuario; sólo se borra cuando la API informa el intento resuelto.

Nota de proceso: una primera corrida del bloque B esperaba que Inicio siguiera bloqueado tras volver de Movimientos, pero la
consulta automática de Inicio (ya sin pérdida simulada) resolvió el intento y mostró el comprobante — comportamiento correcto;
el script se ajustó para mantener la pérdida simulada hasta después del cierre de sesión.

## F-15, F-24, F-25 (`logs/h3-layout-antes.txt`, `logs/h3-layout-despues.txt`)

- **F-15** (M07 con "Cuenta principal" → "Cuenta de ahorro demo", sin desplazar): umbral $6,000.00 a 390x844 antes
  762-810 / **818-862 (fuera)**, después **720-768 / 776-820**; a 884: 802-850 / 858-902 → 760-808 / 816-860; a 763: 681-729 /
  737-781 → 639-687 / 695-739. Normal y propias sin cambio y dentro a 844/884/763. Tamaños de texto de M07 umbral: 12, 14,
  16, 36 px (antes y después).
- **F-24** (pegar en M08 con `keyboard.insertText`; cadenas sintéticas, no el código real): antes `12 34-56` → 4 dígitos,
  `12a3456789` → 5 (`maxlength=6`); después ambas → 6 dígitos (`maxlength` ausente, `autocomplete=one-time-code`).
- **F-25** (iniciales "AL"): a 200 % en Inicio antes texto 36x40 en un círculo de 32x32 (**fuera**), después 36x40 dentro de
  44x40; en M07 31x32 dentro de 39x32. 0 botones < 44 px y `scrollWidth` 390 en ambos.

## F-23 (`logs/h3-threshold.txt`)

Política por defecto (`otpThresholdMinor` 500000, `demoOnly` true): 499999 → 201 `completed`; 500000 → 202
`awaiting_confirmation`; 500001 → 202. Sin cambio de regla; requiere decisión del Coordinador/producto (§1 de las notas).

## Capturas

`shots/*.txt` (texto visible, con números de 6 dígitos enmascarados) se versionan; `shots/*.png` y `lado-a-lado/*.jpg`
quedan locales por `.gitignore` (`*.png`, `*.jpg`), como en las evidencias anteriores. Comparaciones lado a lado: F-21 (Inicio
tras M09; segundo intento antes vs Inicio bloqueado después; flujo rehabilitado), F-15 (M07 umbral 844), F-25 (Inicio y M07
a 200 %). Ninguna captura incluye el código de demostración (no se capturó M08). Observación fuera de alcance: a 200 % CSS
el saldo grande se trunca ("$10,…") porque RN-Web no implementa `adjustsFontSizeToFit`; ya ocurría antes.

## Reproducir

```sh
npm run db:migrate:test
API_PORT=3911 WEB_ORIGIN=http://localhost:8911 npm run dev:api:testdb      # API "después" y registro de usuarios
API_PORT=3912 WEB_ORIGIN=http://localhost:8912 npm run dev:api:testdb      # API para el bundle "antes" (CORS 8912)
cd mobile && EXPO_PUBLIC_API_URL=http://127.0.0.1:3911/v1 CI=1 npx expo export --platform web --output-dir <scratch>/dist-after
git show 261decc:mobile/App.tsx > App.tsx && EXPO_PUBLIC_API_URL=http://127.0.0.1:3911/v1 CI=1 npx expo export --platform web --output-dir <scratch>/dist-before && git checkout App.tsx
python3 -I docs/evidence/round6/71bd7e5/tools/patch.py <scratch>/dist-after   # shim de SecureStore sólo en la copia exportada
python3 -I docs/evidence/round6/71bd7e5/tools/patch.py <scratch>/dist-before
python3 -I -m http.server 8911 --bind 127.0.0.1 -d <scratch>/dist-after
python3 -I -m http.server 8912 --bind 127.0.0.1 -d <scratch>/dist-before     # sus llamadas a 3911 se reescriben a 3912
export EV_TEST_PASSWORD=<valor de prueba>
EV_OUT=<dir> H3_VARIANT=before node tools/h3-f21.cjs ; EV_OUT=<dir> H3_VARIANT=after node tools/h3-f21.cjs
EV_OUT=<dir> H3_VARIANT=before node tools/h3-layout.cjs ; EV_OUT=<dir> H3_VARIANT=after node tools/h3-layout.cjs
EV_OUT=<dir> node tools/h3-threshold.cjs ; node tools/h3-compose.cjs <dir>
```

Sólo `wallet_test`; no se usaron `wallet_dev`, Lucem ni los puertos 3200/5174/8083; los procesos propios se terminaron.
Usuarios sintéticos `*.h3.*@example.test`.
