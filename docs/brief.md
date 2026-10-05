# Service Remoto - Brief completo

## 1. Resumen ejecutivo

Service Remoto es una plataforma web para una startup de mantenimiento tecnico de computadores 100% remoto. El cliente solicita asistencia desde un panel, el equipo tecnico recibe la alerta, reclama el ticket y puede iniciar una sesion RustDesk sobre el computador autorizado.

El producto prioriza:

- Simplicidad para el cliente.
- Automatizacion para el equipo tecnico.
- Consentimiento explicito para recopilar datos tecnicos.
- Trazabilidad legal de cada conexion remota.
- Control permanente del cliente sobre la sesion.
- Pagos y suscripciones mediante Stripe.
- Infraestructura RustDesk autohospedada.

## 2. Objetivo del producto

Permitir que una persona sin conocimientos tecnicos pueda:

1. Crear una cuenta.
2. Aceptar el consentimiento de diagnostico.
3. Registrar su computador y su RustDesk ID.
4. Solicitar soporte con un boton.
5. Ver el estado de la solicitud en tiempo real.
6. Saber que tecnico esta conectado.
7. Cerrar la conexion inmediatamente si lo necesita.
8. Consultar el historial de soporte y conexiones.

El equipo tecnico debe poder:

1. Recibir tickets en tiempo real.
2. Reclamar una solicitud.
3. Iniciar RustDesk solo sobre un ticket autorizado.
4. Ver el RustDesk ID del equipo.
5. Cerrar la atencion y dejar un registro auditable.

## 3. Stack tecnologico

### Frontend

- React 19.
- TypeScript.
- Vite.
- Tailwind CSS 4.
- Lucide React.
- WebSocket nativo del navegador.

### Backend

- Node.js.
- Express 5.
- TypeScript.
- PostgreSQL.
- Prisma ORM 8 RC con contrato PSL.
- `pg` para el adaptador actual de persistencia de la API.
- JWT.
- bcryptjs.
- Zod.
- express-rate-limit.
- WebSocket mediante `ws`.
- Stripe SDK.

### Control remoto

- RustDesk cliente.
- RustDesk Server ID (`hbbs`).
- RustDesk Relay (`hbbr`).
- Ejecucion controlada de `rustdesk.exe`.
- VPS Linux con dominio, claves y TLS.

## 4. Estructura actual

```text
service remoto/
├── apps/
│   └── client-web/
│       ├── public/
│       │   ├── Logo.png
│       │   └── favicon.png
│       └── src/
│           ├── App.tsx
│           ├── App.css
│           ├── AuthScreen.tsx
│           └── index.css
├── services/
│   └── api/
│       ├── prisma/
│       │   ├── schema.prisma
│       │   ├── schema.json
│       │   ├── schema.d.ts
│       │   └── db.ts
│       └── src/
│           ├── app.ts
│           ├── server.ts
│           ├── infrastructure/
│           │   ├── database/pool.ts
│           │   └── realtime/technician-hub.ts
│           └── modules/
│               ├── auth/
│               ├── computers/
│               ├── tickets/
│               └── payments/
└── docs/
    ├── brief.md
    └── rustdesk-security.md
```

## 5. Modelo de datos

### User

- `id`
- `email`
- `passwordHash`
- `name`
- `role`: `CLIENT`, `TECHNICIAN`, `ADMIN`
- `diagnosticConsentAt`
- `diagnosticConsentVersion`
- `createdAt`
- `updatedAt`

El consentimiento se guarda con fecha y version del texto aceptado.

### Computer

- `id`
- `userId`
- `os`
- `ram`
- `storageFree`
- `rustdeskId`
- `status`: `ONLINE`, `OFFLINE`

### Ticket

- `id`
- `clientId`
- `technicianId`
- `computerId`
- `status`: `PENDING`, `ACTIVE`, `CLOSED`
- `rustdeskSessionToken`
- `connectedAt`
- `disconnectedAt`
- `createdAt`
- `updatedAt`

### Payment

- `id`
- `userId`
- `stripeSubscriptionId`
- `stripeCheckoutSessionId`
- `amount`
- `status`: `PENDING`, `PAID`, `FAILED`, `CANCELED`, `REFUNDED`
- `createdAt`
- `updatedAt`

