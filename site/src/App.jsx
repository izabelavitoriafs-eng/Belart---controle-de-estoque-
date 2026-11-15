import { useEffect, useMemo, useRef, useState } from 'react'
import mqtt from 'mqtt'
import { Bell, Camera, CheckCircle2, ChevronDown, CircleHelp, Coffee, Cpu, Milk, PackageOpen, RefreshCw, Settings2, TriangleAlert } from 'lucide-react'
import './App.css'

// Mesma configuração MQTT do aplicativo (belartbh/App.js)
const BROKER_URL = 'wss://broker.hivemq.com:8884/mqtt'
const TOPICS = { 1: 'belart/estoque/prateleira1', 2: 'belart/estoque/prateleira2', 3: 'belart/estoque/prateleira3' }
const TOPIC_TO_ID = Object.fromEntries(Object.entries(TOPICS).map(([id, topic]) => [topic, Number(id)]))

// Produtos do Belart Smart Stock e estoque mínimo de cada um (mesmos valores do aplicativo)
const VALID_PRODUCTS = ['Caneca', 'Garrafa']
const DEFAULT_MINIMUMS = { Caneca: 30, Garrafa: 20 }
const PRODUCT_ICONS = { Caneca: Coffee, Garrafa: Milk }

// O ESP32 publica as três prateleiras a cada ~1,5 s. Sem mensagens por 10 s, ele é considerado sem dados.
const ESP32_TIMEOUT_MS = 10000

// Antes da primeira mensagem, nenhuma prateleira tem produto (não há dados de exemplo)
const INITIAL_SHELVES = [1, 2, 3].map((id) => ({ id, product: null, quantity: 0, updatedAt: null }))

// "ok" e "critical" só para Caneca e Garrafa. "Nenhum", "Aguardando IA..." ou sem dados ficam neutros,
// para a ausência de detecção não aparecer como estoque zerado.
function shelfStatus(shelf, minimums) {
  if (!VALID_PRODUCTS.includes(shelf.product)) return 'waiting'
  return shelf.quantity <= minimums[shelf.product] ? 'critical' : 'ok'
}

function productLabel(product) {
  if (!product) return 'Aguardando dados'
  if (product === 'Nenhum') return 'Sem produto'
  return product
}

function describeReading(product, quantity) {
  if (VALID_PRODUCTS.includes(product)) return `${quantity} un. de ${product}`
  if (product === 'Nenhum') return 'nenhum produto detectado'
  return `aguardando detecção (${product})`
}

