# Cambios de copy · ronda «UX polish»

`docs/web-ux-polish/SPEC.md` §2.2: los textos de W03 (aviso pendiente), W11, W13 («No se realizó ningún cargo»), W14
pendiente, W12 y los avisos demo no cambian salvo para corregir una contradicción. Cada cambio se lista aquí con su
motivo; UX-SC-05 compara el resto byte a byte contra `0cf8257`.

| Tanda | Pantalla/estado | Texto anterior | Texto nuevo | Motivo |
|---|---|---|---|---|
| UX-T3 | W12 · total «Saldo disponible actual» (beneficiario) | `Cuenta {nombre de la cuenta}` | `{nombre de la cuenta}` | Contradicción/duplicación: con el fixture real la línea se leía «Cuenta Cuenta principal» (revisión en navegador, `docs/evidence/web-ux/ux-t2/captures/1440x900/18-w12-comprobante-codigo.png`); el dato no cambia |
| UX-T2 | W10 · razón de deshabilitado | «Autorización deshabilitada: intentos agotados» / «…el código expiró.» / «…el intento se canceló.» | (sin botón «Autorizar…»; la línea bajo las casillas dice «El código ya no puede ingresarse.») | D-UX-8: con intento bloqueado/expirado/cancelado no se renderiza el botón, así que la razón dejaba de describir un control visible. W10 no está en la lista protegida de REC-05 |
