# Bitácora de uso de AI

Registro contemporáneo de esta fase; no representa aprobación humana ni revisión de diseños. Las fechas de evidencias se registran en UTC; la terminal local usó `America/Chicago`.

## Herramientas/modelos realmente usados

- OpenCode CLI/host versión `1.18.33`; modelo de sesión declarado por el host: `openai/gpt-6-luna`.
- Skill Forge instalado globalmente desde `https://github.com/jasanhdz/codex-skill-forge`, rama `main`, commit remoto observado `300442b20517749881822f51c3a90102a54fbfa6`.
- Se usaron Planner, Generator y Evaluator en contextos independientes de tarea provistos por OpenCode, coordinados mediante archivos Git. Se canceló una invocación Generator mientras trabajaba; se preservó e inspeccionó el trabajo no confirmado y otra invocación terminó el scaffold. Generator completó commits de scaffold y documentación Redoc. Evaluator ejecutó tres pasadas; la final quedó en `FINDINGS.md` (SHA evaluado `61280ce`), con 9/10 criterios verificados y F-02 minor abierto por falta de inspección visual con navegador.
- Herramientas de lectura/inspección: OpenCode read/glob/grep/bash, Git, GitHub CLI y SSH para verificar identidades. No se leen tokens ni llaves privadas.

## Prompts clave observados

1. El usuario solicitó BOOT-00 con especificación fiel al reto adjunto, límite de no implementar producto y flujo Planner → Generator → Evaluator.
2. El usuario aclaró autorización para crear `/Users/jasanhernandez/Develop/fintech-wallet`, instalar Forge global con el instalador indicado, usar la cuenta `jasanhdz` y avanzar localmente si el adjunto no fuera accesible.
3. Instrucción al Planner: leer skill/AGENTS/PLAN/enunciado, crear solo `SPEC.md`, limitarse a BOOT-00, producir siete secciones y rúbrica binaria, y no crear código ni otros documentos.
4. Instrucciones al Generator: implementar exclusivamente BOOT-00, respetar el commit documental previo, crear commits pequeños, probar scripts y documentar bloqueos; posteriormente se pidió hacer navegable en Redoc el contrato completo planeado además del contrato limitado a health.
5. Instrucción al Evaluator: ejecutar el README, probar health/Problem Details, aislamiento PostgreSQL real si el daemon estaba disponible, comprobar scripts/CI/spec-first, y escribir solo findings sin instalar navegador ni corregir código.

## Decisiones, correcciones y rechazos

- Se localizó y leyó el archivo adjunto original en Downloads antes de redactar requisitos: “Prueba Técnica — Backend Developer (AWS · Node.js · PostgreSQL · AI en modo SPEC).md”. La primera línea del contenido identifica el título como “Fullstack Developer (Fintech)”. Se conserva como `docs/challenge.md`.
- La sesión inicial no vio adjunto y pidió ubicación; la aclaración del usuario permitió encontrarlo localmente. No se reconstruyó el reto de memoria.
- Se verificó la cuenta personal mediante alias SSH `github.com-personal`; GitHub SSH respondió `Hi jasanhdz!`. `gh auth status`/`gh api user` siguen autenticados como `jasanhdz-isol`; no se cambiará cuenta ni se creará repo por esa sesión.
- Instalador global solicitado ejecutado. Se detectó que instala los archivos de roles directamente bajo `skills/forge/` aunque el skill describe ruta `references/`; se leyeron desde las rutas efectivamente instaladas. Procedencia y hashes quedan en `docs/forge-evidence.md`.
- El primer Evaluator informó PostgreSQL bloqueado porque Colima estaba apagado. Tras inspeccionar el contexto activo y comprobar que la VM existente estaba detenida, se inició Colima y `npm run db:up` creó solo `fintech-wallet-postgres-1` con volumen/nombres propios y puerto 55432. El daemon reactivó `lucem-retail-db-1` por su política existente; no se ejecutó ningún comando sobre Lucem ni se alteró su configuración/base. La integración conectó como `wallet_runtime_test` a `wallet_test` y verificó cero tablas públicas.
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