function relativeTime(timestamp, now) {
  if (!timestamp) return 'sem leitura'
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000))
  if (seconds < 5) return 'agora'
  if (seconds < 60) return `há ${seconds} s`
  if (seconds < 3600) return `há ${Math.floor(seconds / 60)} min`
  return new Date(timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

const STATUS_TEXT = { ok: 'Estoque OK', critical: 'Repor estoque', waiting: 'Aguardando dados' }
const STATUS_ICON = { ok: CheckCircle2, critical: TriangleAlert, waiting: CircleHelp }
const CONNECTION_TEXT = { online: 'MQTT conectado', connecting: 'Conectando...', offline: 'MQTT desconectado' }

function App() {
  const [shelves, setShelves] = useState(INITIAL_SHELVES)
  const [minimums, setMinimums] = useState(DEFAULT_MINIMUMS)
  const [events, setEvents] = useState([])
  const [connection, setConnection] = useState('connecting')
  const [lastMessageAt, setLastMessageAt] = useState(null)
  const [now, setNow] = useState(Date.now())
  const [connectKey, setConnectKey] = useState(0)
  const [filter, setFilter] = useState('all')
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

  // Cópias atualizadas para o tratamento das mensagens MQTT, que roda fora do ciclo de renderização
  const shelvesRef = useRef(INITIAL_SHELVES)
  const minimumsRef = useRef(DEFAULT_MINIMUMS)
  useEffect(() => { minimumsRef.current = minimums }, [minimums])

  // Relógio para "atualizado há X s" e para o status do ESP32
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  function addEvent(title, detail, type = 'ok') {
    const time = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    setEvents((current) => [{ id: `${Date.now()}-${Math.random()}`, time, title, detail, type }, ...current].slice(0, 6))
  }

  function handleMessage(topic, message) {
    const id = TOPIC_TO_ID[topic]
    if (!id) return

    // Formato vindo do ESP32: "Produto,Quantidade" (ex.: "Caneca,5"), lido como no aplicativo
    const parts = message.toString().split(',')
    const product = (parts[0] || 'Desconhecido').trim()
    const quantity = Number.parseInt(parts[1], 10) || 0
    const receivedAt = Date.now()

    const previous = shelvesRef.current.find((shelf) => shelf.id === id)
    const next = shelvesRef.current.map((shelf) => (shelf.id === id ? { ...shelf, product, quantity, updatedAt: receivedAt } : shelf))
    shelvesRef.current = next
    setShelves(next)
    setLastMessageAt(receivedAt)

    // O ESP32 repete a mesma leitura a cada ciclo: só registra evento quando algo muda
    if (previous.product === product && previous.quantity === quantity) return

    const previousStatus = shelfStatus(previous, minimumsRef.current)
    const newStatus = shelfStatus({ product, quantity }, minimumsRef.current)

    if (newStatus === 'critical' && previousStatus !== 'critical') {
      addEvent('Reposição necessária', `Prateleira ${id}: ${describeReading(product, quantity)}`, 'warning')
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(`Repor Prateleira ${id}`, { body: `${product}: ${quantity} unidades restantes.` })
      }
    } else {
      addEvent('Estoque atualizado', `Prateleira ${id}: ${describeReading(product, quantity)}`, newStatus === 'critical' ? 'warning' : 'ok')
    }
  }

  // Conexão MQTT: abre ao carregar a página e reconecta sozinha, como o aplicativo.
  // O botão "Reconectar" força uma nova conexão.
  useEffect(() => {
    setConnection('connecting')
    const client = mqtt.connect(BROKER_URL, { connectTimeout: 5000, reconnectPeriod: 2000 })
    // Ignora eventos de uma conexão antiga, encerrada pelo "Reconectar"
    let active = true
    const whenActive = (handler) => (...args) => { if (active) handler(...args) }

    client.on('connect', whenActive(() => {
      setConnection('online')
      // Inscrição a cada conexão, para continuar recebendo depois de uma reconexão
      client.subscribe(Object.values(TOPICS))
      addEvent('MQTT conectado', 'Inscrito nos tópicos belart/estoque/prateleira1, 2 e 3')
    }))
    client.on('reconnect', whenActive(() => setConnection('connecting')))
    client.on('close', whenActive(() => setConnection('offline')))
    client.on('offline', whenActive(() => setConnection('offline')))
    client.on('error', (error) => console.warn('Erro MQTT:', error?.message))
    client.on('message', whenActive(handleMessage))

    return () => {
      active = false
      client.end(true)
    }
    // handleMessage usa apenas refs e setters, por isso não entra nas dependências
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectKey])

  function reconnect() {
    addEvent('Reconectando', 'Nova conexão com o broker solicitada')
    setConnectKey((key) => key + 1)
  }

  function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission()
  }

  const statuses = shelves.map((shelf) => shelfStatus(shelf, minimums))
  const criticalCount = statuses.filter((status) => status === 'critical').length
  const okCount = statuses.filter((status) => status === 'ok').length
  const shelvesWithProduct = shelves.filter((shelf) => VALID_PRODUCTS.includes(shelf.product))
  const totalItems = shelvesWithProduct.reduce((sum, shelf) => sum + shelf.quantity, 0)
  const esp32Online = lastMessageAt !== null && now - lastMessageAt < ESP32_TIMEOUT_MS
  // O ESP32 publica "Aguardando IA..." até receber o primeiro produto do Python
  const cameraDetected = shelves.some((shelf) => shelf.product && shelf.product !== 'Aguardando IA...')
  const today = new Date(now).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).replace('.', '').toUpperCase()

  const visibleShelves = useMemo(() => {
    if (filter === 'critical') return shelves.filter((shelf) => shelfStatus(shelf, minimums) === 'critical')
    if (filter === 'ok') return shelves.filter((shelf) => shelfStatus(shelf, minimums) === 'ok')
    return shelves
  }, [filter, shelves, minimums])

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <img className="brand-logo" src={`${import.meta.env.BASE_URL}belart-logo.png`} alt="Logotipo da Belart" width="44" height="44" />
          <div><strong>Belart</strong><span>SMART STOCK</span></div>
        </div>
        <div className="top-actions">
          <div className={`connection-pill ${connection}`}><span className="status-dot" />{CONNECTION_TEXT[connection]}</div>
          <button className="icon-button" title="Ativar notificações de reposição" onClick={requestNotificationPermission}><Bell size={18} /></button>
          <button className="profile" title="Perfil do administrador"><span>IS</span><ChevronDown size={15} /></button>
        </div>
      </header>

      <main className="content">
        <section className="page-heading">
          <div>
            <p className="eyebrow">PAINEL DE OPERAÇÕES <span>•</span> {today}</p>
            <h1>Olá, Isabela</h1>
            <p className="muted">Acompanhe o estoque das prateleiras em tempo real.</p>
          </div>
          <div className="heading-actions">
            <button className="primary-button" onClick={reconnect}><RefreshCw size={17} /> Reconectar MQTT</button>
          </div>
        </section>

        <section className="summary-grid" aria-label="Resumo do estoque">
          <div className="summary-card accent">
            <div className="summary-icon"><PackageOpen size={19} /></div>
            <span>Total de itens</span>
            <strong>{totalItems}<small> un.</small></strong>
            <em>{shelvesWithProduct.length} de 3 prateleiras com produto</em>
          </div>
          <div className="summary-card">
            <div className="summary-icon alert"><TriangleAlert size={19} /></div>
            <span>Repor agora</span>
            <strong>{criticalCount}<small> {criticalCount === 1 ? 'prateleira' : 'prateleiras'}</small></strong>
            <em className={criticalCount ? 'danger-text' : ''}>{criticalCount ? 'Ação necessária' : 'Nenhuma prateleira abaixo do mínimo'}</em>
          </div>
          <div className="summary-card">
            <div className="summary-icon sync"><Cpu size={19} /></div>
            <span>Última atualização</span>
            <strong>{relativeTime(lastMessageAt, now)}</strong>
            <em className={esp32Online ? 'green-text' : 'muted-text'}>{esp32Online ? 'ESP32 enviando dados' : 'Sem dados recentes do ESP32'}</em>
          </div>
        </section>

        <section className="section-header">
          <div>
            <h2>Visão das prateleiras</h2>
            <p className="muted">Produto identificado pela câmera e quantidade calculada pelo peso</p>
          </div>
          <div className="filter-tabs">
            <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Todas <b>3</b></button>
            <button className={filter === 'critical' ? 'active' : ''} onClick={() => setFilter('critical')}>Críticas <b>{criticalCount}</b></button>
            <button className={filter === 'ok' ? 'active' : ''} onClick={() => setFilter('ok')}>Estoque OK <b>{okCount}</b></button>
          </div>
        </section>

        <section className="shelf-grid">
          {visibleShelves.length === 0 && <p className="empty-state">Nenhuma prateleira neste filtro.</p>}
          {visibleShelves.map((shelf) => {
            const status = shelfStatus(shelf, minimums)
            const hasProduct = status !== 'waiting'
            const minimum = hasProduct ? minimums[shelf.product] : null
            const StatusIcon = STATUS_ICON[status]
            const ProductIcon = PRODUCT_ICONS[shelf.product] || PackageOpen
            const meterWidth = hasProduct ? Math.min(100, Math.max(4, (shelf.quantity / Math.max(minimum * 2, 1)) * 100)) : 0
            return (
              <article className={`shelf-card is-${status}`} key={shelf.id}>
                <div className="shelf-top">
                  <div className="shelf-number">0{shelf.id}</div>
                  <span className={`badge ${status}`}><StatusIcon size={13} />{STATUS_TEXT[status]}</span>
                </div>
                <div className="product-illustration"><ProductIcon size={54} strokeWidth={1.3} /><span>PRATELEIRA 0{shelf.id}</span></div>
                <p className="shelf-label">Prateleira 0{shelf.id}</p>
                <h3>{productLabel(shelf.product)}</h3>
                <div className="quantity-row">
                  <strong>{hasProduct ? shelf.quantity : '—'}</strong>
                  <span>unidades<br /><small>{hasProduct ? `mínimo: ${minimum} un.` : 'sem produto válido'}</small></span>
                </div>
                <div className="meter"><span style={{ width: `${meterWidth}%` }} /></div>
                <div className="card-footer">
                  <span><span className={`mini-dot ${status}`} /> atualizado {relativeTime(shelf.updatedAt, now)}</span>
                  <button title="Configurar limites mínimos" onClick={() => setIsSettingsOpen(true)}><Settings2 size={16} /></button>
                </div>
              </article>
            )
          })}
        </section>

        <section className="lower-grid">
          <div className="activity-panel">
            <div className="panel-heading">
              <div><h2>Atividade recente</h2><p className="muted">Mudanças recebidas pelo broker MQTT</p></div>
            </div>
            {events.length === 0 && <p className="empty-state">Nenhum evento recebido ainda.</p>}
            {events.map((event) => (
              <div className="event-row" key={event.id}>
                <div className={`event-icon ${event.type}`}>{event.type === 'warning' ? <TriangleAlert size={16} /> : <CheckCircle2 size={16} />}</div>
                <div><strong>{event.title}</strong><p>{event.detail}</p></div>
                <time>{event.time}</time>
              </div>
            ))}
          </div>
          <aside className="side-panel">
            <div className="panel-heading">
              <div><h2>Conexão dos sensores</h2><p className="muted">Deduzida das mensagens recebidas</p></div>
              <CircleHelp size={17} />
            </div>
            <div className="sensor-status">
              <span className={`sensor-icon ${esp32Online ? '' : 'off'}`}><Cpu size={17} /></span>
              <div><strong>ESP32 · Balanças HX711</strong><p><span className={`mini-dot ${esp32Online ? 'ok' : 'waiting'}`} /> {esp32Online ? 'Enviando dados' : 'Sem dados nos últimos 10 s'}</p></div>
            </div>
            <div className="sensor-status">
              <span className={`sensor-icon ${cameraDetected ? '' : 'off'}`}><Camera size={17} /></span>
              <div><strong>Câmera · Visão computacional</strong><p><span className={`mini-dot ${cameraDetected ? 'ok' : 'waiting'}`} /> {cameraDetected ? 'Detecções recebidas pelo ESP32' : 'Aguardando a primeira detecção'}</p></div>
            </div>
            <div className="broker-line"><span>Broker</span><code>broker.hivemq.com:8884</code></div>
          </aside>
        </section>
      </main>

      {isSettingsOpen && (
        <div className="modal-backdrop" onClick={() => setIsSettingsOpen(false)}>
          <div className="settings-modal" onClick={(event) => event.stopPropagation()}>
            <div className="panel-heading">
              <div><p className="eyebrow">CONFIGURAÇÃO</p><h2>Limites mínimos</h2></div>
              <button className="icon-button" onClick={() => setIsSettingsOpen(false)}>×</button>
            </div>
            <p className="muted">Defina, por produto, quando uma prateleira deve pedir reposição.</p>
            {VALID_PRODUCTS.map((product) => (
              <label className="limit-row" key={product}>
                <span>{product}<small>{shelves.filter((shelf) => shelf.product === product).map((shelf) => `Prateleira 0${shelf.id}`).join(', ') || 'Nenhuma prateleira no momento'}</small></span>
                <input type="number" min="0" value={minimums[product]} onChange={(event) => setMinimums((current) => ({ ...current, [product]: Math.max(0, Number(event.target.value) || 0) }))} />
              </label>
            ))}
            <button className="primary-button full" onClick={() => setIsSettingsOpen(false)}>Salvar limites</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
