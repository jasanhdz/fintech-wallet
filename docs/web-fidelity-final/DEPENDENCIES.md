# Dependencias de la ronda Web «fidelidad final» (estado)

| ID | Necesidad | Decisión del coordinador | Estado en la rama |
|---|---|---|---|
| DEP-1 | Fuente Inter sin CDN | Aprobado: copiar los TTF OFL de `@expo-google-fonts/inter@0.4.2` (ya en `node_modules`) | Hecho en WF-T0: `web/public/fonts/inter/Inter-{400,500,600,700}.ttf` + `OFL.txt` (el paquete no trae WOFF; sólo TTF). Sin cambios de `package.json`. |
| DEP-2 | Tipos RFC 7807 específicos (OTP, saldo, límite) | No se piden | La Web sigue distinguiendo por `status` + `detail` del contrato actual. |
| DEP-3 | Reenvío de OTP | No se pide | Sin «Solicitar nuevo código» (E-W10-1). |
| DEP-4 | Decisión sobre H-W1…H-W5 | Esta ronda congela el comportamiento de red | Escalado en `ESCALATIONS.md` (H-W4 crítico). |
| DEP-5 | `@axe-core/playwright` | No se añade | Comprobaciones propias (`web/e2e-final/helpers/contrast.ts`, geometría). |
| DEP-6 | `web/e2e-final` en CI | No tocar CI | Pendiente del coordinador. |
| DEP-7 | Integración 0.4.0 | Fuera de ronda (`[P]`) | Sin UI preparada. |
| D-12 | `POST /cancel` en «Volver a revisar» | Diferido | Sin delta en la traza dorada. |

## Dependencias detectadas por el Generator en WF-T0

- **Node**: el `node` del PATH por defecto es `v26.3.0` (Homebrew); `.nvmrc` exige `26.13.1`, disponible en
  `~/.nvm/versions/node/v26.13.1`. Todos los comandos de la ronda anteponen ese `bin` al `PATH`.
- **Chromium**: Playwright 1.65.1 lanza `chromium_headless_shell-1255` (ya en disco); el SPEC menciona
  `chromium-1248`. No se descargó nada.
- **`@fintech-wallet/shared`**: el `node_modules` raíz es symlink al checkout principal, así que la Web compila
  contra `packages/shared` del checkout principal. Verificado idéntico a `packages/shared` de esta rama
  (`diff -rq` vacío) al empezar WF-T0; si el coordinador regenera shared a 0.4.0 en el checkout principal,
  las compilaciones de esta ronda lo verían.
- **Lint/typecheck de `web/e2e-final`**: los scripts de `web/package.json` (`lint`: `src tests e2e`;
  `typecheck`: `web/tsconfig.json`) no cubren `web/e2e-final`. Se verifica aparte con
  `npx eslint web/e2e-final` y `npx tsc -p web/e2e-final/tsconfig.json`. Incluirlo en los scripts
  requiere editar `web/package.json` (propiedad del coordinador).

## Dependencias detectadas por el Generator en WF-T1

- **DEP-W1 (api.ts, congelado en esta ronda)**: `request()` responde a **cualquier** 401 —también el de
  `POST /v1/auth/login` con credenciales incorrectas— con un intento de refresh (`POST /v1/auth/refresh`) y, sin
  sesión que refrescar, lanza un `Error` genérico «La sesión ya no está disponible…». La Web lo traduce en W01 a
  «Correo o contraseña incorrectos.» (`web/src/auth-forms.ts`, `loginFailure`), pero cada login fallido consume
  además una petición del limitador de refresh. Propuesta para la ronda de recuperación/coordinador: excluir
  `/auth/login` y `/auth/register` del refresh automático en `web/src/api.ts`. No se cambió `api.ts` (afecta al
  reintento con la misma `Idempotency-Key`, punto 3 de §7.3.2).
- **SPEC W14-V1/V2**: tres medidas del SPEC no corresponden a la referencia aprobada (unidades de PNG sin dividir
  por DPR); detalle y decisión pedida en `EXCEPTIONS.md`.
- Sin dependencias nuevas de contrato 0.4.0 en W01/W02/W14.

## Dependencias detectadas por el Generator en WF-T2

- Sin dependencias nuevas de paquetes ni de contrato. W03–W05 usan sólo 0.3.0 (`Movement.counterparty`,
  `MovementCounterparty.ownAccountId`, `TransferPolicy.businessDate/businessTimeZone`, estados `expired`/`cancelled` en W05).
- `static-checks.mjs` (WF-T0) exigía `git diff f0ed4bc -- web/src/transfer-attempt.ts` vacío; REC-01 del SPEC permite **un**
  accesor read-only. Se ajustó la comprobación a la regla del SPEC (sin líneas eliminadas, ≤ 1 export nuevo, sin escrituras
  de almacenamiento en lo añadido); el accesor es `readActiveTransferContext`.
- FN-12 se cumple con un enlace «Ver movimientos» en el comprobante W12 actual (`transfers.tsx`, sólo navegación); el
  rediseño de W12 (WF-T5) debe conservarlo.
