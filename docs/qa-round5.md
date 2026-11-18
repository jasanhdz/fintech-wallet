# Revisión de capturas y QA — ronda 5

## Identidad y configuración evaluadas

- SHA base observado antes de corregir: `c116cef8e86b446087a33b6c339aa0555530c9d9` (`feature/product-mvp`).
- Demo manual: checkout raíz, `.env` local, API `3200`, Web `5174`, Metro `8082`, PostgreSQL `wallet_dev` en `55432`.
- Node observado en shell: `26.3.0`; `.nvmrc` requiere `26.13.1`. El reporte marca el runtime no coincidente como **BLOCKED** aunque intente ejecutar las suites para diagnóstico. CI instala Node `26.13.1`.
- Pruebas de integración, Playwright y fixtures financieras usan exclusivamente `wallet_test` y sus guards. Esta ronda no modifica, siembra ni resetea `wallet_dev`.
- Los PNG aprobados en [`docs/design/references/round3/source/`](design/references/round3/README.md) y los originales locales `design/web/`, `design/mobile/` son las referencias. Las capturas entregadas por el usuario son evidencia de implementación actual, no referencias nuevas.

## Capturas manuales recibidas

| Captura | Pantalla y referencia aprobada | Diferencia / clasificación | Corrección y evidencia |
|---|---|---|---|
| 1 | M05 — [selector](design/references/round3/source/mobile/m05_elegir_beneficiario_1/screen.png) | Un beneficiario frente a ejemplos múltiples es diferencia de datos. La nota de que el alta se hace en Web coincide con el alcance. El engrane flotante no aparece en el árbol de componentes y corresponde al overlay de Expo Go. | Sin cambio de producto; no inventar favoritos ni beneficiarios. Captura actual del usuario; validación nativa posterior pendiente. |
| 2–3 | M06 — [datos de transferencia](design/references/round3/source/mobile/m06_datos_de_transferencia/screen.png) | El botón de avance mostraba un spinner estando deshabilitado por formulario incompleto, sin operación en curso. | `Button` separa `loading` de `disabled`; spinner solo durante trabajo asíncrono. Test nativo verifica que el CTA incompleto conserva etiqueta y no incluye `ActivityIndicator`. Falta captura posterior del teléfono. |
| 4 | M03 — [movimientos](design/references/round3/source/mobile/m03_ltimos_20_movimientos/screen.png) | Cuenta principal sin movimientos reales; la referencia contiene ejemplos. Es estado vacío legítimo, no defecto de consulta. | No agregar historial ficticio. El test móvil simula lista, vacío y cursores; la integración API prueba paginación con PostgreSQL. Screenshot del usuario confirma la presentación real del estado vacío. |
| 5 y 7 | M02 — [Inicio/cuentas](design/references/round3/source/mobile/m02_inicio_y_cuentas/screen.png) | Selección de cuenta, saldos y beneficiario provienen de datos actuales. La diferencia de contenido frente a datos ficticios de la referencia es legítima. | Sin cambio de producto en estas pantallas. Comparte el overlay de Expo Go observado en #1. Capturas actuales; revisión posterior sigue pendiente. |
| 6 | — | Página promocional de BBVA, ajena a Billetera MXN. | Excluida del análisis por confirmación del usuario. |
| 8 | M06 — [datos de transferencia](design/references/round3/source/mobile/m06_datos_de_transferencia/screen.png), entre cuentas propias | Repite el defecto del spinner del CTA con monto/concepto capturados y referencia vacía. | Misma corrección compartida y test M06. No se envió la operación. Captura posterior del teléfono pendiente. |
| 9 | W03 — [inicio/cuentas](design/references/round3/source/web/w03_inicio_y_cuentas_corregido/screen.png) | El saldo consolidado mostraba la unidad `MXN` dos veces. | Regla visual elimina la unidad anidada repetida; E2E comprueba exactamente una etiqueta `MXN` visible sin depender del saldo. |
| 10 | W04 — [sin movimientos](design/references/round3/source/web/w04_sin_movimientos/screen.png) | La cuenta indicada no tiene movimientos y la UI muestra filtros/estado vacío. La referencia de esa variante también es vacía; el UUID local de la ruta no demuestra acceso indebido. | Sin cambio visual requerido. API de historial comprueba propietario, filtros y cursor; Playwright genera estado vacío y estado poblado. |
| 11 | W06 — [directorio](design/references/round3/source/web/w06_directorio_de_beneficiarios_1/screen.png) | El único beneficiario ocupaba media fila y dejaba una columna vacía. | Grid `auto-fit` permite que una tarjeta única use el ancho útil; Playwright verifica ancho superior al 85% del contenedor. |
| 12 | W07 — [alta](design/references/round3/source/web/w07_alta_de_beneficiario/screen.png) | Etiquetas, ayuda y campos con densidad/espaciado reducido; riesgo de que acciones y footer compitan por el viewport. | Aumentan separación y line-height; footer pasa al flujo normal en escritorio y desaparece en móvil. Playwright verifica orden de columnas y que la acción no quede tapada. |
| 13 | W08 — [transferencia](design/references/round3/source/web/w08_formulario_de_transferencia/screen.png) | Campos y resumen lateral demasiado comprimidos frente a la composición aprobada. | Aumentan separación y proporción formulario/resumen; en móvil ambos se apilan. Playwright verifica geometría de columnas y conserva la regresión real de transferencia/idempotencia. |

