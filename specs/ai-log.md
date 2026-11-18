# Bitácora de uso de AI

Registro contemporáneo de esta fase; no representa aprobación humana ni revisión de diseños. Las fechas de evidencia se registran en UTC.

## Herramientas/modelos realmente usados

- OpenCode CLI/host versión `1.18.33`; modelo de sesión declarado por el host: `openai/gpt-6-luna`.
- Skill Forge instalado desde su repositorio de origen, rama `main`; el proyecto conserva la definición de roles y el protocolo utilizado.
- Se usaron Planner, Generator y Evaluator en contextos independientes de tarea provistos por OpenCode, coordinados mediante archivos Git. Se canceló una invocación Generator mientras trabajaba; se preservó e inspeccionó el trabajo no confirmado y otra invocación terminó el scaffold. Generator completó commits de scaffold y documentación Redoc. Evaluator ejecutó tres pasadas; la final quedó en `FINDINGS.md` (SHA evaluado `61280ce`), con 9/10 criterios verificados y F-02 minor abierto por falta de inspección visual con navegador.
- Herramientas de lectura/inspección: OpenCode read/glob/grep/bash, Git, GitHub CLI y SSH para verificar identidades. No se leen tokens ni llaves privadas.

## Prompts clave observados

1. El usuario solicitó BOOT-00 con especificación fiel al reto adjunto, límite de no implementar producto y flujo Planner → Generator → Evaluator.
2. El usuario autorizó crear el checkout de trabajo, instalar Forge con el instalador indicado y avanzar localmente si el adjunto no fuera accesible.
3. Instrucción al Planner: leer skill/AGENTS/PLAN/enunciado, crear solo `SPEC.md`, limitarse a BOOT-00, producir siete secciones y rúbrica binaria, y no crear código ni otros documentos.
4. Instrucciones al Generator: implementar exclusivamente BOOT-00, respetar el commit documental previo, crear commits pequeños, probar scripts y documentar bloqueos; posteriormente se pidió hacer navegable en Redoc el contrato completo planeado además del contrato limitado a health.
5. Instrucción al Evaluator: ejecutar el README, probar health/Problem Details, aislamiento PostgreSQL real si el daemon estaba disponible, comprobar scripts/CI/spec-first, y escribir solo findings sin instalar navegador ni corregir código.

## Decisiones, correcciones y rechazos

- Se localizó y leyó el archivo adjunto original antes de redactar requisitos; el contenido identifica la prueba como “Fullstack Developer (Fintech)”. Se conserva como `docs/challenge.md`.
- La sesión inicial no vio adjunto y pidió ubicación; la aclaración del usuario permitió encontrarlo localmente. No se reconstruyó el reto de memoria.
- Se comprobó el acceso remoto necesario para la entrega sin registrar identificadores de cuenta, respuestas de autenticación ni credenciales.
- El instalador de Forge ubicó sus instrucciones de rol directamente en el directorio del skill; se leyeron desde la ubicación efectiva. La procedencia técnica queda documentada en `docs/forge-evidence.md` sin copiar secretos locales.
- La integración se ejecutó contra la base aislada `wallet_test`; no se usaron datos de desarrollo para pruebas financieras ni se alteraron servicios ajenos al proyecto.
- La primera versión de `docs:api` solo renderizaba el contrato health-only; tras revisión de requisitos se pidió al Generator exponer también el contrato completo `specs/openapi.yaml` como PLANNED/NOT IMPLEMENTED, conservando la referencia de health separada. Cambio trazable en `61280ce`.
- En verificación final del SHA `26fec66`, `npm ci` señaló 28 advisories; auditoría de producción, tres moderados en `minimatch` por Expo. `npm audit fix --force` propone bajar a Expo 52 (breaking) frente a Expo SDK 58 fijado. Se rechazó esa corrección automática para no romper compatibilidad del scaffold; se deja el advisory abierto para resolverlo con una versión compatible y revisión posterior.
- Comprobación final después del commit de evidencia: `npm ci`, lint, typecheck, tests/build de los cuatro workspaces, validación/regeneración OpenAPI, documentos Redoc, QA bootstrap 13 PASS/0 FAIL/0 BLOCKED e integración PostgreSQL test 1/1 pasaron en `26fec66`. El resultado no es CI remota ni aprobación visual.
- No se detectaron ni se rechazan sugerencias AI de lógica financiera insegura: no se propuso ni implementó lógica financiera. Los montos/umbrales y supuestos de producto se mantienen como ilustrativos/propuestos pendientes, no aprobación humana.
- No se han registrado sugerencias AI inseguras ni intervenciones humanas rechazadas hasta el momento; no se fabrican. Valores financieros de ejemplo y supuestos de producto se etiquetan como propuestas pendientes, no hechos.
- No se registra aprobación de Planner/specs por persona; la revisión Stitch está pendiente.