### ConnectionAuditLog

Tabla append-only para auditoria legal:

- `id`
- `ticketId`
- `technicianId`
- `action`: `STARTED`, `ENDED`
- `occurredAt`
- `reason`

Existe un trigger PostgreSQL que bloquea `UPDATE` y `DELETE` sobre esta tabla.

Para una inmutabilidad fuerte en produccion tambien deben separarse los roles PostgreSQL y quitar los permisos de mutacion al usuario de la aplicacion.

## 6. Flujo principal del cliente

1. El cliente abre el panel React.
2. Inicia sesion o crea una cuenta.
3. En registro debe aceptar el texto de diagnostico tecnico.
4. El backend guarda el consentimiento y su version.
5. El cliente registra el equipo y su RustDesk ID.
6. El cliente pulsa `Solicitar soporte ahora`.
7. La API crea un ticket `PENDING`.
8. El cliente recibe cambios mediante WebSocket.
9. El tecnico reclama el ticket y pasa a `ACTIVE`.
10. RustDesk se inicia solo cuando la configuracion esta habilitada.
11. El cliente ve quien controla su pantalla y la hora de inicio.
12. El cliente puede pulsar `Cerrar conexion`.
13. La API registra `disconnectedAt` y un evento `ENDED`.
14. El ticket termina en `CLOSED`.

La API bloquea nuevas solicitudes si el cliente ya tiene un ticket `PENDING` o `ACTIVE`.

## 7. Flujo tecnico

1. El tecnico inicia sesion con rol `TECHNICIAN`.
2. Abre el canal `ws://host/ws/technicians?token=JWT`.
3. Recibe eventos `ticket.created`.
4. Reclama el ticket con `PATCH /tickets/:id/claim`.
5. El ticket queda `ACTIVE` y se asigna `technicianId`.
6. Solicita conexion con `POST /tickets/:id/connect`.
7. La API valida ticket, tecnico, equipo y RustDesk ID.
8. Si `RUSTDESK_EXECUTE=false`, solo devuelve el comando preparado.
9. Si esta habilitado, verifica el binario, ejecuta RustDesk y registra `connectedAt`.
10. El tecnico cierra con `PATCH /tickets/:id/close`.
11. La API registra `disconnectedAt` y evento `ENDED`.

## 8. API actual

### Salud

```text
GET /health
```

### Autenticacion

```text
POST /auth/register
POST /auth/login
```

El registro requiere `diagnosticConsentAccepted: true`.

### Computadores

```text
POST  /computers
GET   /computers
PATCH /computers/:id/status
```

### Tickets

```text
POST  /tickets
GET   /tickets
PATCH /tickets/:id/claim
PATCH /tickets/:id/close
POST  /tickets/:id/connect
POST  /tickets/:id/disconnect
```

### WebSocket

```text
/ws/technicians?token=JWT
/ws/client?token=JWT
```

Eventos principales:

```text
ticket.created
ticket.updated
```

### Pagos

```text
POST /payments/checkout
POST /payments/webhook
```

El webhook verifica la firma de Stripe y evita duplicados mediante `stripeCheckoutSessionId`.

## 9. Panel cliente

El panel React incluye:

- Login.
- Registro con consentimiento obligatorio.
- Branding ZED Emprendedor.
- Dashboard.
- Inventario de equipos.
- Registro de computador.
- Solicitud de soporte.
- Historial de tickets.
- Navegacion entre Inicio, Mis equipos, Soporte y Centro de ayuda.
- Estado de WebSocket.
- Aviso visible de tecnico conectado.
- Hora de inicio de conexion.
- Boton rojo para cerrar conexion.
- Diseno responsive.
- Paleta azul noche, violeta y cian.
- Animaciones con soporte para `prefers-reduced-motion`.

URL local:

```text
http://localhost:5173/
```

## 10. Seguridad implementada

- Hash de contrasenas con bcrypt.
- JWT con expiracion.
- Validacion de roles.
- Validacion de entradas con Zod en autenticacion y pagos.
- Rate limiting para `/auth`.
- CORS restringido por `CLIENT_ORIGIN`.
- Limite de payload JSON.
- Tokens guardados en `sessionStorage` en lugar de `localStorage`.
- Consultas PostgreSQL parametrizadas.
- Verificacion de propiedad de computadores.
- Verificacion de propiedad y estado de tickets.
- RustDesk no se ejecuta por defecto.
- Validacion de RustDesk ID.
- Ruta RustDesk absoluta y comprobacion del ejecutable.
- Registro append-only de conexiones.

