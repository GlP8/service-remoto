import { useState, type FormEvent } from 'react'
import { ArrowUpRight, ShieldCheck } from 'lucide-react'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'
type Session = { user: { id: number; email: string; name: string | null; role: string }; token: string }

export function AuthScreen({ onLogin }: { onLogin: (result: Session) => void }) {
  const [registering, setRegistering] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`${API_URL}/auth/${registering ? 'register' : 'login'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(registering ? { name, email, password, diagnosticConsentAccepted: consent } : { email, password }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'No se pudo completar la solicitud')
      onLogin(body as Session)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'No se pudo completar la solicitud')
    } finally {
      setBusy(false)
    }
  }

  return <main className="login-page"><div className="login-art"><div className="brand-mark light"><span>sr</span><strong>service<br />remoto</strong></div><div className="art-copy"><p className="eyebrow">Soporte técnico sin desplazamientos</p><h1>Tu equipo.<br /><em>En buenas manos.</em></h1><p>Asistencia humana, rápida y segura para que puedas seguir trabajando.</p></div><div className="art-footer"><span>01</span><div /><span>ZED Emprendedor · 2026</span></div></div><section className="login-form-wrap"><div className="login-form"><p className="eyebrow">Área de clientes</p><h2>{registering ? 'Crea tu cuenta' : 'Bienvenido de vuelta'}</h2><p className="muted">{registering ? 'Activa tu soporte remoto en minutos.' : 'Accede para cuidar tus equipos.'}</p><form onSubmit={submit}>{registering && <label>Nombre<input type="text" required value={name} onChange={(event) => setName(event.target.value)} placeholder="Tu nombre" /></label>}<label>Correo electrónico<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="tu@correo.com" /></label><label>Contraseña<input type="password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••" /></label>{registering && <label className="consent-check"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} required /><span>Acepto que la aplicación recopile datos técnicos de mi sistema (RAM, espacio en disco, sistema operativo) únicamente para fines de diagnóstico técnico.</span></label>}{error && <p className="form-error">{error}</p>}<button className="primary-button full" disabled={busy || (registering && !consent)}>{busy ? 'Procesando...' : registering ? 'Crear cuenta' : 'Entrar al panel'} <ArrowUpRight size={17} /></button></form><button className="auth-switch" onClick={() => { setRegistering(!registering); setError('') }}>{registering ? 'Ya tengo una cuenta' : 'Crear una cuenta nueva'}</button><p className="login-footnote"><ShieldCheck size={15} /> Tus datos viajan cifrados</p></div></section></main>
}