La vista responsive Web se captura mediante Playwright en `390×844` y `1440×960`, comparables por viewport con las referencias curadas. Las capturas entregadas de Web incluyen el marco del navegador y un viewport distinto; no se comparan píxeles directamente. No se actualizan referencias para hacer pasar las pruebas.

## Recorridos funcionales y límites de cobertura

La matriz exhaustiva por ID `REQ-*` se genera junto al resultado real en `test-results/qa/qa-report.md` mediante `npm run qa:report`. Reutiliza lint, typecheck, unitarias, OpenAPI, migración de test, integración PostgreSQL, Playwright visual/E2E, la fixture de 100k con `EXPLAIN ANALYZE` y build/Expo export, secuencialmente.

Regresiones que se hacen explícitas en esta ronda:

- REQ-XFER-08: doble clic en el primer envío real; se exige un solo POST inicial, y el flujo mantiene consulta/replay con la misma llave tras respuesta incierta.
- REQ-XFER-11: confirmar OTP permanece deshabilitado con código vacío/parcial y se habilita a seis dígitos; la integración cubre incorrecto, expirado y agotamiento.
- REQ-XFER-09: API cierra y vuelve a abrir el listener entre envío incierto y replay, comprobando una sola fila/llave idempotente.
- REQ-XFER-05 / REQ-LIMIT-01: rechazo por saldo y límite compara saldos, transferencias, asientos y uso diario antes/después; OTP incorrecto verifica operación pendiente sin posting.
- REQ-QUAL-04: las 100 transferencias concurrentes concilian balances, uso, importes solicitados, 200 postings, neto cero y ausencia de filas duplicadas.

### Pendientes que impiden aprobación completa

- **BLOCKED — dispositivo nativo:** falta repetir el recorrido después de la corrección en Expo Go y capturar M05/M06/M02/M03. No declarar visualmente aprobada Mobile con Jest, export ni estas capturas anteriores.
- **BLOCKED — operación móvil real:** pruebas Mobile de recuperación usan red simulada; falta el recorrido controlado de desconexión/reanudación con la API real en un teléfono. No crear una transferencia manual en `wallet_dev` para probarlo.
- **BLOCKED — límite de medianoche:** no existe prueba determinista con reloj fijado que cruce el día de negocio y verifique límites/asientos concurrentes.
- **BLOCKED — pixel diff:** capturas Web reales y geometría responsive son comprobables; no se usa umbral automatizado de similitud. El reporte no transforma inspección visual en aceptación.
- **BLOCKED — Node local:** el shell reportó Node `26.3.0`, no el `26.13.1` fijado. Ejecutar QA con el runtime correcto antes de atribuir un FAIL local a producto.

El informe lista PASS/FAIL/BLOCKED por comando y por requisito. Un CI verde automatizado no elimina estos bloqueos ni equivale a aprobación completa.
