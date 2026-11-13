# Bitácora de uso de AI

Registro contemporáneo de esta fase; no representa aprobación humana ni revisión de diseños. Zona horaria de los registros: se normalizará a UTC en la evidencia final del ciclo.

## Herramientas/modelos realmente usados

- OpenCode CLI/host versión `1.18.33`; modelo de sesión declarado por el host: `openai/gpt-6-luna`.
- Skill Forge instalado globalmente desde `https://github.com/jasanhdz/codex-skill-forge`, rama `main`, commit remoto observado `300442b20517749881822f51c3a90102a54fbfa6`.
- Se usó el rol Planner en un contexto de tarea independiente provisto por OpenCode para generar exclusivamente `SPEC.md`. Generator y Evaluator se registrarán solo después de ejecutarlos; todavía no se atribuye uso ni resultado a esos roles.
- Herramientas de lectura/inspección: OpenCode read/glob/grep/bash, Git, GitHub CLI y SSH para verificar identidades. No se leen tokens ni llaves privadas.

## Prompts clave observados

1. El usuario solicitó BOOT-00 con especificación fiel al reto adjunto, límite de no implementar producto y flujo Planner → Generator → Evaluator.
2. El usuario aclaró autorización para crear `/Users/jasanhernandez/Develop/fintech-wallet`, instalar Forge global con el instalador indicado, usar la cuenta `jasanhdz` y avanzar localmente si el adjunto no fuera accesible.
3. Instrucción al Planner: leer skill/AGENTS/PLAN/enunciado, crear solo `SPEC.md`, limitarse a BOOT-00, producir siete secciones y rúbrica binaria, y no crear código ni otros documentos.

## Decisiones, correcciones y rechazos

- Se localizó y leyó el archivo adjunto original en Downloads antes de redactar requisitos: “Prueba Técnica — Backend Developer (AWS · Node.js · PostgreSQL · AI en modo SPEC).md”. La primera línea del contenido identifica el título como “Fullstack Developer (Fintech)”. Se conserva como `docs/challenge.md`.
- La sesión inicial no vio adjunto y pidió ubicación; la aclaración del usuario permitió encontrarlo localmente. No se reconstruyó el reto de memoria.
- Se verificó la cuenta personal mediante alias SSH `github.com-personal`; GitHub SSH respondió `Hi jasanhdz!`. `gh auth status`/`gh api user` siguen autenticados como `jasanhdz-isol`; no se cambiará cuenta ni se creará repo por esa sesión.
- Instalador global solicitado ejecutado. Se detectó que instala los archivos de roles directamente bajo `skills/forge/` aunque el skill describe ruta `references/`; se leyeron desde las rutas efectivamente instaladas. Procedencia y hashes quedan en `docs/forge-evidence.md`.
- No se han registrado sugerencias AI inseguras ni intervenciones humanas rechazadas hasta el momento; no se fabrican. Valores financieros de ejemplo y supuestos de producto se etiquetan como propuestas pendientes, no hechos.
- No se registra aprobación de Planner/specs por persona; la revisión Stitch está pendiente.
