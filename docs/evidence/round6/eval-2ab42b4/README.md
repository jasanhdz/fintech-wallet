# Evaluación independiente ronda 6, pasada 6 (código `2ab42b4`)

Nivel de evidencia: unit (jest), integración API/PostgreSQL (`wallet_test`), render RN-Web (export de Expo ios+web, la copia web servida en Chromium 390 px @2x). **No es evidencia nativa** (sin Hermes/iPhone/simulador: `xcrun simctl` no existe en este host).
Entorno propio: API `dev:api:testdb` en :3711 (wallet_test migrada con `db:migrate:test`), bundle web en :8711 (shim de SecureStore sólo en la copia exportada, `tools/patch.py` de G2). Procesos terminados al acabar; 3200/5174/8083 y `wallet_dev` no tocados. Datos sintéticos `*@example.test`; la contraseña de prueba sólo se pasó por variable de entorno y no está en ningún archivo.
Referencias: originales `design/mobile/*/screen.png` del checkout principal (no las sanitizadas), alto de viewport = alto del PNG / ancho x 390.

## Contenido
- `*--lado-a-lado.jpg`: referencia (izq., escalada a 780 px) | captura propia (der.). `*--diferencia.jpg`: |ref - app| por píxel, sin umbral. `logs/metrics.txt`: diferencia media (0-255); sólo orientativa, no se usó para omitir ninguna comparación.
- `shots/`: F-11 (nombre de 63 caracteres a 100/130/200 %), datos largos (beneficiario 112 car., alias 79, concepto 39, UUID real) en M03-M10, F-12 en vuelo, F-13 a 844/884, Inter normal/fallback.
- `logs/`: `s6-f11`, `s7-f12`, `s9-f13`, `s8-inter`, `s3-e-states` (E/G/expirado/cancelado), `s4-f06-policy` (F-06, política servidor, cuenta regresiva), `fidelity-capture.log`, `mutation-F14.txt`, `mutation-F12.txt`, `tsc-without-paths-mutation.txt`, `integration.txt`, `expo-export.txt`, `expo-install-check.txt`, lint/typecheck/test.
- `tools/`: scripts (`capture.cjs` y `seed.mjs` de G2 ejecutados por el evaluador; `s2`-`s4`, `s6`-`s9` y `lib.cjs` propios/derivados). Ajuste necesario: la etiqueta accesible pasó a "Solicitar nuevo código" (F-19).

## Fidelidad: los 30 estados (inspección uno por uno, referencia vs captura)
Severidad: C = critical, M = major, m = minor. "Nativo pendiente" = no verificable sin dispositivo. Ninguna diferencia critical ni major.

