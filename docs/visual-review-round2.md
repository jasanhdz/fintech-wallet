# Revisión visual web — ronda 2

Esta revisión acompaña la integración final y no es una aprobación pixel-perfect. Se comparó la jerarquía de pantallas y estados contra los originales aprobados; los SVG curados son guías estructurales, no sustitutos de capturas o HTML.

## Integridad de las fuentes

Las fuentes locales `design/` siguen intactas y sin seguimiento Git. Los SHA-256 del screenshot y `code.html` en `docs/design/references/README.md` se recalcularon y coinciden para W03, W04, M02 y M09. No se copiaron, modificaron ni publicaron los HTML/capturas originales.

- `web-desktop.svg` esquematiza W03 y W04.
- `mobile-home.svg` esquematiza M02; **no representa M09**.
- Las exportaciones HTML/capturas originales permanecen en sus rutas bajo `design/`; la copia M09 sigue disponible localmente, pero el cliente móvil no se visualizó en dispositivo.

## Comparación e implementación

- **W03 Inicio/cuentas:** se añadió rail lateral de escritorio, navegación compacta para móvil, saldo consolidado calculado con `BigInt`, tarjetas de cuentas propias y actividad reciente real desde la API. En móvil, actividad bajo el pliegue tiene captura adicional después de scroll.
- **W04 Historial:** se verificaron tabla, filtros fecha/tipo, estados vacío/poblado y detalle. La implementación selecciona la cuenta navegando desde `/accounts/:accountId/movements`, conforme al contrato; no imita el selector de cuenta visual del export. Los movimientos usan el cursor keyset de la API.
- **W06/W07:** directorio vacío y poblado, formulario y error de checksum se capturaron; la CLABE y campos se enmascaran en screenshots.
- **W08/W09/W10/W11/W12:** formulario, revisión, OTP vacío/incorrecto, resultado incierto tras respuesta perdida y comprobante interno. `OTP_THRESHOLD_MINOR=1` se pasó solo al proceso de Playwright para hacer visible el desafío durante la prueba; no cambia `.env`, producción ni la política demo configurada.
- **W14:** se capturó la pantalla de sesión vencida en Chromium.
- Canvas/primario y texto se alinearon a tokens YAML aprobados (`#f9f9ff`, `#0037b0`, `#141b2c`, `#434655`). No se incorporó el copy de conexiones SPEI/CEP de los exports.

## Capturas y reproducción

`OTP_THRESHOLD_MINOR=1 npm run test:e2e` genera capturas en `test-results/visual/` a viewports **390×844** y **1440×960**; E2E terminó 4/4 con API/PostgreSQL reales. `npm run test:visual` cubre login, registro y sesión vencida (3/3). Los PNG están ignorados y no forman parte del commit; se enmascaran saldos/importes, saldo consolidado, CLABE, OTP, referencias/folios y campos. El workflow CI sube únicamente `test-results/visual/*.png` como artifact `visual-captures-<SHA>` con retención de 7 días; no sube HTML fuente ni trazas. Los artefactos locales pueden regenerarse con esos comandos.

Las capturas son revisión visual de pantallas Web en Chromium, no comparación automatizada por píxel. Los exports originales siguen siendo la referencia primaria y los SVG una síntesis adicional. **La comparación visual móvil nativa permanece BLOCKED** hasta disponer de teléfono o simulador; Expo export no cuenta como verificación de dispositivo.
