# Evidencia de Forge

- Fuente upstream: <https://github.com/jasanhdz/codex-skill-forge>.
- Ref consultada: `main`; commit remoto observado con `git ls-remote` el 2026-11-13: `300442b20517749881822f51c3a90102a54fbfa6`.
- Instalador autorizado ejecutado el 2026-11-13: `curl -fsSL https://raw.githubusercontent.com/jasanhdz/codex-skill-forge/main/instalar.sh | bash -s -- --global`. La hora exacta de instalación no se capturó; comprobación de procedencia/hashes a las 23:11:30 UTC.
- Destino global informado por instalador: `~/.config/opencode/skills/forge` y `~/.config/opencode/commands/forge.md`.
- OpenCode CLI: `1.18.33` (versión del host, no versión de Forge).
- La instalación no publica un número de versión. No hay `.git` en el destino; por tanto se registra procedencia por URL/ref/commit upstream, no se inventa versión instalada.

## SHA-256 de archivos globales comprobados

| Archivo | SHA-256 |
|---|---|
| `skills/forge/SKILL.md` | `d08cb45160d4d5e48ddd7207127f0c05ee8efa06ec5566e380680e464c38f773` |
| `skills/forge/planner.md` | `7e5726667517165e3b33f9405fb2692b7f2aa86c3aee5cf2e08ad716322b468a` |
| `skills/forge/generator.md` | `6c6a7ce4daed4c14efbf7e255a673f719cbda771842b7bbf0ee1af11168c93f7` |
| `skills/forge/evaluator.md` | `b2dcee71bee9ff15a152fa3eb0e7689fa08f35f4eb6811c8df5358500cc50d8c` |
| `skills/forge/forge-run.sh` | `3d543e989f020ba72c17ef46bef72d017106a7a1034b96427215b11d6a7a2339` |
| `commands/forge.md` | `07b2511792f76f3976f461570b342cc076ddc411cebf0649eab56666c15144d` |

## Roles ejecutados

- **Planner:** completado en contexto independiente OpenCode task; único archivo de salida `SPEC.md`; 10 criterios binarios. El reporte de rol confirmó revisión de formato mediante `git diff --check`.
- **Generator:** ejecutado en contextos de tarea independientes. Completó el scaffold en `4c5be10` y `aa5b769`; tras revisar el requisito de OpenAPI navegable, agregó contrato planeado Redoc + contrato health-only en `61280ce`. Respetó `SPEC.md`/`FINDINGS.md`.
- **Evaluator:** pasada 1 (`FINDINGS.md`, SHA `aa5b769`) reportó 8/10 con base de datos BLOCKED por daemon apagado y UI visual no verificada. El orquestador inició la instancia Colima existente y el Compose exclusivo del proyecto; prueba PostgreSQL aislada pasó. Pasada 2 (`FINDINGS.md`, SHA `aa5b769`) reportó 9/10; F-01 resuelto y F-02 minor abierto. Pasada 3/3 (SHA `61280ce`) confirmó 9/10 y validó referencias Redoc; F-01 sigue resuelto y F-02 minor permanece abierto porque no se instaló Playwright/browser. El reporte detallado está en `FINDINGS.md`. Los roles no se comunicaron por conversación: la coordinación se realizó mediante archivos/commits y tareas contextuales independientes.
- No hubo aprobación humana del diseño ni revisión Stitch en esta fase. El evaluador no arregló código; el Generator no editó `SPEC.md` ni `FINDINGS.md`.

## Verificación local posterior en HEAD `26fec66`

Después de la pasada 3, el commit documental `26fec66` añadió el findings, mapa de commits y bitácora final; no cambió código de aplicación. Sobre ese SHA se volvieron a ejecutar `npm ci`, lint, typecheck, tests (API 2, web 1, móvil 1), builds web/API y export Expo Android/iOS, validación/reproducibilidad OpenAPI, ambos documentos Redoc, `npm run qa:bootstrap` (13 PASS, 0 FAIL, 0 BLOCKED) e integración PostgreSQL real (1/1). `npm ci` reportó 28 advisories (1 low, 27 moderate); `npm audit --omit=dev` confirmó 3 moderate en `minimatch` a través de `@expo/fingerprint`/Expo. `npm audit fix --force` propone degradar Expo a 52, incompatible con el SDK 58 fijado; no se aplicó downgrade automático. El reporte runtime de bootstrap permanece ignorado (`docs/qa-report.md`).

## Compatibilidad observada del instalador

El instalador global colocó los documentos Planner/Generator/Evaluator directamente en `skills/forge/`, no en `skills/forge/references/` como las rutas de contexto que describe el `SKILL.md`. Se inspeccionaron y cargaron los archivos en su ubicación real. No se corrigió ni modificó globalmente el skill después de la instalación.
