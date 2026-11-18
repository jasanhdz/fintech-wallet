# Handoff — ronda de fidelidad visual móvil M01–M12 y fix de UUID

Preparado para continuar en una sesión nueva de Claude Code (necesaria para que el dispatch nativo de los subagentes Forge funcione — ver §7). No se perdió trabajo al preparar este documento; es un snapshot del estado real verificado, no una reconstrucción de memoria.

## 1. Rama y SHA

- Rama: `feature/product-mvp`.
- SHA local y de `origin` (coinciden exactamente, verificado con `git ls-remote origin feature/product-mvp`): `e727d755c24c5a95eb2446fdc780675210760920`.
- `git status --short`: solo `?? design/` (intencional, nunca versionado — contiene HTML/capturas con passwords/OTP demo ilustrativos).

## 2. Commits del fix de UUID y pruebas ejecutadas

El usuario reportó en su iPhone real: `Uncaught (in promise): No se pudo crear una clave segura para el intento.` al confirmar una transferencia. Causa raíz confirmada por código (no solo por la grabación): Hermes no expone `globalThis.crypto.randomUUID`; el throw ocurría *antes* de que `submitCreate`/`confirmOtp` entraran a su propio `try`, volviéndose una promesa rechazada sin manejar.

- `e727d75` — `fix(mobile): generate idempotency keys via expo-crypto, not Web Crypto`. Cambios: `newIdempotencyKey()` ahora prefiere `globalThis.crypto.randomUUID` donde existe de verdad (web/Jest) y cae a `Crypto.randomUUID()` de `expo-crypto` (instalado, síncrono, mismo SDK 58 que `expo-router`/`expo-secure-store`, verificado su `.d.ts` real antes de usarlo). Construcción de la llave movida dentro del `try` de ambas funciones. Añadido `transferInFlight` (ref, no state) contra doble-toque/concurrencia.
- Regresión en `mobile/tests/app.test.tsx`: quita `globalThis.crypto.randomUUID` (condición exacta de Hermes), corre login→beneficiario→datos→revisión→confirmar con los datos reales del usuario ($100.00, Abono, 1546). **Verificado que falla sin el fix** (mismo mensaje/pila que la grabación del usuario, letra por letra, confirmado con `git stash`) **y pasa con él**.
- Commits previos de esta misma ronda (también en `e727d75`'s ancestros, ya publicados): `902855b` (recuperación de confirm incierto + guard de rejection sin manejar en AppState), `32693d3` (M02 reordenado, sin saldo duplicado, destinatario sin duplicar y saldo posterior estimado en M07), `252d58a` (marcas de diagnóstico temporales, ver §8).
- Suites ejecutadas y verdes en las 4 workspaces tras el fix: `npm run lint`, `npm run typecheck`, `npm test` (incluye los 8 tests de `mobile/tests/app.test.tsx`, el nuevo regresión incluido).

## 3. Estado de publicación y CI

- Publicado: `origin/feature/product-mvp` = `e727d75` (coincide exactamente con local).
- CI: run [43815085946](https://github.com/jasanhdz/fintech-wallet/actions/runs/43815085946) sobre ese SHA exacto → **success**.
- `main` sin tocar, sin merge.

## 4. Cambios locales pendientes

Ninguno. Árbol de trabajo limpio salvo `design/` (intencionalmente sin versionar). Todo lo descrito en este documento ya está comprometido y publicado.

## 5. Matriz visual creada y correcciones efectivamente realizadas

Matriz completa M01–M12 entregada en el turno anterior de esta conversación (no se repite aquí por brevedad; léase el mensaje previo del asistente en este hilo, o pídele a la sesión nueva que la reconstruya con el método de §9 si no se preserva el historial de chat).

**Correcciones de código efectivamente realizadas y verificadas esta ronda** (todas en `mobile/App.tsx`):
- M02: orden saldo→transferir→actividad corregido; segundo número de saldo duplicado eliminado; ~6 líneas de código muerto (selector de beneficiario inalcanzable) removidas.
- M07: banner "Para" duplicado suprimido en la pantalla de revisión; saldo disponible de cuenta origen agregado; "Saldo posterior estimado" agregado (BigInt, sin float).
- Colores/tokens: verificados contra `design/mobile/billetera_mxn/DESIGN.md` (YAML real de Stitch) — ya coinciden exactamente, sin cambios necesarios.
- Confirmado por el usuario en su iPhone real: M01 (marca de diagnóstico visible), M02 (saldo antes de transferir), M07 (sin duplicado, saldo posterior $9,900.00 correcto para una transferencia de $100.00 desde $10,000.00).

## 6. Pendientes concretos M01–M12

| Pantalla | Estado |
|---|---|
| M01 Login | Ya fiel (verificado contra PNG+HTML esta ronda); footer "Versión X" cosmético, no crítico |
| M02 Inicio | Corregido y confirmado en dispositivo. Pendiente: confirmación explícita del usuario de que "ausencia de información repetida" quedó resuelta a su satisfacción |
| M03 Movimientos | Agrupación por fecha ya correcta (sin cambios). **No implementado**: posible ajuste de densidad de la card de cuenta — inspeccionado contra PNG, sin tocar código |
| M04 Detalle | **No tocado.** PNG+HTML inspeccionados |
| M05 Beneficiario | **No tocado.** PNG+HTML inspeccionados. Nota: el PNG combina dos estados (lista poblada + vacío) en una sola captura — son alternos, no simultáneos. Copy de "blindaje anti-fraude/2FA" correctamente excluido (claim de seguridad no soportado, decisión ya documentada) |
| M06 Datos de transferencia | **No tocado.** Falta: link "Cambiar beneficiario" (requiere nueva prop/wiring de navegación, no solo CSS — no es un cambio trivial); "Límite diario" junto al disponible **no agregado a propósito** — la API no expone ese dato hoy, no se inventan cifras |
| M07 Revisión | Corregido y confirmado en dispositivo. Sin pendientes conocidos |
| M08 OTP | **No tocado.** Seis casillas ya implementadas (ronda anterior). PNG incluye panel "Pruebas de validación (QA)" auto-etiquetado como herramienta de prueba — correctamente excluido |
| M09 Enviando/incierto | **No tocado.** PNG inspeccionado |
| M10 Comprobante | **No tocado.** PNG muestra "Nuevo saldo disponible" post-transferencia (dato real disponible vía `accountsQuery`, candidato razonable para implementar). "Compartir/Descargar PDF" es función nueva fuera de alcance sin aprobación explícita — no implementar sin decisión del usuario |
| M11 Rechazo | **No tocado.** PNG inspeccionado |
| M12 Privacidad | **No tocado.** Claims "cifrado 256-bit/biométrico" del PNG correctamente ausentes del código actual (ya excluidos en ronda anterior) |

**Causa de que M04/M05/M06/M08–M12 queden pendientes**: un Generator delegado (vía `general-purpose`, verbatim del rol Forge) se lanzó para cubrir las 12 pantallas y **falló por límite de sesión antes de producir ningún commit** (12 llamadas, cero cambios — verificado con `git log`/`git status`, no asumido). La corrección del bug crítico de UUID consumió el resto de la capacidad de esa sesión con el rigor que requería (diagnóstico, fix, regresión verificada en ambos sentidos).

## 7. Ubicación de instrucciones y agentes Forge

- Fuente real: `jasanhdz/codex-skill-forge` (repo propio del usuario), rama `main`, variante Claude en `claude/SKILL.md` + `claude/agents/{planner,generator,evaluator}.md`.
- Instalados en este checkout: `.claude/skills/forge/SKILL.md`, `.claude/agents/planner.md`, `.claude/agents/generator.md`, `.claude/agents/evaluator.md` (commit `fbbaf04`, ya publicado).
- **Estado real del dispatch**: los `subagent_type` personalizados (`planner`/`generator`/`evaluator`) NO están registrados en la sesión actual porque los archivos se instalaron a mitad de sesión; Claude Code los carga solo al iniciar. Verificado con una llamada real, error exacto: `Agent type 'evaluator' not found. Available agents: claude, claude-code-guide, Explore, general-purpose, Plan, statusline-setup`.
- **Por esto se pide la sesión nueva**: una sesión que inicie en este checkout (ya con los archivos presentes) debería reconocer los tres roles nativamente. La sesión nueva debe **verificar esto primero** con una llamada real antes de asumir que funciona.
- Mecanismo alternativo si el dispatch nativo sigue sin funcionar: ejecutar el contenido de cada `.claude/agents/<rol>.md` verbatim vía `general-purpose`, exactamente como se hizo en esta ronda (funciona, pero gasta más contexto por tener que rebriefar cada vez).

## 8. Procesos activos y marcas de diagnóstico

Procesos de la demo corriendo en este Mac ahora mismo (verificar que sigan vivos al retomar, los PID pueden cambiar si el usuario los reinició):

| Servicio | Puerto | PID (al momento de este handoff) | cwd | Iniciado |
|---|---|---|---|---|
| Web (demo original) | 5174 | 2689 | `fintech-wallet/web` | 2026-11-15 18:13 |
| Metro (instancia de diagnóstico) | 8083 | 55163 | `fintech-wallet/mobile` | 2026-11-15 23:48 |
| API (demo, `wallet_dev`) | 3200 | 55367 | `fintech-wallet/api` | 2026-11-15 23:49 |

IP LAN vigente al momento de este handoff: `192.168.100.8` (verificar de nuevo con `ipconfig getifaddr en0`, puede cambiar). `EXPO_PUBLIC_API_URL` de la instancia 8083 apunta a `http://192.168.100.8:3200/v1`.

**Marcas de diagnóstico temporales, todavía en el código** (gateadas por `__DEV__`, nunca aparecen en build de producción), en `mobile/App.tsx`:
- Línea ~609: `DIAG-MOBILE-32693d3-A` en la raíz de `export default function App()`, visible en cualquier pantalla.
- Línea ~523: `DIAG-MOBILE-32693d3-M07` dentro de la rama `screen === 'review'` de `TransferFlow`.

**No las retiré todavía** — el usuario pidió conservarlas hasta confirmar explícitamente que el fix de UUID funciona en su iPhone real (probó hasta antes del fix; aún no ha confirmado el resultado post-`e727d75`). La sesión nueva debe preguntar/verificar esto antes de retirarlas, y retirarlas en un commit propio y pequeño una vez confirmado.

**No tocar**: `wallet_dev`, los datos/saldos de la cuenta demo del usuario, ni los tres procesos de arriba salvo que haga falta reiniciarlos — y en ese caso, avisar primero qué cambiará, igual que se hizo en esta ronda antes de reiniciar la API.

## 9. Cómo retomar

1. Verificar HEAD/origin siguen coincidiendo y CI sigue verde (puede haber cambiado si el usuario publicó algo más).
2. Verificar el dispatch nativo de Forge con una llamada real a cada rol antes de asumir que funciona.
3. Preguntar al usuario si ya probó el fix de UUID en su iPhone (instancia 8083/3200, recarga completa recomendada, no solo Fast Refresh).
4. Retomar la implementación de M04/M05/M06/M08–M12 en ese orden o el que el usuario prefiera, leyendo cada `design/mobile/<id>/screen.png` + `code.html` antes de tocar código, siguiendo el mismo rigor que M02/M07: typecheck/lint/test verdes, regresión que falle sin el cambio y pase con él cuando aplique, commits pequeños.
5. Tras completar la ronda visual, correr una evaluación Forge independiente (Evaluator, nativo o verbatim) antes de declarar la ronda cerrada — todavía no se ejecutó esta ronda.
