# Recorrido móvil para validación del revisor

La ronda sigue **pendiente de aceptación**. La app nativa no se inspeccionó visualmente en un teléfono/simulador desde el host; este recorrido está preparado para que el revisor haga esa comprobación en Expo Go.

## Sesión ya preparada en esta Mac

- Versión publicada: `2a93ee155322c732b96e0541c4fdbc1cb5421e7d`.
- API: <http://localhost:3200/health> — debe responder `200`.
- Web: <http://localhost:5174/login>.
- Metro: puerto `8082`; Expo Go puede abrir `exp://192.168.100.8:8082`.
- API para teléfono físico: `http://192.168.100.8:3200/v1`.
- Base: `wallet_dev`. Se usa el perfil/credencial local ya existente en `README.md`; no se ejecutó seed, migración ni reset durante esta verificación.

El teléfono debe estar en la misma Wi-Fi que la Mac. Si cambia la IP, obtén la nueva con `ipconfig getifaddr en0` y usa esa dirección en el URL de Expo y en `EXPO_PUBLIC_API_URL`. No uses `localhost` en el teléfono.

## Pasos de revisión

1. Abre Expo Go y escanea el QR de Metro o introduce `exp://192.168.100.8:8082` manualmente.
2. Inicia sesión con el perfil local existente. Confirma que aparece Inicio con **Cuenta principal** y **Ahorro**; cambia la selección entre ambas.
3. Abre Movimientos para cada cuenta. Verifica lista/estado vacío y abre el detalle de un movimiento disponible, sin compartir capturas con valores visibles.
4. Abre **Elegir beneficiario** y busca el beneficiario ya registrado. Vuelve a Inicio y entra en **Continuar con transferencia**.
5. Avanza por Datos → Revisión y detente ahí; vuelve atrás para comprobar la navegación. **No confirmes ni envíes** durante esta aceptación visual.
6. Envía la app al fondo y vuelve. Comprueba la pantalla de privacidad y que la sesión se revalida al regresar.
7. Si quieres probar el botón Cerrar sesión, vuelve a iniciar sesión con el mismo perfil. No uses “registrar”, `db:seed`, `wallet_test` ni una base distinta.

## Alcance de esta inspección

Login, recuperación de sesión, cuentas, beneficiarios, movimientos y formularios pueden revisarse en el teléfono. Los estados OTP, resultado incierto, recibo y rechazo están implementados y cubiertos por pruebas/exportación, pero el recorrido anterior no los ejecuta para evitar crear actividad financiera de demo. La fidelidad nativa se marcará como inspeccionada solo después de recibir la revisión del teléfono.
