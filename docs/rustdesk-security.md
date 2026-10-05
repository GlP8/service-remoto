# RustDesk: requisitos de seguridad y consentimiento

## Reglas obligatorias del agente cliente

El agente que se distribuya al cliente debe:

- Mostrar una ventana visible mientras exista una sesión remota.
- Mostrar el texto `El tecnico <nombre> esta controlando su pantalla`.
- Incluir un boton rojo `Cerrar conexion`.
- Permitir al cliente cerrar la sesion aunque la API o el tecnico no respondan.
- Usar RustDesk en modo de confirmacion del lado del cliente; nunca acceso desatendido por defecto.
- No iniciar una sesion sin un ticket `ACTIVE` y un tecnico autorizado.
- Registrar el `ticketId`, `technicianId`, `connectedAt` y `disconnectedAt` localmente y enviarlos a la API.

La API ya expone `POST /tickets/:ticketId/disconnect` para que el boton del panel cierre la sesion auditada. El agente nativo debe ejecutar tambien la orden local de terminacion de RustDesk para expulsar realmente la conexion.

## Servidor RustDesk autohospedado

Antes de activar `RUSTDESK_EXECUTE=true` en produccion:

1. Contratar un VPS Linux con IP publica.
2. Instalar `hbbs` y `hbbr` en el mismo VPS o en redes privadas separadas.
3. Generar y proteger el par de claves de RustDesk. Distribuir solo la clave publica a los clientes.
4. Publicar los puertos ID/relay requeridos por la version instalada de RustDesk.
5. Usar un dominio dedicado, por ejemplo `rd.example.com`.
6. Emitir certificados TLS validos con Let's Encrypt para los endpoints web y cualquier proxy de administracion.
7. Restringir el firewall a los puertos RustDesk necesarios y administrar por SSH con claves, no contrasenas.
8. Rotar claves y certificados, monitorizar conexiones y conservar logs de acceso.
9. Configurar el agente con el servidor ID/Relay propio y la clave publica del servidor.
10. Probar una conexion entre dos equipos externos antes de activar ejecucion automatica.

El TLS del dominio no sustituye la clave publica de RustDesk: ambos mecanismos deben configurarse de acuerdo con la version concreta de `hbbs`, `hbbr` y del cliente. No se debe afirmar que existe cifrado extremo a extremo hasta verificarlo con la configuracion desplegada y una prueba de red.

## Auditoria legal

La tabla `Ticket` conserva:

- `technicianId`
- `connectedAt`
- `disconnectedAt`

`connectedAt` solo se escribe cuando el proceso RustDesk confirma `spawn`. Un comando preparado con `RUSTDESK_EXECUTE=false` no se registra como conexion real. El cierre por tecnico, administrador o cliente escribe `disconnectedAt`.
