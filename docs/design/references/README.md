# Referencias visuales curadas — Billetera MXN

Este directorio contiene dos esquemas SVG previos y el paquete de capturas PNG de la ronda 3 en [`round3/`](round3/README.md). Los PNG de `round3/source/` conservan las composiciones de los exports con valores numéricos/email enmascarados; `round3/implementation/` contiene capturas reales de Web del CI con las máscaras Playwright documentadas. Los SVG son resúmenes, no sustitutos de las referencias raster ni de las capturas de implementación. Ninguna referencia ejecuta HTML ni forma parte del código de la app.

## Fuentes y trazabilidad

| Esquema | Original visual representado | SHA-256 del original |
|---|---|---|
| `web-desktop.svg` (síntesis W03+W04) | W03 `screen.png` | `82e8284ee6bca6ecf91ea21aba13d6c1a45c6b22ad49e666317b661bbf5d5f9b` |
| `web-desktop.svg` (síntesis W03+W04) | W03 `code.html` | `f1a3f8e8eb671f8dd706d14543ac25d11c2b634e7a622c0d05ccd583197139a0` |
| `web-desktop.svg` (síntesis W03+W04) | W04 `screen.png` | `de148f161005206593983df0f235826ac6bc7ce53d53739a8459544c8496c6c9` |
| `web-desktop.svg` (síntesis W03+W04) | W04 `code.html` | `17232ee1f33905a2596daf5eeb50a1d7c9708e595260d6ca36f20ea10f78eef2` |
| `mobile-home.svg` (síntesis M02) | M02 `screen.png` | `6595fbc2f4187bf73e44b5b9d63dcf264b1bfea2bf283e60bbfa746cdbeea7bf` |
| `mobile-home.svg` (síntesis M02) | M02 `code.html` | `5f94fde03709b9dd07bca09298ff5604e938511e6c48e60ad6a9ace04c5162d4` |
| Sin síntesis SVG (M09 sigue solo como original local) | M09 `screen.png` | `1dff2b9c02d5da68b25ab18c00d83fa5bf526e379ba527cfaf564dcd85f14d72` |
| Sin síntesis SVG (M09 sigue solo como original local) | M09 `code.html` | `0819d197a115c6c3c5c54503422a49a8996ab1207f1f51c115c085173580f44d` |
| Tokens sistema web | `design/web/billetera_mxn/DESIGN.md` | `4d658d3d99f9578c74712943efcc3cdd94ef10afd513c509f5c0278eadda0903` |
| Tokens sistema móvil | `design/mobile/billetera_mxn/DESIGN.md` | `3ac08d26fe117e9068b5956f4fd91c78928bfce6dc9834434125a2ef1c596ddc` |

Los originales `design/` permanecen intactos y locales; no son necesarios para abrir las referencias PNG ya generadas. Las dos síntesis SVG arriba son opcionales y no sustituyen una captura por pantalla. `round3/source/manifest.tsv` permite verificar los 71 PNG fuente sanitizados; las capturas de producto provienen del artefacto del CI indicado en `round3/README.md`. Las rutas/variantes originales están en `docs/design-mapping.md`; se ignoran las reglas y claims de ejemplo fuera del alcance aprobado.

## Catálogo

- [`web-desktop.svg`](web-desktop.svg): panel y actividad web en escritorio.
- [`mobile-home.svg`](mobile-home.svg): resumen, cuentas y actividad en viewport móvil.
- [`round3/`](round3/README.md): capturas PNG fuente sanitizadas y capturas de implementación de Web del CI, con manifiesto de redacción y procedencia.

Para comparar una implementación, mantener viewport de escritorio 1440 px o Web responsive de 390 px, usar datos sintéticos y revisar estructura, jerarquía, espaciado, tipografía, color y estados contra `docs/design-mapping.md` y `docs/design-fidelity-round3.md`. Los PNG de Web son navegador real; no equivalen a una inspección de Mobile nativo. Ninguna referencia autoriza a declarar completada una transferencia sin respuesta comprobada.
