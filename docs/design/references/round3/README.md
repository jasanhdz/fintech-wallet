# Referencias PNG reproducibles — ronda 3

Estas referencias conservan capturas raster de las pantallas, no esquemas de reemplazo. El estado visual queda **pendiente de aceptación** en [`docs/design-fidelity-round3.md`](../../../design-fidelity-round3.md).

## Capturas fuente de diseño

[`source/`](source/) contiene una copia PNG para cada una de las 49 capturas Web y 22 Mobile de `design/` (71 en total), conservando resolución, encuadre, componentes, color y jerarquía. Los originales `design/` siguen intactos y locales.

La copia se generó con [`scripts/qa/sanitize-design-references.swift`](../../../../scripts/qa/sanitize-design-references.swift), usando Vision OCR de macOS. Se cubren las regiones reconocidas con correo y valores numéricos/account-like (CLABE, importes, referencias y códigos); el color de relleno se toma de un píxel adyacente. No se redimensiona ni se recorta la captura. Por límites del OCR pueden permanecer horas/fechas y pequeños indicadores numéricos propios del mockup; el manifiesto registra candidatos OCR restantes para revisión. `source/manifest.tsv` lista cada origen y salida mediante hashes SHA-256 y número de regiones cubiertas. Para regenerar, desde la raíz y con los originales locales disponibles:

```sh
swift scripts/qa/sanitize-design-references.swift
```

La última pasada dejó dos candidatos OCR en prototipos W07 y W13: un reloj de cabecera y un numeral corto de estado. Son copy/indicadores de exportaciones estáticas de diseño, no datos consultados de las bases de la aplicación. Las personas, fechas, importes, referencias y estados restantes son valores de maqueta sin correspondencia conocida con usuarios reales. No se leyeron ni fotografiaron saldos, CLABEs o actividad de `wallet_dev` para crear estas copias.

## Capturas del producto

[`implementation/`](implementation/) contiene las 55 capturas responsive del artefacto de CI para el SHA `2a93ee155322c732b96e0541c4fdbc1cb5421e7d`, producidas desde `wallet_test` y revisadas visualmente. Los E2E generan usuarios y operaciones sintéticas; las máscaras Playwright cubren inputs, selects, CLABE, folio/referencia, balances e importes con el color `#172b4d`. Los bloques oscuros son redacciones de valores de prueba, no estilos de la app. Los textos visibles de usuario/concepto son fixtures sintéticos; ninguna captura usa `wallet_dev`.

Origen verificable: [CI run 43706017068](https://github.com/jasanhdz/fintech-wallet/actions/runs/43706017068), artefacto `visual-captures-2a93ee155322c732b96e0541c4fdbc1cb5421e7d`. Para volver a descargarlo:

```sh
gh run download 43706017068 \
  -n visual-captures-2a93ee155322c732b96e0541c4fdbc1cb5421e7d \
  -D /tmp/fintech-wallet-visual-captures
```

Los SVG `web-desktop.svg` y `mobile-home.svg` que ya existen son resúmenes complementarios; las referencias de inspección por pantalla son los PNG anteriores. Ningún HTML Stitch se ejecuta ni se versiona como interfaz.