- `[P]` 0.4.0: el aviso de W03 sigue alimentado sólo por el registro local de la pestaña (H-W3); sin UI preparada.

## Dependencias detectadas por el Generator en WF-T3

- Sin dependencias nuevas de paquetes ni de contrato. W06/W07 usan sólo 0.3.0: `GET /v1/beneficiaries`,
  `POST /v1/beneficiaries` (201, 400, 404 «No se encontró una cuenta interna.», 409 «El beneficiario ya está registrado.»,
  422 dígito verificador) e `isValidClabe` de `@fintech-wallet/shared`. «Duplicado» y «destino no disponible» salen de
  respuestas reales del contrato actual (FN-02 `[I]`); no queda nada `[P]` en esta tanda.
- **DEP-2 (informativo)**: la Web distingue los estados de W07 sólo por `status`; si el contrato añadiera más causas al
  mismo estado (p. ej. otro 404 o 409 en `POST /beneficiaries`) se mostrarían con la copia de W07-V6/V7.
- Helpers de prueba (sin cambiar lo que comprueban): `a11yBasics`/`tabOrder` esperan a que terminen las transiciones CSS
  (0.01 ms con movimiento reducido) antes de leer colores y anillos de foco; bajo carga se leía un valor intermedio
  (anillo de 3 px blanco del «Saltar al contenido», botón a medio cambiar de color). `side-by-side.ts` añade la
  composición contra `code.html` sin red para variantes sin PNG (§5.11).
- `web/e2e/product.spec.ts` (legacy): selectores actualizados a W06/W07 aprobados (h1 «Mis beneficiarios» y «Agregar nuevo
  beneficiario», etiquetas del SPEC, ayuda lateral en lugar de la vista previa retirada, copia del dígito verificador,
  aviso «Beneficiario “…” agregado.», máscara `•••• NNNN`). Se mantienen todas las aserciones (orden de tabulación,
  dos columnas a 1440, acciones dentro de `main`, ≥ 85 % del ancho, CLABE completa nunca visible) y se añade que la
  máscara 3+4 de la API tampoco aparece.

## Dependencias detectadas por el Generator en WF-T4

- Sin dependencias nuevas de paquetes ni de contrato. W08/W09/W13 usan 0.3.0: `GET /v1/transfer-policy`
  (`dailyRemainingMinor`, `otpThresholdMinor`, `dailyLimitMinor`, `dailyUsedMinor`, `businessTimeZone`, `demoOnly`),
  `Beneficiary.ownAccountId`/`destinationAccountId` (D-7), `GET /v1/accounts` tras el rechazo.
- **DEP-2 (vigente)**: W13 depende del `detail` literal «Saldo insuficiente.» / «Se excedió el límite diario.» (con 422/429).
  Un tipo RFC 7807 específico evitaría el mapeo por texto.
- **H-W4 (sin cambios, escalado)**: W13 afirma «No se realizó ningún cargo por este intento» porque el servidor respondió
  422/429 a ese envío; el riesgo de concurrencia con la misma clave sigue descrito en `ESCALATIONS.md`.
- Pruebas: `helpers/contrast.ts` acepta colores `color(srgb …)` (valor computado de `color-mix`), `helpers/screen.ts`
  considera propios los puertos P3/P4 de §5.10. `golden/driver.ts`, `t2-integration`, `t3-beneficiaries` (W06-F1) y los
  tres specs legacy cambian sólo selectores/copias por el rediseño (selects → radiogroups, «Enviar transferencia» →
  «Confirmar transferencia», «Transferencia no realizada» → títulos de W13, «Editar datos» → «Modificar monto»); se
  conservan las aserciones de idempotencia, un solo POST con doble clic, orden de tabulación y desbordamiento. En
  `w13-rejections.spec.ts` la aserción «sin uso acumulado» se sustituye por las cifras reales de la política (W13-V4 las
  exige ahora).

## Dependencias detectadas por el Generator en WF-T5

- **DEP-7 (decisión del coordinador aplicada)**: `web/e2e-final/fixtures/data.ts` añade `sendEpoch: '0'` a la política sintética
  (compatible con los tipos compartidos 0.3.0 y 0.4.0); `tsc -p web/e2e-final` vuelve a pasar. La app no lee `sendEpoch` ni usa
  endpoints/cabeceras 0.4.0.
- **DEP-2 (vigente)**: W10 distingue «Código incorrecto.» (422), «El código expiró.» (422) y «Se agotaron los intentos.» (429) por
  `status` + `detail` literal de `api/src/transfers/service.ts`.
- **DEP-3 / E-W10-1**: sin «Solicitar nuevo código».
- **D-12 (diferido) / E-W10-2 / H-W6**: sin «Volver a revisar» en W10; ver ESCALATIONS.
- **H-W5**: el 409 de `confirm` ya consulta `GET /v1/transfers/{id}` y muestra el estado real (W12 si `completed`); la traza no-GET no cambia.
- Sin dependencias nuevas de paquetes. Iconos nuevos en `ICONS.md`.
