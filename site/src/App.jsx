import { useEffect, useMemo, useRef, useState } from 'react'
import mqtt from 'mqtt'
import { Bell, CheckCircle2, ChevronDown, CircleHelp, PackageOpen, PlugZap, RefreshCw, Settings2, TriangleAlert, Wifi, WifiOff } from 'lucide-react'
import './App.css'

const TOPICS = { 1: 'belart/estoque/prateleira1', 2: 'belart/estoque/prateleira2', 3: 'belart/estoque/prateleira3' }
const INITIAL_SHELVES = [
  { id: 1, product: 'Canecas', quantity: 12, minimum: 8, updatedAt: 'agora' },
  { id: 2, product: 'Garrafas', quantity: 5, minimum: 6, updatedAt: 'há 2 min' },
  { id: 3, product: 'Azulejos', quantity: 24, minimum: 10, updatedAt: 'há 5 min' },
]
const EVENT_SEED = [
  { time: '10:42', title: 'Estoque atualizado', detail: 'Prateleira 1 recebeu 12 Canecas', type: 'ok' },
  { time: '10:38', title: 'Atenção necessária', detail: 'Prateleira 2 está abaixo do mínimo', type: 'warning' },
  { time: '10:31', title: 'Estoque atualizado', detail: 'Prateleira 3 recebeu 24 Azulejos', type: 'ok' },
]

