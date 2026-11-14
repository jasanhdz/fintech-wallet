# Decisiones de versiones BOOT-00

Versiones fijadas (sin rangos) para builds reproducibles, consultadas el 2026-11-13. El lockfile es la fuente exacta de dependencias transitivas.

| Componente | Versión | Referencia oficial consultada |
|---|---:|---|
| Node.js | 26.3.0 | [Calendario de releases/LTS](https://nodejs.org/en/about/previous-releases): v26 Lithium LTS; release estable 26.3.0 comprobada en el host. |
| Expo SDK | 58.0.24 | [Expo SDK 58](https://docs.expo.dev/versions/v58.0.0/): RN 0.88, React 19.3 y Node >=22.13. |
| React Native | 0.88.0 | [Matriz de Expo SDK 58](https://docs.expo.dev/versions/v58.0.0/). |
| React (móvil) | 19.3.0 | [Matriz de Expo SDK 58](https://docs.expo.dev/versions/v58.0.0/). |
| React / React DOM (web) | 19.3.1 | [React releases](https://react.dev/versions); release estable consultada en npm registry. |
| Express | 5.3.0 | [Express API](https://expressjs.com/en/5x/api.html); release estable consultada en npm registry. |
| TypeORM | 1.1.3 | [TypeORM docs](https://typeorm.io/); documentación actual 1.x. |
| PostgreSQL container | 16.10-alpine | [PostgreSQL version policy](https://www.postgresql.org/support/versioning/), versión fijada >=15. |
| Vite | 8.3.8 | [Vite guide](https://vite.dev/guide/), Node mínimo 20.19/22.12. |
| TypeScript | 5.9.3 | [TypeScript releases](https://www.typescriptlang.org/download/); pinned within openapi-typescript peer range and ESLint parser support. |
| Redocly CLI | 2.78.0 | [Redocly CLI npm](https://www.npmjs.com/package/@redocly/cli), Node >=22.12. |
| openapi-typescript | 7.13.0 | [openapi-typescript npm](https://www.npmjs.com/package/openapi-typescript), soporta OpenAPI 3.1. |

Las releases exactas del registry fueron consultadas directamente con `npm view <paquete> version` (o `npm view expo@58 version`) durante esta sesión. Ningún comando ejecuta descarga/instalación global.
