# Segunda revisión independiente — Billetera MXN

**Veredicto: NO APTO para aceptación final.** El SHA objetivo está publicado y CI pasa. La conciliación de concurrencia quedó demostrada y la recuperación móvil tiene prueba automatizada de restart. Sigue abierto el P2 de recuperación Web después de recargar el navegador; además, las fuentes visuales originales no están disponibles en el checkout remoto y el recorrido nativo móvil continúa bloqueado.

## Identidad verificada

- Rama: `feature/product-mvp`.
- SHA revisado: `82550342a50a972fb19a4de7b772f48cdef8f6d5` (HEAD local y `origin/feature/product-mvp`).
- CI: run [43682693593](https://github.com/jasanhdz/fintech-wallet/actions/runs/43682693593), `success`, `headSha` coincide exactamente con el SHA objetivo.
- Artifact de ese run: `visual-captures-82550342a50a972fb19a4de7b772f48cdef8f6d5`, 51 PNG, 2,895,197 bytes. Descargué e inspeccioné capturas W03, W04 vacío, W10 OTP incorrecto, W11 incierto y W14; inputs, saldos/importe, CLABE/folios y OTP aparecen enmascarados. El artifact contiene capturas de la app, **no** los diseños originales.
- No modifiqué código de producto ni el informe inicial `docs/integration-review.md`. La reproducción Web adicional fue temporal, fuera del repo y no contiene credenciales reales.

## Seguimiento de hallazgos del primer informe

| Hallazgo inicial | Segundo resultado | Evidencia |
|---|---|---|
| **P1 · 100 transferencias concurrentes sin conciliación** | **RESUELTO** | La integración exige 100 respuestas 201, claves/IDs únicos, 5,050 minor units totales, 100 transfer rows, 200 postings, dos opuestos por transfer, neto cero individual/global, saldos source/destination con deltas ±5,050 y uso diario +5,050; 0 rechazo y 0 fila extra. `npm run test:integration` pasó 7/7 en `wallet_test`. No se encontró defecto API. |
| **P1 · README/runbook desactualizado** | **RESUELTO** | README, `.env.example` y `dev:api:testdb` describen URL `/v1`, scopes de base y arranque de smoke test móvil en `wallet_test`. CI verifica migración limpia y test migrator. |
| **P2 · recovery tras reiniciar cliente** | **PARCIAL** | Mobile persiste clave+payload+transfer ID en SecureStore; Jest desmonta/remonta, reintenta el mismo POST y confirma un ID lógico, sin persistir OTP. Web sigue guardando `attempts`/`confirmationAttempts` solo en `Map` en memoria. La reproducción E2E ad hoc confirmó: API procesa el POST y devuelve estado consultable; después de recargar `/transfers/new`, la UI vuelve al formulario nuevo, no conserva la key ni consulta/reintenta el intento original. No hice un segundo envío. **P2 Web abierto.** |
| **P2 · sin branch publicada ni CI** | **RESUELTO para este SHA** | Branch remota verificada; CI run 43682693593 verde exactamente en `82550342…`. Las migraciones CI limpias, suites PostgreSQL, Playwright, build, OpenAPI y upload de artifacts pasaron. |
| **P2 · cobertura visual Web parcial** | **PARCIALMENTE RESUELTO** | 3 pruebas visuales Chromium y E2E real con 51 capturas enmascaradas a 390×844/1440×960. La inspección compara W03/W04 y estados de beneficiario/transferencia/historial/receipt/sesión; no hay comparación pixel-diff. |

## Conciliación de concurrencia: detalle

`api/tests/transfers.integration.ts` captura antes/después balances de origen/destino y el uso diario; parametriza cantidades 1–100 minor units y usa keys únicas. Para la ejecución comprobada:

- 100 solicitudes aceptadas, 100 IDs/transferencias completadas únicas.
- Suma aceptada: 5,050 minor units (MXN 50.50).
- 200 asientos: exactamente dos por transfer; source −amount, destination +amount.
- Neto por transfer y global: 0.
- Delta source balance: −5,050; destination balance: +5,050.
- Delta del uso diario: +5,050; 0 rechazos y 0 filas extra.

La prueba fija un límite de test alto para que las 100 operaciones aceptadas midan concurrencia/saldo y no el rechazo por límite; la suite prueba límite excedido separadamente. Todo se ejecutó con el runtime `wallet_test`; no se reseteó ni sembró `wallet_dev`.

## Recovery tras reinicio

- **Web, automatizado:** el E2E real obtiene la respuesta server-side mediante `route.fetch()`, aborta la primera respuesta al browser y reintenta en la sesión viva con misma key/payload; verifica un único resultado, OTP cuando corresponde, historial y recibo. Ese test **no recarga la página**. La prueba independiente fuera del repo recargó el navegador y observó que la UI pierde la key e ID conocido por el test. API sólo permite consultar por transferId; no hay consulta por idempotency key. La verificación del servidor mediante un actor externo no recupera la operación en la UI.
- **Mobile, automatizado:** `mobile/tests/app.test.tsx` simula commit y pérdida de respuesta, conserva un `Map` de SecureStore entre unmount/remount y verifica replay same key/body, transferencia lógica única, código demo ausente de SecureStore y receipt tras reingresar OTP. La API real tiene cobertura separada de idempotencia en PostgreSQL.
- **Mobile, dispositivo real:** **BLOCKED**. En este host no están `simctl` ni `adb`; export Expo/Jest no son prueba nativa.

## Matriz resumida por pantallas y estados

| Área/pantalla | Implementación | Verificación visual o integrada | Estado segunda revisión |
|---|---|---|---|
| API auth, cuentas, CLABE/beneficiarios | Endpoints/ownership/ledger | PostgreSQL integration 7/7; E2E Web real | PASS |
| W01/W02 login/registro/sesión | Web | Chromium + register/login/logout/reload E2E | PASS |
| W03 cuentas, consolidado, actividad | Web | Comparado con W03; app captures desktop/mobile, feed desde API | PASS visual representativo |
| W04 historial vacío/poblado/filtros/detalle | Web/API | Capturas 390/1440; E2E transferencia aparece y abre detalle | PASS visual representativo |
| W06/W07 directorio, vacío, alta, checksum inválido | Web/API | Capturas y alta real por API/DB | PASS |
| W08/W09 transferencia y revisión | Web | Own-account sin beneficiario y beneficiario real; screenshots | PASS |
| W10 OTP vacío/incorrecto/correcto | Web/API | Wrong code y confirm real en `wallet_test`; capturas enmascaradas | PASS Web actual |
| W11 respuesta incierta/retry | Web/API | POST real procesado, respuesta abortada, retry same key en sesión viva | PASS solo same-page; **FAIL recovery tras reload** |
| W12 recibo interno | Web/API | API real, screenshot y E2E historial/detalle | PASS |
| W13 saldo/límite rechazados | API/Web | API integración y mensajes implementados; no hice recorrido visual dedicado del estado de rechazo | Implementado; visual pendiente |
| W14 sesión vencida/acceso denegado | Web | Sesión vencida capturada; permiso API probado por integración | Sesión PASS; visual de access-denied pendiente |
| M01–M12 login/cuentas/beneficiario/transfer/20 movimientos/privacy | React Native | Jest (6), Expo export y test de restart con SecureStore mock persistente | Código verificado; **device visual/E2E BLOCKED** |
| Diseños fuente W03/W04/M02/M09 | SVGs curados + originales locales | Hashes de HTML/PNG cotejados localmente; CI artifact solo contiene screenshots app | **BLOCKED remoto**: HTML y PNG originales siguen sin versionar; hashes no los sustituyen |

## Acceso a diseños y bloqueo móvil

`docs/design/references/` publica dos esquemas SVG: desktop W03+W04 y mobile-home M02. El README de referencias declara que no son pixel-perfect ni sustituyen HTML/capturas; M09 no tiene SVG. Los originales, incluidos los `code.html` y `screen.png` correspondientes, están intactos bajo `design/` en este checkout local, pero `git ls-tree` confirma que no forman parte del SHA publicado. Los hashes verifican identidad local, no permiten reproducir/inspeccionar el contenido en otro checkout. La segunda revisión visual completa de los exports originales queda **BLOCKED** hasta que se compartan por un canal seguro o se publique una curación adicional sanitizada.

Pasos para dispositivo físico/simulador, que siguen pendientes:

```sh
npm run db:migrate:test
npm run dev:api:testdb
npm run dev:web
EXPO_PUBLIC_API_URL=http://<IP-LAN-DEL-HOST>:3000/v1 npm run dev:mobile
```

Usar teléfono y host en la misma LAN; emulador Android: `http://10.0.2.2:3000/v1`; iOS Simulator: `http://localhost:3000/v1`. Crear perfil demo y beneficiario vía Web; verificar login/reopen, cuentas, 20 movimientos/detalle, transferencia/OTP, cortar red y reiniciar cliente, mismo intento, conciliación visible y privacidad background. `dev:api:testdb` falla cerrado a roles/URL de `wallet_test`; no usar túnel público ni guardar tokens/OTP/CLABE/datos financieros en capturas.

## Estado de los archivos locales

El SHA objetivo y la rama remota permanecen en `82550342a50a972fb19a4de7b772f48cdef8f6d5`. Al cerrar la revisión, el checkout también muestra un cambio local no comprometido en `mobile/tsconfig.json` y los originales `design/` sin seguimiento; ninguno forma parte del SHA auditado. No revertí ni incorporé ese delta local.

El reporte no stagea ese cambio de `mobile/tsconfig.json`: difiere en formato e incluye `include` de Expo generado; queda preservado para que Mobile determine si es intencional. El directorio `design/` tampoco se stagea ni se modifica en esta auditoría.