## Seguimiento producto y aprobación visual (2026-11-14)

- El usuario sustituyó el stop anterior y aprobó los exports Stitch para implementación; se registra como aprobación del usuario real, no como aprobación de agentes.
- El usuario eligió la opción de demo balanceada preguntada por el Coordinador: cuenta MXN automática al registrarse y fixture local de dos cuentas propias con contra-asientos. No aprobó importes exactos ni políticas de producción.
- Tres contextos OpenCode `general` inspeccionaron por separado las fuentes web W01–W07, web W08–W14 y mobile M01–M12. Cada uno leyó los exports HTML y abrió las capturas disponibles; resultados consolidados por el Coordinador en `docs/design-mapping.md`.
- Se encontraron 12 capturas web no disponibles, dos HTML incompletos y diferencias entre los tokens y el texto narrativo de color. Se registran como tales; no se afirma revisar assets ausentes.
- El Coordinador fijó el alcance exclusivamente a requisitos obligatorios del challenge. Se excluyen SPEI/bancos externos, CEP/Banxico real, inversiones, garantías, biometría, export mensual y transferencias programadas.
- En esta fase posterior el host soporta delegación real con la herramienta OpenCode `task` y agentes `general`/`explore`. No se han ejecutado todavía agentes implementadores Backend/Web/Mobile; se delegarán luego de congelar OpenAPI/types/ownership y commit del Planner.

## Forge product cycle — preparación (2026-11-14)

- Planner se ejecutó en tarea independiente OpenCode y modificó únicamente `SPEC.md`; rubric de producto 20 criterios, commit `b7cfa69` anterior a código.
- Coordinator ajustó OpenAPI/types en `bb73c3c` y preparó la base compartida/dependencias/harness en `9675b79`. En Node 26.13.1 se ejecutaron `npm ci`, typecheck, npm test (API/web/mobile/shared), OpenAPI validation/check y Expo install check; shared money/CLABE reportó cuatro tests passing.
- Tres task contexts independientes solo inspeccionaron diseños, sin escribir. Worktrees/branches `product/backend`, `product/web`, `product/mobile` quedaron creados e instalados (`npm ci`) sobre `9675b79`. Aún no se han ejecutado agentes implementadores.
- Las fuentes Stitch permanecen intactas en el working tree local, sin commit por contener credenciales/OTP demo de ejemplo en HTML y ejemplos financieros en capturas. No se añadieron esos valores a logs/docs ni se copiaron exports a app UI.
- El usuario autorizó únicamente el alcance obligatorio y aprobó cuenta MXN automática más fixture local de dos cuentas propias balanceadas; montos de fixture/límite/OTP/zona/expiry siguen no aprobados para producción. Ninguna sugerencia AI financiera se ha implementado/rechazado fuera de esas decisiones registradas.

## Revisión documental de entrega (2026-11-17)

- OpenCode se utilizó para revisar `docs/challenge.md`, comparar sus entregables con el README y las evidencias existentes, y actualizar documentación de instalación/arquitectura/propuesta AWS.
- Codex CLI se utilizó en modo de solo lectura para inspeccionar refs e historia Git durante la reconstrucción local. No se utilizó para editar código ni archivos del producto.
- La explicación de Forge en el README describe el skill y sus límites de roles; no afirma que el skill ejecute agentes por sí solo ni que un agente sustituya revisión humana o pruebas reales.
