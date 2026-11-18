# Round 9 · mobile fixes from the iPhone video (2026-11-17)

Made by the coordinator (not Codex) in `mobile/`; uncommitted at the time of writing.

1. **Ahorro had no valid destination.** The only demo beneficiary is the savings account, so choosing Ahorro as origin was blocked and the app fell back to Principal. The picker now has a "MIS CUENTAS" section (the user's other accounts) sent as contract `destinationType: "own_account"` with `destinationAccountId` (no `beneficiaryId`). Origin ≠ destination is still decided by account identity. Test: `Ahorro -> Principal via "Mis cuentas"…` in `mobile/tests/app.test.tsx`.
2. **Stable default account.** `mobile/src/accounts.ts` (`orderAccounts`, `selectAccount`): checking first, then name, then id; the selection is cleared on logout.
3. **Saved passwords.** Login fields now declare `textContentType` (`emailAddress` / `password`), `autoCorrect={false}` so iOS can offer Keychain.
4. **Share receipt.** "Compartir comprobante" now generates the PDF (expo-print) and opens the native sheet (expo-sharing); text is the explicit "Copiar como texto" action and the fallback when expo-sharing is unavailable.
5. **Spacing.** Off-scale `gap` values (6/10/14/7) moved to the 4/8 scale; screen side padding unified at 16 (flow), top padding 16 (picker, detail).

Not verified on device (F-05): autofill in Expo Go, the share sheet with the PDF, safe area.
Known limit: Home block "Destino seleccionado" hierarchy was not redesigned.