| # | Estado (ref) | Diferencias materiales restantes | Veredicto |
|---|---|---|---|
| 1 | M01-login (m01_2) | Ref muestra avatar "AL" y flecha en cabecera, valores rellenos, etiquetas "Registrado/Alfanumérica" (artefactos del mock); app sin ellos. Mismo layout, Inter, tarjeta, nota "¿No tienes cuenta?", pie. | Justificada |
| 2 | M01-error-credenciales (m01_1) | La ref sólo muestra el estado "Listo" con panel de simulación ("Simular estado UI", versión 2.4.0, "cifrada (SPEI/MXN)"); el estado de error no existe como imagen. Banner rojo "Credenciales no válidas" sin referencia equivalente; claim SPEI/cifrada excluida por AGENTS. | Sin referencia equivalente; justificada |
| 3 | M01-error-sin-red | Igual que 2 (estado "Sin Red" no renderizado en la ref). Banner azul propio coherente con tokens. | Sin referencia equivalente; justificada |
| 4 | M02-inicio | Estructura/tabs/tarjeta/CTA/lista idénticas. Ícono de la tarjeta (cartera vs Material), saldos de datos. 3 movimientos con fecha en lugar de "Hace 3 días" (dato). Cabecera con logo azul vs placeholder roto del mock. | Justificada (m: iconografía Ionicons) |
| 5 | M03-movimientos | App sin línea "Ciclo: Noviembre 2026" (sin dato en contrato), sin pill de grupos AYER/…; saldo monoespaciado igual. Una sola agrupación "HOY" por datos. | Justificada |
| 6 | M04-detalle-enviada | Folio UUID real largo: parte en 2 líneas sin romper layout (ref: DEMO-0001 con ícono copiar). Falta ícono copiar (sin portapapeles requerido). "Para" vs "Cuenta destino". | Justificada (m) |
| 7 | M04-detalle-recibida | Variante De/Recibida/+ verde sin referencia propia (usa m04); UUID en 2 líneas. | Justificada |
| 8 | M05-beneficiarios | Sin chips "Frecuentes" ni indicador verde de avatar; tarjetas/buscador/chip "Todos (2)" y nota inferior idénticos. | Justificada (m) |
| 9 | M05-origen-ahorro-destino-incompatible | Ref (m05_1) es el mock de lista vacía + aviso legal; la app muestra selector de origen + fila deshabilitada con motivo (funcionalidad nueva de B/C/D sin Stitch). | Sin referencia equivalente; justificada |
| 10 | M05-vacio | Ref combina lista y vacío; app sólo vacío, sin enlace "Acceder a banca web corporativa" ni "Seguridad bancaria"/aviso legal (claims no soportados). Icono/tarjeta/texto iguales. | Justificada |
| 11 | M06-datos | App ~14 px lógicos más alta: enlace "Cambiar cuenta" y línea "Disponible hoy … límites de demostración" extra (funcionales, no existen en Stitch). Anillo de foco cuadrado azul en Referencia (RN-Web; no existe en nativo, pendiente verificar). Pie fijo "Continuar" idéntico. | m (foco web); resto justificado |
| 12 | M06-datos-propias | Igual que 11 con destino propio; monto tecleado "1500" sin formato (input, como Stitch "850.00" es valor mock). | Justificada |
| 13 | M06-origen-igual-destino | Estado sin referencia: alerta naranja + Continuar deshabilitado; título parcialmente bajo cabecera por scroll del caso (comportamiento del scroll). | Sin referencia equivalente |
| 14 | M06-selector-origen | Sin referencia (selector de origen); radio-cards coherentes con M05. | Sin referencia equivalente |
| 15 | M07-revision | Acciones visibles a 884 (F-13 resuelto). App ~20 px más alta; sin chip "Sin costo de comisión" (afirmación no soportada) ni logo de "retirar" (ícono propio). Tipo "Transferencia interna" vs "Inmediata" (m07_1). | Justificada |
| 16 | M07-revision-propias | Igual a 15 con destino propio; el texto de cabecera "Revisar transferencia" vs "Revisar y confirmar". | Justificada (m) |
| 17 | M07-revision-umbral | Chip de umbral con texto propio ("mayor o igual … demostración"), sin chip de comisión, sin pie "Escenario ilustrativo". A 844 "Modificar datos" queda 12 px fuera del viewport (F-15). | m (F-15) |
| 18 | M08-codigo-vacio | Cabecera de resumen igual; cuadro "Código asignado para esta prueba" (enmascarado en captura) extra por diseño demo; casillas, cuenta regresiva `04:58` vs `00:50 s` (política real 5 min vs mock), "Solicitar nuevo código de demostración" vs "Reenviar código de demostración". | Justificada |
| 19 | M08-codigo-vigente | Seis puntos azules idénticos; falta pie "Variante…" (artefacto del mock). Rastro de borde de foco en la fila de casillas (RN-Web). | Justificada |
| 20 | M08-codigo-expirado | Banner rojo, botón "Solicitar nuevo código de demostración", Autorizar deshabilitado: igual. Ícono de reloj diferente. | Justificada |
| 21 | M09-enviando | La ref (m09_1) muestra la pestaña "2. Sin conexión" seleccionada, no "Enviando": la comparación no es del mismo estado. App: pantalla neutral "Enviando transferencia…" sin flecha atrás (F-12, bloqueo intencional). | Sin referencia equivalente; justificada |
| 22 | M09-verificando | Igual jerarquía y botones; textos de datos y pie; sin "Nodo seguro Banxico/SPEI" (claim excluida); línea roja "No pudimos conectar…" real. | Justificada |
| 23 | M10-comprobante | Sin "Compartir/Descargar PDF" ni "Transacción auditada y cifrada" (excluidos); folio UUID real en 2 líneas; "Nuevo saldo disponible" igual. | Justificada |
| 24 | M10-comprobante-propias | Igual; destino propio con "Para: Cuenta de ahorro demo". | Justificada |
| 25 | M11-rechazada-saldo | Sin pestañas "Saldo insuficiente/Límite diario" (simulador del mock); contenido, importes rojo/verde, botones iguales; texto "ninguna comisión" omitido. | Justificada |
| 26 | M11-intento-expirado | Ref sólo tiene el caso de saldo; pantalla propia "El código de esta operación expiró" con ícono azul. | Sin referencia equivalente |
| 27 | M12-privacidad | Casi idéntico (logo azul vs imagen rota del mock). Sin referencia a "Blindaje/biométrico". | Justificada |
| 28 | M12-sesion-vencida | La ref (m12_2) es la cortina con pestaña "Cortina Privacidad" seleccionada; el estado "Sesión vencida" no se renderiza en la imagen. App: aviso + login con correo prellenado. | Sin referencia equivalente |
| 29 | I-texto-130-M06 | Aproximación CSS 130 %: sin desbordes, "Continuar" visible; no es `fontScale` nativo. | Nativo pendiente |
| 30 | I-viewport-reducido-M06 | Viewport -336 px (teclado): "Continuar" pegado y visible; no es teclado iOS real. | Nativo pendiente |

Pendientes nativos (no verificables aquí): Hermes (fechas/expo-crypto), SecureStore/Keychain, AppState/app switcher, teclado iOS, Dynamic Type/`fontScale` real, render de Inter en nativo (los 4 TTF sí están en el export ios), gesto atrás de iOS en el paso de código (F-12 solo verificado por controles de UI).
