import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowUpRight, CheckCircle2, ChevronDown, CircleHelp, Laptop, LifeBuoy, Monitor, Plus, RefreshCw, ShieldCheck, Signal, Sparkles, Ticket, Wifi, X } from 'lucide-react'
import { AuthScreen } from './AuthScreen'
import { TechnicianDashboard } from './TechnicianDashboard'
import { ClientWebSocketStatus, useClientWebSocket } from './hooks/useClientWebSocket'
import './App.css'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'
type User = { id: number; email: string; name: string | null; role: string }
type Computer = { id: number; os: string; ram: string; storageFree: string; rustdeskId: string; status: 'ONLINE' | 'OFFLINE' }
type Ticket = { id: number; computerId: number | null; status: 'PENDING' | 'ACTIVE' | 'CLOSED'; createdAt: string; rustdeskSessionToken: string; technicianId?: number | null; technicianName?: string | null; connectedAt?: string | null; disconnectedAt?: string | null }
type Session = { user: User; token: string }

async function api<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers } })
  if (!response.ok) { const body = await response.json().catch(() => null); throw new Error(body?.error ?? 'No se pudo completar la solicitud') }
  return response.json() as Promise<T>
}

export default function App() {
  const [session, setSession] = useState<Session | null>(() => { const saved = sessionStorage.getItem('service-remoto-session'); return saved ? JSON.parse(saved) : null })
  const [computers, setComputers] = useState<Computer[]>([])
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showComputerForm, setShowComputerForm] = useState(false)
  const [activeView, setActiveView] = useState<'home' | 'computers' | 'support' | 'help'>('home')

  async function loadDashboard() {
    if (!session) return
    setLoading(true)
    try { const [computerData, ticketData] = await Promise.all([api<{ computers: Computer[] }>('/computers', {}, session.token), api<{ tickets: Ticket[] }>('/tickets', {}, session.token)]); setComputers(computerData.computers); setTickets(ticketData.tickets); setError('') } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'No se pudo cargar el panel') } finally { setLoading(false) }
  }
  useEffect(() => { void loadDashboard() }, [session?.token])
  const { status: websocketStatus } = useClientWebSocket<Ticket>({
    onTicketUpdated: (updatedTicket) => {
      setTickets((current) => current.map((ticket) => (
        ticket.id === updatedTicket.id ? { ...ticket, ...updatedTicket } : ticket
      )))
    },
  })
  function login(result: Session) { sessionStorage.setItem('service-remoto-session', JSON.stringify(result)); setSession(result) }
  function logout() { sessionStorage.removeItem('service-remoto-session'); setSession(null); setComputers([]); setTickets([]) }
  async function requestSupport() { try { const result = await api<{ ticket: Ticket }>('/tickets', { method: 'POST', body: JSON.stringify({ computerId: computers[0]?.id }) }, session?.token); setTickets((current) => [result.ticket, ...current]) } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'No se pudo crear el ticket') } }
  if (!session) return <AuthScreen onLogin={login} />
  if (session.user.role === 'TECHNICIAN' || session.user.role === 'ADMIN') {
    return <TechnicianDashboard
      token={session.token}
      userName={session.user.name ?? session.user.email}
      onLogout={logout}
    />
  }
  const activeTickets = tickets.filter((ticket) => ticket.status !== 'CLOSED')
  const activeConnection = tickets.find((ticket) => ticket.status === 'ACTIVE' && ticket.connectedAt && !ticket.disconnectedAt)
  const onlineComputers = computers.filter((computer) => computer.status === 'ONLINE').length

  async function disconnectCurrentTicket() {
    if (!activeConnection || !session) return
    try {
      await api(`/tickets/${activeConnection.id}/disconnect`, { method: 'POST' }, session.token)
      setTickets((current) => current.map((ticket) => ticket.id === activeConnection.id ? { ...ticket, status: 'CLOSED', disconnectedAt: new Date().toISOString() } : ticket))
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : 'No se pudo cerrar la conexión')
    }
  }

  return <main className="app-shell">
    <aside className="sidebar"><div className="brand-mark"><img src="/favicon.png" alt="" /><strong>ZED<br />Emprendedor</strong></div><div className="side-rule" /><nav className="side-nav"><button className={`nav-item ${activeView === 'home' ? 'active' : ''}`} onClick={() => setActiveView('home')}><Monitor size={18} /> Inicio</button><button className={`nav-item ${activeView === 'computers' ? 'active' : ''}`} onClick={() => setActiveView('computers')}><Laptop size={18} /> Mis equipos <span>{computers.length}</span></button><button className={`nav-item ${activeView === 'support' ? 'active' : ''}`} onClick={() => setActiveView('support')}><Ticket size={18} /> Soporte <span>{activeTickets.length}</span></button></nav><div className="sidebar-foot"><div className="security-note"><ShieldCheck size={17} /><span>Conexión protegida<br /><b>Servicio activo</b></span></div><button className={`nav-item ${activeView === 'help' ? 'active' : ''}`} onClick={() => setActiveView('help')}><CircleHelp size={18} /> Centro de ayuda</button></div></aside>
    <section className="workspace"><header className="topbar"><div className="breadcrumb">Panel del cliente <ChevronDown size={15} /></div><div className="account-menu"><div className="avatar">{(session.user.name ?? session.user.email)[0].toUpperCase()}</div><span>{session.user.name ?? session.user.email}</span><button className="logout" onClick={logout}>Salir</button></div></header>
      <div className="content"><div className="page-heading"><div><p className="eyebrow">{formatDate(new Date())}</p><h1>{activeView === 'home' ? `Hola, ${session.user.name?.split(' ')[0] ?? 'cliente'}` : viewTitle(activeView)}</h1><p className="muted">{viewSubtitle(activeView)}</p></div><button className="icon-button" title="Actualizar datos" onClick={() => void loadDashboard()}><RefreshCw size={18} className={loading ? 'spin' : ''} /></button></div>
        {error && <div className="error-banner"><span>{error}</span><button onClick={() => setError('')} title="Cerrar"><X size={16} /></button></div>}
        {activeConnection && <ConnectionNotice ticket={activeConnection} onDisconnect={() => void disconnectCurrentTicket()} />}
        {activeView === 'home' && <><section className="support-hero"><div className="hero-copy"><div className="live-pill"><span className={`live-dot ${websocketStatus.toLowerCase()}`} /> {websocketStatusLabel(websocketStatus)}</div><h2>Tu computador,<br /><em>siempre acompañado.</em></h2><p>Conecta con nuestro equipo técnico y resuelve cualquier problema sin salir de casa.</p><button className="primary-button" disabled={activeTickets.length > 0} onClick={() => void requestSupport()}><LifeBuoy size={18} /> {activeTickets.length > 0 ? 'Solicitud en curso' : 'Solicitar soporte ahora'} <ArrowUpRight size={17} /></button></div><div className="hero-signal"><div className="signal-ring ring-one" /><div className="signal-ring ring-two" /><div className="signal-core"><Wifi size={27} /></div><span className="signal-label label-top">24 / 7</span><span className="signal-label label-bottom">remoto · seguro</span></div></section><div className="stats-grid"><StatCard label="Equipos registrados" value={String(computers.length)} detail={`${onlineComputers} conectados`} icon={<Laptop size={19} />} /><StatCard label="Solicitudes abiertas" value={String(activeTickets.length)} detail={activeTickets.length ? 'Atención en curso' : 'Sin solicitudes pendientes'} icon={<Signal size={19} />} accent={activeTickets.length > 0} /><StatCard label="Plan de servicio" value="Activo" detail="Mantenimiento remoto" icon={<Sparkles size={19} />} /></div><div className="section-grid"><EquipmentPanel computers={computers} onAdd={() => setShowComputerForm(true)} /><SupportPanel tickets={tickets} /></div></>}
        {activeView === 'computers' && <EquipmentPanel computers={computers} onAdd={() => setShowComputerForm(true)} expanded />}
        {activeView === 'support' && <SupportPanel tickets={tickets} expanded onRequest={() => void requestSupport()} />}
        {activeView === 'help' && <HelpPanel onSupport={() => { setActiveView('support'); void requestSupport() }} />}
      </div></section>{showComputerForm && <ComputerModal token={session.token} onClose={() => setShowComputerForm(false)} onCreated={() => { setShowComputerForm(false); void loadDashboard() }} />}
  </main>
}

