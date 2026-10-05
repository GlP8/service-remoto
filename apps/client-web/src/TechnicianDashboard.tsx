import { useCallback, useEffect, useState } from 'react'
import { Monitor, RefreshCw, ShieldCheck, TicketCheck, X } from 'lucide-react'
import { API_URL } from './config'
import './App.css'

type Ticket = {
  id: number
  clientId: number
  technicianId: number | null
  computerId: number | null
  status: 'PENDING' | 'ACTIVE' | 'CLOSED'
  createdAt: string
  connectedAt: string | null
  disconnectedAt: string | null
}

type ConnectionPreparation = {
  ticketId: number
  rustdeskId: string
  executed: boolean
  connected: boolean
}

async function api<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.error ?? 'No se pudo completar la solicitud')
  }
  return response.json() as Promise<T>
}

export function TechnicianDashboard({
  token,
  userName,
  onLogout,
}: {
  token: string
  userName: string
  onLogout: () => void
}) {
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [preparations, setPreparations] = useState<Record<number, ConnectionPreparation>>({})
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [busyTicketId, setBusyTicketId] = useState<number | null>(null)

  const fetchTickets = useCallback(async () => {
    try {
      const result = await api<{ tickets: Ticket[] }>('/tickets', token)
      setTickets(result.tickets)
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'No se pudieron cargar las solicitudes')
    }
  }, [token])

  const refreshTickets = useCallback(async () => {
    setLoading(true)
    try {
      await fetchTickets()
    } finally {
      setLoading(false)
    }
  }, [fetchTickets])

  useEffect(() => {
    void fetchTickets()
    const timer = window.setInterval(() => void fetchTickets(), 10_000)
    return () => window.clearInterval(timer)
  }, [fetchTickets])

  async function performTicketAction(ticketId: number, action: 'claim' | 'close' | 'connect') {
    setBusyTicketId(ticketId)
    setError('')
    try {
      if (action === 'connect') {
        const result = await api<ConnectionPreparation>(`/tickets/${ticketId}/connect`, token, { method: 'POST' })
        setPreparations((current) => ({ ...current, [ticketId]: result }))
      } else {
        await api(`/tickets/${ticketId}/${action}`, token, { method: 'PATCH' })
      }
      await fetchTickets()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'No se pudo completar la acción')
    } finally {
      setBusyTicketId(null)
    }
  }

  const pendingTickets = tickets.filter((ticket) => ticket.status === 'PENDING')
  const activeTickets = tickets.filter((ticket) => ticket.status === 'ACTIVE')

  return <main className="app-shell">
    <aside className="sidebar">
      <div className="brand-mark"><img src="/favicon.png" alt="" /><strong>ZED<br />Emprendedor</strong></div>
      <div className="side-rule" />
      <nav className="side-nav">
        <div className="nav-item active"><TicketCheck size={18} /> Solicitudes <span>{pendingTickets.length}</span></div>
      </nav>
      <div className="sidebar-foot">
        <div className="security-note"><ShieldCheck size={17} /><span>Panel de técnico<br /><b>Soporte remoto</b></span></div>
      </div>
    </aside>
    <section className="workspace">
      <header className="topbar">
        <div className="breadcrumb">Panel de técnico</div>
        <div className="account-menu">
          <div className="avatar">{userName[0]?.toUpperCase() ?? 'T'}</div>
          <span>{userName}</span>
          <button className="logout" onClick={onLogout}>Salir</button>
        </div>
      </header>
      <div className="content">
        <div className="page-heading">
          <div>
            <p className="eyebrow">Atención al cliente</p>
            <h1>Solicitudes de soporte</h1>
            <p className="muted">Revisa la cola y atiende las solicitudes disponibles.</p>
          </div>
          <button className="icon-button" title="Actualizar solicitudes" onClick={() => void refreshTickets()}>
            <RefreshCw size={18} className={loading ? 'spin' : ''} />
          </button>
        </div>

        {error && <div className="error-banner"><span>{error}</span><button onClick={() => setError('')} title="Cerrar"><X size={16} /></button></div>}

        <section className="panel">
          <div className="panel-heading">
            <div><p className="eyebrow">Cola de atención</p><h3>Solicitudes pendientes</h3></div>
            <span className="count-badge">{pendingTickets.length}</span>
          </div>
          {pendingTickets.length === 0
            ? <div className="quiet-state"><TicketCheck size={24} /><span>No hay solicitudes pendientes.</span></div>
            : <div className="ticket-list">{pendingTickets.map((ticket) =>
              <article className="ticket-row" key={ticket.id}>
                <div className="ticket-icon"><Monitor size={18} /></div>
                <div>
                  <strong>Solicitud #{ticket.id}</strong>
                  <span>{ticket.computerId ? `Equipo #${ticket.computerId}` : 'Sin equipo asociado'} · {formatDate(ticket.createdAt)}</span>
                </div>
                <span className="status-label pending">Pendiente</span>
                <button className="small-button" disabled={busyTicketId === ticket.id} onClick={() => void performTicketAction(ticket.id, 'claim')}>
                  {busyTicketId === ticket.id ? 'Tomando…' : 'Tomar solicitud'}
                </button>
              </article>
            )}</div>}
        </section>

        <section className="panel" style={{ marginTop: 14 }}>
          <div className="panel-heading">
            <div><p className="eyebrow">En curso</p><h3>Mis atenciones activas</h3></div>
            <span className="count-badge">{activeTickets.length}</span>
          </div>
          {activeTickets.length === 0
            ? <div className="quiet-state"><TicketCheck size={24} /><span>No tienes atenciones activas.</span></div>
            : <div className="ticket-list">{activeTickets.map((ticket) => {
              const preparation = preparations[ticket.id]
              return <article className="ticket-row" key={ticket.id}>
                <div className="ticket-icon active"><Monitor size={18} /></div>
                <div>
                  <strong>Solicitud #{ticket.id}</strong>
                  <span>{ticket.computerId ? `Equipo #${ticket.computerId}` : 'Sin equipo asociado'} · {ticket.connectedAt ? `Conexión iniciada ${formatDate(ticket.connectedAt)}` : 'Aún sin conexión remota'}</span>
                  {preparation && <span className="status-label">{preparation.connected
                    ? 'RustDesk se inició en el equipo que ejecuta la API.'
                    : `Modo de prueba: comando preparado para el ID ${preparation.rustdeskId}; no se inició ninguna conexión.`}</span>}
                </div>
                <button className="small-button" disabled={busyTicketId === ticket.id || !ticket.computerId} onClick={() => void performTicketAction(ticket.id, 'connect')}>
                  {busyTicketId === ticket.id ? 'Procesando…' : 'Preparar RustDesk'}
                </button>
                <button className="small-button" disabled={busyTicketId === ticket.id} onClick={() => void performTicketAction(ticket.id, 'close')}>
                  Cerrar atención
                </button>
              </article>
            })}</div>}
        </section>
      </div>
    </section>
  </main>
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' })
}
