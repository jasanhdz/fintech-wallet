# Diseño de referencia — Billetera MXN

Esta carpeta existe únicamente en la rama `design-reference`. Contiene PNG de referencia **sanitizados**, no HTML ejecutable ni pantallas de la aplicación:

- `web/source/`: 49 capturas originales redacted de W01–W14.
- `mobile/source/`: 22 capturas originales redacted de M01–M12.
- `manifest.tsv`: hashes SHA-256 de origen y copia, número de regiones enmascaradas y candidatos OCR restantes.
- `README-round3.md`: procedimiento de sanitización y vínculo al artefacto de implementación Web del CI.

Los `code.html` originales y las capturas fuente intactas permanecen en el checkout local de origen, fuera de este repositorio de entrega. No se incluyen para evitar publicar credenciales, OTP o valores financieros de maqueta. Las capturas de implementación asociadas están en `docs/design/references/round3/implementation/`; no son referencias de diseño.

La rama de código `feature/product-mvp` no incluye estos assets. Los cambios de UI deben seguir dentro del alcance obligatorio de `docs/challenge.md` y `specs/`; textos o claims de los exports no autorizan funcionalidades externas ni políticas de producto.