function LoginScreen({ onLogin }: { onLogin: (result: Session) => void }) { const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setError(''); try { onLogin(await api<Session>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })) } catch (loginError) { setError(loginError instanceof Error ? loginError.message : 'No se pudo iniciar sesión') } finally { setBusy(false) } } return <main className="login-page"><div className="login-art"><div className="brand-mark light"><span>sr</span><strong>service<br />remoto</strong></div><div className="art-copy"><p className="eyebrow">Soporte técnico sin desplazamientos</p><h1>Tu equipo.<br /><em>En buenas manos.</em></h1><p>Asistencia humana, rápida y segura para que puedas seguir trabajando.</p></div><div className="art-footer"><span>01</span><div /><span>servicio remoto · 2026</span></div></div><section className="login-form-wrap"><div className="login-form"><p className="eyebrow">Área de clientes</p><h2>Bienvenido de vuelta</h2><p className="muted">Accede para cuidar tus equipos.</p><form onSubmit={submit}><label>Correo electrónico<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="tu@correo.com" /></label><label>Contraseña<input type="password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••" /></label>{error && <p className="form-error">{error}</p>}<button className="primary-button full" disabled={busy}>{busy ? 'Entrando...' : 'Entrar al panel'} <ArrowUpRight size={17} /></button></form><p className="login-footnote"><ShieldCheck size={15} /> Tus datos viajan cifrados</p></div></section></main> }
function ComputerRow({ computer }: { computer: Computer }) { return <div className="equipment-row"><div className="device-icon"><Laptop size={21} /></div><div className="device-info"><strong>{computer.os}</strong><span>{computer.ram} · {computer.storageFree} libres</span></div><div className={`status ${computer.status.toLowerCase()}`}><span /> {computer.status === 'ONLINE' ? 'En línea' : 'Desconectado'}</div></div> }
function TicketRow({ ticket }: { ticket: Ticket }) { return <div className="ticket-row"><div className={`ticket-icon ${ticket.status.toLowerCase()}`}><Ticket size={17} /></div><div><strong>Solicitud #{ticket.id}</strong><span>{ticket.status === 'PENDING' ? 'Esperando técnico' : ticket.status === 'ACTIVE' ? 'Atención en curso' : 'Resuelta'} · {formatTime(ticket.createdAt)}</span></div><span className={`status-label ${ticket.status.toLowerCase()}`}>{ticket.status}</span></div> }
function ConnectionNotice({ ticket, onDisconnect }: { ticket: Ticket; onDisconnect: () => void }) { return <div className="connection-notice" role="alert"><div className="connection-live"><span /> CONEXIÓN ACTIVA</div><strong>El técnico {ticket.technicianName ?? `#${ticket.technicianId ?? ''}`} está controlando su pantalla</strong><small>Inicio: {ticket.connectedAt ? formatDateTime(ticket.connectedAt) : 'registrando...'}</small><button className="disconnect-button" onClick={onDisconnect}>Cerrar conexión</button></div> }
function EquipmentPanel({ computers, onAdd, expanded = false }: { computers: Computer[]; onAdd: () => void; expanded?: boolean }) { return <section className={`panel ${expanded ? 'panel-expanded' : ''}`}><div className="panel-heading"><div><p className="eyebrow">Tu inventario</p><h3>Mis equipos</h3></div><button className="text-button" onClick={onAdd}><Plus size={16} /> Añadir equipo</button></div>{computers.length ? <div className="equipment-list">{computers.map((computer) => <ComputerRow key={computer.id} computer={computer} />)}</div> : <EmptyState onAdd={onAdd} />}</section> }
function SupportPanel({ tickets, expanded = false, onRequest }: { tickets: Ticket[]; expanded?: boolean; onRequest?: () => void }) { return <section className={`panel ${expanded ? 'panel-expanded' : ''}`}><div className="panel-heading"><div><p className="eyebrow">Actividad reciente</p><h3>Soporte</h3></div><div className="panel-actions"><span className="count-badge">{tickets.length}</span>{onRequest && <button className="small-button" onClick={onRequest}><LifeBuoy size={15} /> Solicitar ayuda</button>}</div></div>{tickets.length ? <div className="ticket-list">{tickets.map((ticket) => <TicketRow key={ticket.id} ticket={ticket} />)}</div> : <div className="quiet-state"><Ticket size={22} /><p>Aún no has solicitado soporte.</p>{onRequest && <button className="small-button" onClick={onRequest}>Solicitar soporte</button>}</div>}</section> }
function HelpPanel({ onSupport }: { onSupport: () => void }) { return <section className="help-grid"><div className="panel help-card"><div className="device-icon"><CircleHelp size={22} /></div><p className="eyebrow">Asistencia rápida</p><h3>¿El problema no puede esperar?</h3><p className="muted">Solicita un técnico y recibe seguimiento en vivo desde este panel.</p><button className="primary-button" onClick={onSupport}><LifeBuoy size={17} /> Solicitar soporte</button></div><div className="panel help-card"><div className="device-icon"><ShieldCheck size={22} /></div><p className="eyebrow">Antes de conectar</p><h3>Prepara tu equipo</h3><ul className="help-list"><li>Guarda tu trabajo y cierra documentos sensibles.</li><li>Deja RustDesk abierto en tu computador.</li><li>Verifica que el equipo aparezca en línea.</li></ul></div></section> }
function viewTitle(view: 'home' | 'computers' | 'support' | 'help') { return view === 'computers' ? 'Mis equipos' : view === 'support' ? 'Soporte remoto' : 'Centro de ayuda' }
function viewSubtitle(view: 'home' | 'computers' | 'support' | 'help') { return view === 'computers' ? 'Administra tus dispositivos y su conexión.' : view === 'support' ? 'Solicita y sigue la atención de tus equipos.' : view === 'help' ? 'Resuelve lo básico o conecta con un técnico.' : 'Todo bajo control. ¿Qué necesitas resolver hoy?' }
function websocketStatusLabel(status: ClientWebSocketStatus) { return status === ClientWebSocketStatus.CONNECTED ? 'Seguimiento en vivo' : status === ClientWebSocketStatus.CONNECTING ? 'Conectando seguimiento' : 'Seguimiento pausado' }
function StatCard({ label, value, detail, icon, accent = false }: { label: string; value: string; detail: string; icon: ReactNode; accent?: boolean }) { return <div className={`stat-card ${accent ? 'accent' : ''}`}><div className="stat-icon">{icon}</div><p>{label}</p><strong>{value}</strong><span>{detail}</span></div> }
function EmptyState({ onAdd }: { onAdd: () => void }) { return <div className="empty-state"><Monitor size={26} /><div><strong>Añade tu primer equipo</strong><p>Así podremos conectarte más rápido con un técnico.</p></div><button className="small-button" onClick={onAdd}><Plus size={15} /> Añadir</button></div> }
function ComputerModal({ token, onClose, onCreated }: { token: string; onClose: () => void; onCreated: () => void }) { const [form, setForm] = useState({ os: 'Windows 11', ram: '', storageFree: '', rustdeskId: '' }); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setError(''); try { await api('/computers', { method: 'POST', body: JSON.stringify({ ...form, rustdeskId: form.rustdeskId.replace(/\s+/g, '') }) }, token); onCreated() } catch (submitError) { setError(submitError instanceof Error ? submitError.message : 'No se pudo registrar') } finally { setBusy(false) } } return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="modal" onSubmit={submit}><div className="modal-heading"><div><p className="eyebrow">Nuevo registro</p><h3>Añadir equipo</h3></div><button type="button" className="icon-button" onClick={onClose} title="Cerrar"><X size={17} /></button></div><label>Sistema operativo<input required value={form.os} onChange={(event) => setForm({ ...form, os: event.target.value })} /></label><div className="form-two"><label>RAM<input required value={form.ram} onChange={(event) => setForm({ ...form, ram: event.target.value })} placeholder="16 GB" /></label><label>Espacio libre<input required value={form.storageFree} onChange={(event) => setForm({ ...form, storageFree: event.target.value })} placeholder="250 GB" /></label></div><label>ID de RustDesk<input required value={form.rustdeskId} onChange={(event) => setForm({ ...form, rustdeskId: event.target.value })} placeholder="123 456 789" /></label>{error && <p className="form-error">{error}</p>}<button className="primary-button full" disabled={busy}>{busy ? 'Guardando...' : 'Guardar equipo'} <CheckCircle2 size={17} /></button></form></div> }
function formatDate(date: Date) { return date.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }) }
function formatTime(date: string) { return new Date(date).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) }
function formatDateTime(date: string) { return new Date(date).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) }
export { LoginScreen }