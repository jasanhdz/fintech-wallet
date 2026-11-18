# Ronda 7 · H1 móvil — evidencia (código `efd0704`)

Commits de la tanda (sobre `7219339`): `d26195c` R7-1, `9ff0e51` R7-2, `255a06e` R7-3, `53790c8` R7-4/R7-5, `8a9c18c`
R7-6/R7-8, `54a9af2` R7-7, `efd0704` F-20, `c6e7e6e` notas + integración. Decisiones y discrepancia del umbral:
[`docs/round7-notes.md`](../../../round7-notes.md).

Entorno propio: API aislada `npm run dev:api:testdb` en **3794** sobre `wallet_test` (migrada con `npm run db:migrate:test`),
bundle web real (`expo export --platform web`, con el shim de SecureStore sólo en la copia exportada, `round6/71bd7e5/tools/patch.py`)
servido en **8794**. No se tocaron `wallet_dev` ni 3200/5174/8083. Usuarios sintéticos `*.r7.*@example.test`; contraseña de
prueba sólo en variable de entorno. El código de demostración nunca se imprime: los logs lo enmascaran y en las capturas el
recuadro "Código asignado para esta prueba" está difuminado.

## Niveles de evidencia

| Nivel | Qué | Resultado |
|---|---|---|
| Unit (jest, render RN) | `mobile/tests/app.test.tsx` | 131/131 (antes 105). Pruebas nuevas que fallan con el código previo: R7-1 2, R7-2 3, R7-3 1, R7-4/5 8 de 12, R7-6/8 2 de 3, R7-7 1 de 4, F-20 2 (`logs/mutation-*.txt`; las que pasan con el código previo fijan comportamiento existente: predicción del umbral, autoridad del servidor, cortina en `inactive`, rechazos ya cubiertos). |
| Integración API + PostgreSQL (`wallet_test`) | `tools/api-r7.mjs` | 25 PASS (`logs/api-r7-integration.txt`): bordes 4,999.99/5,000.00/5,000.01, código viejo tras cancelar (409, sin dinero), código viejo contra intento nuevo (422), intentos agotados (422×4 → 429, incluso con el código correcto; cancelable, sin dinero), repetición con la misma llave (mismo id, un débito, una fila), misma llave con otro cuerpo (409), saldo insuficiente (422 al confirmar) y límite diario (429), totales conservados. |
| Render web (RN-Web, Chromium 390 px ×2) | `tools/r7cap.cjs` + `tools/compose-r7.cjs` | 33 capturas por build; antes = bundle de `7219339`, después = bundle de `efd0704`. `logs/capture-*.txt`: tamaño mínimo de texto, `scrollWidth` y errores por estado. |
| Nativo (iPhone/simulador) | — | **Pendiente** (sin `simctl`/`adb` en este host). Ver abajo. |
| Raíz | `npm run lint`, `typecheck`, `test` | exit 0 (`logs/root-*.txt`). `test:integration` no se modificó (no se añadieron suites en `api/`). |

## Estados afectados (Stitch | antes | después, y diferencia antes vs después)

Las imágenes (`shots/*.jpg`) quedan en el worktree `fintech-wallet-g1` pero no se versionan (`.gitignore` excluye `*.jpg`,
igual que en la ronda 6); se regeneran con los comandos de "Reproducir". Los logs sí están en git (`logs/*.txt`).


