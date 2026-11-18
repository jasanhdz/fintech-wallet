# Recorrido móvil nativo — revisión round 4

**Código integrado:** `4392ab8f41ffaca998c19e5b1ae7cea5ac72c182`\
**Estado:** código y verificaciones de compilación completados; inspección visual en teléfono pendiente.

La app usa React Native nativo, no WebView. Este recorrido se limita a observar pantallas y navegación; detente en **Revisión** y no confirmes ni envíes una transferencia durante la aceptación visual. Las referencias y el estado por pantalla están en [`docs/design-fidelity-round4.md`](design-fidelity-round4.md).

## Sesión de revisión en esta Mac

La configuración prevista es API `3200`, Web `5174` y Metro `8082`; comprueba que los servicios estén activos antes de iniciar otros procesos. En teléfono físico, Mac y teléfono deben estar en la misma Wi‑Fi. La IP indicada en el README (`192.168.100.8`) puede cambiar; consulta `ipconfig getifaddr en0` y usa la IP actual.

Expo Go debe abrir `exp://<IP-LAN-del-host>:8082`; la API del teléfono debe ser `http://<IP-LAN-del-host>:3200/v1`. No uses `localhost` desde un teléfono físico. Usa la credencial local de demo descrita en el README. La sesión preparada apunta a `wallet_dev`; no ejecutes seed, migración, reset ni suites automáticas contra esa base.

## Recorrido y capturas solicitadas

Envía capturas sin datos personales o financieros legibles; oculta importes y nombres antes de compartirlas. Indica dispositivo, versión de SO y tamaño de pantalla. Captura las pantallas con el teclado cerrado salvo donde se pida expresamente.

1. **M01 Login:** pantalla inicial completa, antes de iniciar sesión.
2. **M02 Inicio:** captura Cuenta principal y Ahorro seleccionadas. Comprueba el cambio entre ambas.
3. **M03 Movimientos:** lista para las cuentas disponibles; captura el cambio de cuenta y, si aparece, una página adicional.
4. **M04 Detalle:** abre un movimiento existente. No compartas los valores visibles sin ocultarlos.
5. **M05 Beneficiarios:** abre el selector y captura lista/búsqueda. No registres ni edites beneficiarios.
6. **M06 Datos:** inicia el flujo de transferencia, revisa el formulario y el teclado abierto; vuelve a cerrarlo.
7. **M07 Revisión:** avanza hasta el resumen, captura y detente. No pulses Confirmar/Enviar.
8. **M12 Privacidad:** con una sesión ya iniciada, manda la app al fondo y vuelve para comprobar la capa de privacidad y revalidación.

OTP (M08), recuperación de intento (M09), recibo (M10) y rechazo (M11) requieren un intento de transferencia o un resultado financiero. No los generes en `wallet_dev` durante esta revisión visual; están cubiertos por pruebas sintéticas en `wallet_test`, no por capturas nativas de dispositivo.

Al responder, anota por pantalla: **fiel**, **diferencia** (describe ubicación/tamaño/color) o **no revisada**. La fidelidad móvil solo se considerará inspeccionada después de recibir y revisar estas capturas; exportación, lint y pruebas unitarias no sustituyen esta validación.
