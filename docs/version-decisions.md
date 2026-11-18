# Decisiones de versiones BOOT-00

Versiones fijadas (sin rangos) para builds reproducibles, consultadas el 2026-11-13. El lockfile es la fuente exacta de dependencias transitivas.

| Componente | Versión | Referencia oficial consultada |
|---|---:|---|
| Node.js | 26.13.1 | [Calendario de releases/LTS](https://nodejs.org/en/about/previous-releases): v26 Lithium figura como LTS y 26.13.1 como release mantenida al 2026-11-13. |
| Expo SDK | 58.0.25 | [Expo SDK 58](https://docs.expo.dev/versions/v58.0.0/): RN 0.88, React 19.3 y Node >=22.13. `npx expo install --check` indicó ~58.0.25. |
| React Native | 0.88.1 | [Matriz de Expo SDK 58](https://docs.expo.dev/versions/v58.0.0/). `npx expo install --check` indicó 0.88.1. |
| React (móvil) | 19.3.0 | [Matriz de Expo SDK 58](https://docs.expo.dev/versions/v58.0.0/). |
| React / React DOM (web y móvil) | 19.3.0 | [Matriz oficial Expo SDK 58](https://docs.expo.dev/versions/v58.0.0/): React 19.3.0; los cuatro workspaces deduplican el runtime para evitar dos Reacts en Metro. |
| Express | 5.3.0 | [Express API](https://expressjs.com/en/5x/api.html); release estable consultada en npm registry. |
| TypeORM | 1.1.3 | [TypeORM docs](https://typeorm.io/); documentación actual 1.x. |
| PostgreSQL container | 16.10-alpine | [PostgreSQL version policy](https://www.postgresql.org/support/versioning/), versión fijada >=15. |
| Vite | 8.3.8 | [Vite guide](https://vite.dev/guide/), Node mínimo 20.19/22.12. |
| TypeScript | 5.9.3 | [TypeScript releases](https://www.typescriptlang.org/download/); pinned within openapi-typescript peer range and ESLint parser support. |
| Redocly CLI | 2.78.0 | [Redocly CLI npm](https://www.npmjs.com/package/@redocly/cli), Node >=22.12. |
| openapi-typescript | 7.13.0 | [openapi-typescript npm](https://www.npmjs.com/package/openapi-typescript), soporta OpenAPI 3.1. |
| Playwright Test | 1.65.1 | [Playwright docs](https://playwright.dev/docs/intro); browser smoke de scaffold web solamente. |
| API security/test | `bcryptjs` 3.0.3, `jose` 6.2.17, `express-rate-limit` 8.7.4, `helmet` 8.3.0, `zod` 4.6.7 | Registry metadata; bcrypt pure JS avoids native addon, JOSE supports Node 20+, rate-limit supports Express 5. |
| Web data/routing/test | TanStack Query 5.107.1, React Router 7.18.5, Testing Library React 16.3.3, User Event 14.6.10 | React 19 peers; current test runner is Node test via `tsx`, with JSDOM/Testing Library. |
| Expo Router | 58.0.31 | [Expo SDK 58 Router reference](https://docs.expo.dev/versions/v58.0.0/sdk/router/): SDK-compatible, included in Expo Go. |
| Expo SecureStore | 58.0.3 | [Expo SDK 58 SecureStore](https://docs.expo.dev/versions/v58.0.0/sdk/securestore/): SDK-compatible; no biometric requirement enabled. |
| React Native web export | React Native Web 0.21.4 + React DOM 19.3.0 | `npx expo install react-native-web react-dom` selected versions compatible with Expo SDK 58. |

Las releases exactas del registry fueron consultadas directamente con `npm view <paquete> version` (o `npm view expo@58 version`) durante esta sesión. Ningún comando ejecuta descarga/instalación global.

El pin Node anterior (26.3.0) pertenecía a una rama LTS soportada, pero el calendario oficial ya listaba 26.13.1 como release LTS actual. Para usar el parche mantenido se elevó el pin a 26.13.1; TypeORM 1.1.3 declara Node `^20.19 || ^22.13 || >=24.11`, Express 5 requiere >=18, React Native 0.88.1 requiere Node 22.13/24.3/26.0 o superior. Esta versión satisface todas esas condiciones. Expo Router trajo una peer opcional de React Native Testing Library que colocaba Jest en el árbol `--omit=dev`; se descartó esa biblioteca y se conserva el renderer Expo/Jest ya compatible. Además, Expo Router había auto-hoisted React 19.3.1 junto a 19.3.0 SDK58: React y ReactDOM 19.3.0 quedan fijados en raíz para deduplicar runtime en todos los workspaces. Vitest se había añadido inicialmente para tests web, pero no se retuvo: se usa el runner Node `tsx` existente junto a Testing Library para no añadir otro test runner/toolchain; la suite web debe usar `tsx --test`.