| Estado | Cambio visible | Medición |
|---|---|---|
| [M02 incompatible](shots/M02-incompatible--lado-a-lado.jpg) · [dif](shots/M02-incompatible--diferencia.jpg) | "Continuar con transferencia" → "Elegir otro destinatario" (secundario) que abre [M05](shots/M05-desde-incompatible--lado-a-lado.jpg) con el aviso y el selector de origen. | antes: 0 "Elegir otro" / 1 "Continuar"; después: 1 / 0. |
| [M02 par válido](shots/M02-par-valido--lado-a-lado.jpg) | Principal → Ahorro conserva "Continuar con transferencia"; textos ≥ 12 pt, pestañas 13 pt. | mínimo 10 → 12 pt. |
| [M02 aviso pendiente](shots/M02-aviso-pendiente--lado-a-lado.jpg) · [M09](shots/M09-verificando--lado-a-lado.jpg) · [resuelto](shots/M09-resuelto--lado-a-lado.jpg) | Tras "Ir al inicio" Inicio muestra "Transferencia en verificación" (monto, referencia, sin afirmar nada del dinero) y "Verificar estado…" reanuda el mismo intento. | Respuesta perdida tras aplicarse: 2 POST con **1** llave distinta, saldos 969975/530025 (un solo débito), 1 movimiento de 30025. Antes no existía el aviso. |
| [M06](shots/M06-datos--lado-a-lado.jpg) · [teclado/foco](shots/M06-teclado-enfocado--lado-a-lado.jpg) · [130 %](shots/M06-datos-x1.3--lado-a-lado.jpg) · [200 %](shots/M06-datos-x2--lado-a-lado.jpg) | "Límite diario", "Disponible hoy", "Disponible", nota de beneficiarios y contador: 10 → 12 pt. | `scrollWidth` 390 en 100/130/200 %. |
| [M07](shots/M07-revision--lado-a-lado.jpg) · [umbral](shots/M07-umbral--lado-a-lado.jpg) · [130 %](shots/M07-revision-x1.3--lado-a-lado.jpg) · [200 %](shots/M07-revision-x2--lado-a-lado.jpg) | Etiquetas de meta 12 → 14 pt, captions 10 → 12, cálculo y nota 10 → 12; barra con segundo segmento gris neutro (antes salmón) y oculta a lectores. | Ver "Diferencia frente a Stitch". |
| [M08 vacío](shots/M08-vacio--lado-a-lado.jpg) · [incompleto](shots/M08-incompleto--lado-a-lado.jpg) · [completo](shots/M08-completo--lado-a-lado.jpg) · [incorrecto](shots/M08-incorrecto--lado-a-lado.jpg) · [intentos agotados](shots/M08-intentos-agotados--lado-a-lado.jpg) · [código nuevo](shots/M08-codigo-nuevo--lado-a-lado.jpg) | Descripción, cuenta regresiva y recuadro del código 12 → 14 pt; "Faltan N dígitos", "Código completo", aviso de código incorrecto con el máximo de intentos de la política, estado propio de intentos agotados; "Solicitar un código nuevo". | Antes el 429 sólo mostraba "Se agotaron los intentos." bajo las casillas, con la entrada aún editable y el enlace "Solicitar nuevo código de demostración". Código nuevo: saldos sin cambio. |
| [M10](shots/M10-comprobante--lado-a-lado.jpg) · [130 %](shots/M10-comprobante-x1.3--lado-a-lado.jpg) · [200 %](shots/M10-comprobante-x2--lado-a-lado.jpg) | Fecha 12 → 14 pt, detalles del comprobante 10 → 12. Compartir/PDF no se tocó (H2). | `scrollWidth` 390. |
| [M11 saldo](shots/M11-saldo-insuficiente--lado-a-lado.jpg) · [M11 límite](shots/M11-limite-diario--lado-a-lado.jpg) | Límite diario: motivo propio con monto y "disponible hoy" de la política, fila "Disponible hoy (límite diario)", "no se debitó" (antes 429 se trataba como no verificado: "Revisa tu saldo"). | API real: 429 "Se excedió el límite diario" y 422 "Saldo insuficiente". |
| [M12 cortina](shots/M12-cortina--lado-a-lado.jpg) · [regreso](shots/M12-regreso--lado-a-lado.jpg) | Sin cambio visual salvo tamaños mínimos; sin saldos ni datos; regreso al mismo paso con sesión válida. | En web se simula con `visibilitychange`; `inactive` de iOS sólo en jest. |

## Diferencia frente a Stitch (motivo)

- **Tamaños**: los textos que Stitch dibuja a 10 px se ven a 12 pt (y ayuda/errores a 14 pt). Es deliberado por legibilidad;
  la estructura, colores y jerarquía no cambian. Las pantallas largas se desplazan antes.
- **M07 a 390×844**: con la escala nueva "Modificar datos" queda en y=869-913 en la variante umbral (antes 817-861 con los
  mismos datos: con nombres de cuenta reales ya no cabía) y la variante normal termina en 873 a 884 px (antes 841). Tras
  desplazar, ambas acciones quedan visibles (720-768 / 776-820, `shots/M07-umbral-844-desplazado--lado-a-lado.jpg`). No se
  redujo texto para evitar el desplazamiento (indicación de la tanda); afecta lo medido en F-15 y debe revisarse en dispositivo.
- **Barra de M07**: gris neutro en lugar de salmón para el segmento del monto (ver notas §4).
- Persisten las diferencias ya documentadas: sin "Sin costo de comisión", sin "Frecuentes", sin Compartir/PDF, sin claims de
  cifrado/SPEI/biometría, cuenta regresiva real.

## Evidencia manual del usuario (registrada, no extendida)

Reportada por el usuario en su dispositivo: selección incompatible (origen Ahorro con destino Ahorro), cambio de origen,
transferencias de $500.00 y $1,000.00 completadas, saldos finales Principal **$7,440.00** / Ahorro **$7,560.00** / total
**$15,000.00**. No se reprodujo ni se amplió aquí.

## Pendiente nativo

Hermes; SecureStore/Keychain; `AppState` real (`inactive` en el selector de apps de iOS y la cortina en la instantánea);
autollenado `oneTimeCode` y pegado desde el portapapeles en el teclado iOS; Dynamic Type real 130/200 % (aquí aproximación CSS);
VoiceOver/Control por voz con los nombres nuevos (F-20); safe area real y posición de las acciones de M07 a 390×844; gesto
atrás en M08.

## Reproducir

```sh
npm run db:migrate:test
API_PORT=3794 WEB_ORIGIN=http://localhost:8794 npm run dev:api:testdb
R7_TEST_PASSWORD=<valor de prueba> node docs/evidence/round7/efd0704/tools/api-r7.mjs
cd mobile && EXPO_PUBLIC_API_URL=http://127.0.0.1:3794/v1 npx expo export --platform web --output-dir <scratch>/dist
python3 -I docs/evidence/round6/71bd7e5/tools/patch.py <scratch>/dist && python3 -I -m http.server 8794 --bind 127.0.0.1 -d <scratch>/dist
R7_TEST_PASSWORD=<valor de prueba> node docs/evidence/round7/efd0704/tools/r7cap.cjs <scratch>/shots-after after
node docs/evidence/round7/efd0704/tools/compose-r7.cjs <shots-before> <shots-after> <design/mobile> <salida> docs/evidence/round7/efd0704/tools/mapping-r7.json
```
El límite de autenticación (10/min) hace que `r7cap.cjs` espere entre usuarios; una corrida tarda ~6 min.