function App() {
  const [shelves, setShelves] = useState(INITIAL_SHELVES)
  const [events, setEvents] = useState(EVENT_SEED)
  const [connection, setConnection] = useState('demo')
  const [filter, setFilter] = useState('all')
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const clientRef = useRef(null)

  const criticalCount = shelves.filter((shelf) => shelf.quantity <= shelf.minimum).length
  const totalItems = shelves.reduce((sum, shelf) => sum + shelf.quantity, 0)
  const visibleShelves = useMemo(() => {
    if (filter === 'critical') return shelves.filter((shelf) => shelf.quantity <= shelf.minimum)
    if (filter === 'ok') return shelves.filter((shelf) => shelf.quantity > shelf.minimum)
    return shelves
  }, [filter, shelves])

  useEffect(() => () => clientRef.current?.end(), [])

  function addEvent(title, detail, type = 'ok') {
    setEvents((current) => [{ time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }), title, detail, type }, ...current].slice(0, 5))
  }

  function updateShelf(id, product, quantity, source = 'MQTT') {
    const parsedQuantity = Number.parseInt(quantity, 10)
    if (!product || Number.isNaN(parsedQuantity)) return
    setShelves((current) => current.map((shelf) => {
      if (shelf.id !== id) return shelf
      const becameCritical = parsedQuantity <= shelf.minimum && shelf.quantity > shelf.minimum
      if (becameCritical) {
        addEvent('Reposição necessária', `Prateleira ${id} atingiu o nível crítico`, 'warning')
        if ('Notification' in window && Notification.permission === 'granted') new Notification(`Repor Prateleira ${id}`, { body: `${product}: ${parsedQuantity} unidades restantes.` })
      }
      addEvent('Estoque atualizado', `Prateleira ${id} recebeu ${parsedQuantity} ${product} via ${source}`)
      return { ...shelf, product, quantity: parsedQuantity, updatedAt: 'agora' }
    }))
  }

  function connectMqtt() {
    if (connection === 'online') {
      clientRef.current?.end()
      setConnection('demo')
      addEvent('Modo demonstração ativado', 'A conexão MQTT foi encerrada')
      return
    }
    setConnection('connecting')
    const client = mqtt.connect('wss://broker.hivemq.com:8884/mqtt', { connectTimeout: 5000, reconnectPeriod: 0 })
    clientRef.current = client
    client.once('connect', () => {
      setConnection('online')
      client.subscribe(Object.values(TOPICS))
      addEvent('MQTT conectado', 'Broker HiveMQ conectado com sucesso')
    })
    client.on('message', (topic, payload) => {
      const id = Number(Object.entries(TOPICS).find(([, value]) => value === topic)?.[0])
      const [product, quantity] = payload.toString().split(',')
      if (id) updateShelf(id, product, quantity)
    })
    client.once('error', () => {
      client.end()
      setConnection('demo')
      addEvent('Falha na conexão', 'Não foi possível acessar o broker; modo demonstração mantido', 'warning')
    })
  }

  function simulateUpdate() {
    const id = Math.floor(Math.random() * 3) + 1
    const shelf = shelves.find((item) => item.id === id)
    updateShelf(id, shelf.product, Math.max(0, shelf.quantity + (Math.random() > 0.5 ? 2 : -2)), 'simulação')
  }

  function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission()
  }

  return (
    <div className="app-shell">
      <header className="topbar"><div className="brand"><div className="brand-mark"><PackageOpen size={20} /></div><div><strong>Belart</strong><span>SMART STOCK</span></div></div><div className="top-actions"><div className={`connection-pill ${connection}`}><span className="status-dot" />{connection === 'online' ? 'MQTT conectado' : connection === 'connecting' ? 'Conectando...' : 'Modo demonstração'}</div><button className="icon-button" title="Solicitar permissão de notificações" onClick={requestNotificationPermission}><Bell size={18} /></button><button className="profile" title="Perfil do administrador"><span>IS</span><ChevronDown size={15} /></button></div></header>
      <main className="content"><section className="page-heading"><div><p className="eyebrow">PAINEL DE OPERAÇÕES <span>•</span> 09 NOV 2026</p><h1>Olá, Isabela <span>↗</span></h1><p className="muted">Acompanhe o pulso do seu estoque em tempo real.</p></div><div className="heading-actions"><button className="secondary-button" onClick={connectMqtt}><PlugZap size={17} /> {connection === 'online' ? 'Desconectar MQTT' : 'Conectar MQTT'}</button><button className="primary-button" onClick={simulateUpdate}><RefreshCw size={17} /> Simular leitura</button></div></section>
        <section className="summary-grid" aria-label="Resumo do estoque"><div className="summary-card accent"><div className="summary-icon"><PackageOpen size={19} /></div><span>Total de itens</span><strong>{totalItems}<small> un.</small></strong><em>+8% <span>esta semana</span></em></div><div className="summary-card"><div className="summary-icon orange"><TriangleAlert size={19} /></div><span>Repor agora</span><strong>{criticalCount}<small> prateleiras</small></strong><em className={criticalCount ? 'danger-text' : ''}>{criticalCount ? 'Ação necessária' : 'Tudo em ordem'}</em></div><div className="summary-card"><div className="summary-icon green"><Wifi size={19} /></div><span>Última sincronização</span><strong>agora</strong><em className="green-text">Todos os sensores ativos</em></div></section>
        <section className="section-header"><div><h2>Visão das prateleiras</h2><p className="muted">Leituras da câmera e célula de carga</p></div><div className="filter-tabs"><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Todas <b>3</b></button><button className={filter === 'critical' ? 'active' : ''} onClick={() => setFilter('critical')}>Críticas <b>{criticalCount}</b></button><button className={filter === 'ok' ? 'active' : ''} onClick={() => setFilter('ok')}>Estoque OK <b>{3 - criticalCount}</b></button></div></section>
        <section className="shelf-grid">{visibleShelves.map((shelf) => { const critical = shelf.quantity <= shelf.minimum; return <article className={`shelf-card ${critical ? 'is-critical' : ''}`} key={shelf.id}><div className="shelf-top"><div className="shelf-number">0{shelf.id}</div><span className={`badge ${critical ? 'critical' : 'ok'}`}>{critical ? <TriangleAlert size={13} /> : <CheckCircle2 size={13} />}{critical ? 'Repor estoque' : 'Estoque OK'}</span></div><div className="product-illustration"><PackageOpen size={54} strokeWidth={1.2} /><span>PRATELEIRA 0{shelf.id}</span></div><p className="shelf-label">Prateleira 0{shelf.id}</p><h3>{shelf.product}</h3><div className="quantity-row"><strong>{shelf.quantity}</strong><span>unidades<br /><small>mínimo: {shelf.minimum} un.</small></span></div><div className="meter"><span style={{ width: `${Math.min(100, Math.max(8, (shelf.quantity / Math.max(shelf.minimum * 2, 1)) * 100))}%` }} /></div><div className="card-footer"><span><span className={`mini-dot ${critical ? 'red' : 'green'}`} /> atualizado {shelf.updatedAt}</span><button title="Abrir configurações" onClick={() => setIsSettingsOpen(true)}><Settings2 size={16} /></button></div></article> })}</section>
        <section className="lower-grid"><div className="activity-panel"><div className="panel-heading"><div><h2>Atividade recente</h2><p className="muted">Últimos eventos recebidos pelo sistema</p></div><button className="text-button">Ver histórico <span>→</span></button></div>{events.map((event, index) => <div className="event-row" key={`${event.time}-${index}`}><div className={`event-icon ${event.type}`}>{event.type === 'warning' ? <TriangleAlert size={16} /> : <CheckCircle2 size={16} />}</div><div><strong>{event.title}</strong><p>{event.detail}</p></div><time>{event.time}</time></div>)}</div><aside className="side-panel"><div className="panel-heading"><div><h2>Conexão dos sensores</h2><p className="muted">Status dos dispositivos</p></div><CircleHelp size={17} /></div><div className="sensor-status"><span className="sensor-icon"><Wifi size={17} /></span><div><strong>ESP32 · Hub principal</strong><p><span className="mini-dot green" /> Online · Wi-Fi estável</p></div></div><div className="sensor-status"><span className="sensor-icon"><WifiOff size={17} /></span><div><strong>Câmera · Visão computacional</strong><p><span className="mini-dot green" /> Online · YOLO ativo</p></div></div><div className="broker-line"><span>Broker</span><code>broker.hivemq.com:8884</code></div></aside></section>
      </main>
      {isSettingsOpen && <div className="modal-backdrop" onClick={() => setIsSettingsOpen(false)}><div className="settings-modal" onClick={(event) => event.stopPropagation()}><div className="panel-heading"><div><p className="eyebrow">CONFIGURAÇÃO</p><h2>Limites mínimos</h2></div><button className="icon-button" onClick={() => setIsSettingsOpen(false)}>×</button></div><p className="muted">Defina quando uma prateleira deve pedir reposição.</p>{shelves.map((shelf) => <label className="limit-row" key={shelf.id}><span>Prateleira 0{shelf.id}<small>{shelf.product}</small></span><input type="number" min="0" value={shelf.minimum} onChange={(event) => setShelves((current) => current.map((item) => item.id === shelf.id ? { ...item, minimum: Number(event.target.value) } : item))} /></label>)}<button className="primary-button full" onClick={() => setIsSettingsOpen(false)}>Salvar limites</button></div></div>}
    </div>
  )
}

export default App
