# Decisiones del coordinador (ronda Web fidelidad final)

Registro de decisiones tomadas por el coordinador sobre dudas que surgen del SPEC. No sustituye al SPEC; el Evaluator debe aplicarlas.

## D-C1 · Medidas de W14 (V1/V2) y densidad de las referencias (2026-11-17)

Las referencias de Stitch están maquetadas a 1280 px CSS y exportadas a 1.25x (PNG de 1600 px). Cuando el SPEC cita medidas de W14-V1/V2 obtenidas directamente en píxeles del PNG (tile 40, texto 18/500, tarjeta 448 con padding 32, círculo 80), son píxeles de imagen, no píxeles CSS. Prevalece la medida CSS equivalente (PNG ÷ 1.25) y el CSS del HTML de referencia: tile 32, texto 16/500, columna 448 con tarjeta 400 y padding 24, círculo 64. El Evaluator NO debe fallar W14-V1/V2 por aplicar los números literales del SPEC; debe comparar contra la referencia a su densidad real (1.25) y contra el CSS del HTML. Regla general ya aplicada por el Generator: donde el SPEC fija un valor explícito y no contradice la referencia gana el SPEC; donde calla gana el PNG/HTML; la accesibilidad prevalece sobre ambos.

## D-C2 · DEP-W1 (login fallido consume el limitador de refresh)

`web/src/api.ts` responde a un 401 de login intentando un refresh. No se toca en esta ronda (tráfico de red congelado). Se atiende en la tanda de integración de Web con el contrato 0.4.0 bajo el coordinador, junto con H-W1..H-W5 (ver ESCALATIONS.md).