## 11. Variables de entorno

```env
DATABASE_URL="postgresql://..."
JWT_SECRET="..."
CLIENT_ORIGIN="http://localhost:5173"
CLIENT_APP_URL="http://localhost:5173"
DIAGNOSTIC_CONSENT_VERSION="2026-09-24-v1"
RUSTDESK_BIN="C:/Program Files/RustDesk/rustdesk.exe"
RUSTDESK_EXECUTE="false"
STRIPE_SECRET_KEY="sk_test_..."
STRIPE_WEBHOOK_SECRET="whsec_..."
```

Nunca subir `.env` al repositorio ni compartir tokens, contrasenas o claves Stripe.

## 12. Estado actual

### Funcionando

- PostgreSQL local.
- Contrato Prisma emitido.
- Tablas principales creadas.
- API Express.
- Login y registro.
- Consentimiento obligatorio en nuevos registros.
- Computadores.
- Tickets.
- Roles.
- WebSockets.
- Flujo `PENDING -> ACTIVE -> CLOSED`.
- RustDesk en modo preparado y controlado.
- Auditoria de conexion en Ticket.
- Tabla append-only de auditoria.
- Panel cliente.
- Branding y responsive.
- Stripe preparado en backend.
- Pruebas automatizadas de API y CI en GitHub Actions.
- Builds de cliente para produccion y staging con validacion de URL API.

### No terminado

- Despliegue del entorno staging; instrucciones y plantillas en [`staging.md`](staging.md).
- Agente nativo RustDesk con ventana flotante.
- Boton local que mate la sesion RustDesk en el equipo cliente.
- Servidor `hbbs`/`hbbr` en VPS.
- TLS productivo para RustDesk.
- Claves RustDesk propias y rotacion.
- Stripe con claves reales y webhook publico HTTPS.
- Suscripciones recurrentes completas.
- Refresh tokens HttpOnly.
- Roles PostgreSQL separados para inmutabilidad fuerte.
- Flujo automatizado de CI/CD para despliegue.
- Backups y monitorizacion productiva.

## 13. Prioridad recomendada

### Prioridad 1: agente RustDesk

Crear el agente nativo que:

- Configure RustDesk con el servidor propio.
- Muestre el nombre del tecnico.
- Muestre una ventana siempre visible durante la sesion.
- Permita cerrar la conexion localmente.
- Informe el inicio y fin al backend.
- No permita acceso desatendido por defecto.

### Prioridad 2: infraestructura RustDesk

- VPS Linux.
- `hbbs` y `hbbr`.
- Dominio.
- Claves RustDesk.
- TLS.
- Firewall.
- Monitorizacion.

### Prioridad 3: seguridad de produccion

- Refresh tokens HttpOnly.
- HTTPS obligatorio.
- Roles PostgreSQL separados.
- Backups cifrados.
- Logs estructurados.
- Alertas.

### Prioridad 4: Stripe

- Crear productos/precios.
- Configurar claves.
- Publicar webhook HTTPS.
- Actualizar el plan del cliente.
- Gestionar cancelacion, renovacion y reembolso.

### Prioridad 5: pruebas y despliegue

- Ampliar pruebas de autenticacion, consentimiento, auditoria y WebSocket.
- Tests de Stripe.
- Tests E2E del panel.
- Docker.
- Aprovisionar staging y configurar CD; ver [`staging.md`](staging.md).

## 14. Criterios de aceptacion de seguridad

El producto no debe considerarse listo para produccion hasta que:

- El consentimiento sea obligatorio y versionado.
- Toda conexion tenga tecnico, inicio y fin.
- El cliente pueda cerrar la sesion localmente.
- RustDesk no opere como espia o acceso desatendido por defecto.
- El servidor RustDesk use claves propias y TLS configurado.
- Los logs no puedan ser mutados por el usuario de la aplicacion.
- Stripe valide webhooks mediante firma.
- Existan backups y pruebas de restauracion.
- El panel y la API usen HTTPS en produccion.
