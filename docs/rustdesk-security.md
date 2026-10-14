# RustDesk: requisitos de seguridad y consentimiento

## Agente Windows de cliente (piloto)

El primer agente para Windows 10/11 vive en [`apps/windows-agent`](../apps/windows-agent/).
Se autentica con una cuenta CLIENT, recibe solicitudes solo por el WebSocket
autenticado de esa cuenta y muestra la identidad del tecnico. El cliente debe
aprobar en el agente y tambien aceptar la confirmacion nativa de RustDesk.

El agente de piloto:

- Muestra quien solicita acceso, el ticket y el ID RustDesk.
- Requiere aprobacion local antes de abrir RustDesk.
- Mantiene un boton para intentar terminar RustDesk localmente.
- Cifra el token de sesion guardado usando DPAPI para el usuario actual.
- Cierra el ticket si el cliente rechaza la solicitud.
- No habilita acceso desatendido ni guarda una contrasena permanente.

En este piloto, la aprobacion no se persiste como un evento de consentimiento y
no es un bloqueo de red impuesto a RustDesk. La confirmacion nativa de RustDesk
sigue siendo la barrera real de acceso. Verificar manualmente que el equipo no
tenga acceso desatendido configurado.

El servidor ya no ejecuta RustDesk en su propio host: `POST
/tickets/:ticketId/connect` solo envia una solicitud efimera al agente Windows.
Si el agente no esta conectado, la API lo informa al tecnico y no se registra
una conexion. El tecnico debe iniciar RustDesk en su propio equipo y el cliente
debe aceptar la confirmacion nativa.

El piloto todavia no puede detectar si RustDesk establecio una sesion real.
`connectedAt` no se escribe al solicitar ni aprobar acceso. El boton local
intenta terminar todas las instancias de `rustdesk.exe` visibles para el usuario
actual; no puede prometer detener un servicio RustDesk elevado o ejecutado con
otra cuenta. Por estas limitaciones, no distribuir el agente a clientes ni
considerar la telemetria de sesion lista para produccion.

## Servidor RustDesk autohospedado

Antes de habilitar el servidor RustDesk en produccion:

1. Contratar un VPS Linux con IP publica.
2. Instalar `hbbs` y `hbbr` en el mismo VPS o en redes privadas separadas.
3. Generar y proteger el par de claves de RustDesk. Distribuir solo la clave publica a los clientes.
4. Publicar los puertos ID/relay requeridos por la version instalada de RustDesk.
5. Usar un dominio dedicado, por ejemplo `rd.example.com`.
6. Emitir certificados TLS validos con Let's Encrypt para los endpoints web y cualquier proxy de administracion.
7. Restringir el firewall a los puertos RustDesk necesarios y administrar por SSH con claves, no contrasenas.
8. Rotar claves y certificados, monitorizar conexiones y conservar logs de acceso.
9. Configurar el agente con el servidor ID/Relay propio y la clave publica del servidor.
10. Probar una conexion entre dos equipos externos antes de usarlo con clientes.

El TLS del dominio no sustituye la clave publica de RustDesk: ambos mecanismos deben configurarse de acuerdo con la version concreta de `hbbs`, `hbbr` y del cliente. No se debe afirmar que existe cifrado extremo a extremo hasta verificarlo con la configuracion desplegada y una prueba de red.

## Auditoria legal

La tabla `Ticket` conserva:

- `technicianId`
- `connectedAt`
- `disconnectedAt`

El agente de piloto no puede observar el estado real de la conexion, por lo que
no debe escribir `connectedAt` ni informar que una sesion esta activa solo por
el hecho de que un usuario acepto la solicitud o se abrio RustDesk. Antes de
produccion se necesita un mecanismo verificado para recibir eventos reales de
inicio y fin, ademas de terminar la sesion local de forma fiable.
