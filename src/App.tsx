import { nanoid } from 'nanoid'
import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { ItineraryMap } from './components/ItineraryMap'
import { useTripRoom } from './collab/useTripRoom'
import type { StopCategory, TransportMode } from './domain/trip'
import { formatDistanceMeters, formatDurationSeconds } from './lib/format'
import { searchPlaces, type NominatimPlace } from './lib/nominatim'
import { fetchOsrmRoute, type OsrmRoute } from './lib/osrm'
import { fetchDailyForecast, fetchLocationTimezone, type DailyWeather } from './lib/openMeteo'

function getRoomFromUrl(): string | null {
  const url = new URL(window.location.href)
  return url.searchParams.get('room')
}

function setRoomInUrl(roomId: string) {
  const url = new URL(window.location.href)
  url.searchParams.set('room', roomId)
  window.history.replaceState(null, '', url.toString())
}

const RECENT_ROOMS_KEY = 'wander.recentRooms'

function loadRecentRooms(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_ROOMS_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

function saveRecentRooms(rooms: string[]) {
  try {
    localStorage.setItem(RECENT_ROOMS_KEY, JSON.stringify(rooms.slice(0, 12)))
  } catch {
    // ignore
  }
}

function pushRecentRoom(roomId: string): string[] {
  const next = [roomId, ...loadRecentRooms().filter((r) => r !== roomId)].slice(0, 12)
  saveRecentRooms(next)
  return next
}

function ConnectionPill({ connected }: { connected: boolean }) {
  return (
    <span
      className={
        'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs ' +
        (connected ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-600')
      }
      title={connected ? 'Connected' : 'Disconnected'}
    >
      <span className={'h-2 w-2 rounded-full ' + (connected ? 'bg-emerald-500' : 'bg-slate-300')} />
      {connected ? '协作已连接' : '协作未连接'}
    </span>
  )
}

function CategorySelect({
  value,
  onChange,
}: {
  value: StopCategory
  onChange: (v: StopCategory) => void
}) {
  return (
    <select
      className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm"
      value={value}
      onChange={(e) => onChange(e.target.value as StopCategory)}
    >
      <option value="sight">景点</option>
      <option value="restaurant">餐厅</option>
      <option value="toilet">厕所</option>
    </select>
  )
}

function ModeSelect({ value, onChange }: { value: TransportMode; onChange: (v: TransportMode) => void }) {
  return (
    <select
      className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm"
      value={value}
      onChange={(e) => onChange(e.target.value as TransportMode)}
    >
      <option value="foot">步行</option>
      <option value="bike">骑行</option>
      <option value="driving">驾车</option>
      <option value="transit">公共交通</option>
    </select>
  )
}

function getTransportLabel(mode: TransportMode): string {
  switch (mode) {
    case 'foot':
      return '步行'
    case 'bike':
      return '骑行'
    case 'driving':
      return '驾车'
    case 'transit':
      return '公共交通'
  }
}

function formatNowInTimeZone(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    weekday: 'short',
  }).format(new Date())
}

type TransitRouteOption = {
  title: string
  departure?: string
  arrival?: string
  duration?: string
  transfers?: string
  tools: string[]
  fare?: string
  whyNow?: string
  checkAt?: string
  steps: string[]
}

function parseTransitSuggestion(markdown: string): TransitRouteOption[] {
  const sections = markdown
    .split(/^###\s+/m)
    .map((section) => section.trim())
    .filter(Boolean)

  const options: TransitRouteOption[] = []

  for (const section of sections) {
    const lines = section.split('\n').map((line) => line.trim()).filter(Boolean)
    if (lines.length === 0) continue

    const [title, ...rest] = lines
    if (!/^Option\b/i.test(title)) continue

    const option: TransitRouteOption = {
      title,
      tools: [],
      steps: [],
    }

    for (const line of rest) {
      const fieldMatch = /^-\s*([A-Za-z ]+)\s*[:：]\s*(.+)$/.exec(line)
      if (fieldMatch) {
        const key = fieldMatch[1].trim().toLowerCase()
        const value = fieldMatch[2].trim()

        if (key === 'departure') option.departure = value
        else if (key === 'arrival') option.arrival = value
        else if (key === 'duration') option.duration = value
        else if (key === 'transfers') option.transfers = value
        else if (key === 'tools') option.tools = value.split(/[>,/|]/).map((item) => item.trim()).filter(Boolean)
        else if (key === 'fare') option.fare = value
        else if (key === 'why now') option.whyNow = value
        else if (key === 'check at') option.checkAt = value
        continue
      }

      const stepMatch = /^\d+\.\s+(.+)$/.exec(line)
      if (stepMatch) {
        option.steps.push(stepMatch[1].trim())
      }
    }

    if (option.departure || option.duration || option.tools.length > 0 || option.steps.length > 0) {
      options.push(option)
    }
  }

  return options
}

function TransitSuggestionPanel({
  suggestion,
  timeZone,
  localNow,
}: {
  suggestion: string
  timeZone: string
  localNow: string
}) {
  const options = parseTransitSuggestion(suggestion)

  if (options.length === 0) {
    return (
      <div className="mt-2 rounded-lg border border-slate-200 bg-white p-4 text-sm prose prose-sm prose-slate max-w-none">
        <ReactMarkdown>{suggestion}</ReactMarkdown>
      </div>
    )
  }

  return (
    <div className="mt-3 space-y-3">
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Transit Now</div>
            <div className="mt-1 text-sm font-semibold text-slate-900">{localNow}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-500">Time Zone</div>
            <div className="mt-1 text-sm text-slate-700">{timeZone}</div>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {options.map((option, idx) => (
          <div key={idx} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-base font-semibold text-slate-900">{option.title.replace(/^Option\s*\d+\s*-\s*/i, '')}</div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                  {option.departure ? <span className="rounded-full bg-slate-100 px-2.5 py-1">{option.departure}</span> : null}
                  {option.arrival ? <span className="rounded-full bg-slate-100 px-2.5 py-1">到达 {option.arrival}</span> : null}
                  {option.duration ? <span className="rounded-full bg-sky-50 px-2.5 py-1 text-sky-700">{option.duration}</span> : null}
                  {option.transfers ? <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700">{option.transfers}</span> : null}
                  {option.fare ? <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700">{option.fare}</span> : null}
                </div>
              </div>
            </div>

            {option.tools.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {option.tools.map((tool) => (
                  <span key={tool} className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700">
                    {tool}
                  </span>
                ))}
              </div>
            ) : null}

            {option.whyNow ? (
              <div className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">{option.whyNow}</div>
            ) : null}

            {option.steps.length > 0 ? (
              <div className="mt-3 space-y-2">
                {option.steps.map((step, stepIdx) => (
                  <div key={stepIdx} className="flex gap-3">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-medium text-white">
                      {stepIdx + 1}
                    </div>
                    <div className="pt-0.5 text-sm text-slate-700">{step}</div>
                  </div>
                ))}
              </div>
            ) : null}

            {option.checkAt ? (
              <div className="mt-3 border-t border-slate-200 pt-3 text-xs text-slate-500">Check live details: {option.checkAt}</div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function App() {
  const initialRoom = useMemo(() => {
    const fromUrl = getRoomFromUrl()
    if (fromUrl) return fromUrl

    const recent = loadRecentRooms()
    if (recent.length > 0) {
      setRoomInUrl(recent[0])
      return recent[0]
    }

    const created = nanoid(10)
    setRoomInUrl(created)
    return created
  }, [])

  const [roomId, setRoomId] = useState(initialRoom)
  const [roomInput, setRoomInput] = useState(initialRoom)
  const [recentRooms, setRecentRooms] = useState<string[]>(() => pushRecentRoom(initialRoom))
  const { trip, connected, actions } = useTripRoom(roomId)

  const [selectedDayId, setSelectedDayId] = useState<string>(() => trip.days[0]?.id ?? '')
  const [selectedStopId, setSelectedStopId] = useState<string>('')

  useEffect(() => {
    setRoomInput(roomId)
    setRecentRooms(pushRecentRoom(roomId))
  }, [roomId])

  useEffect(() => {
    const first = trip.days[0]
    if (!first) return
    if (!selectedDayId || !trip.days.some((d) => d.id === selectedDayId)) {
      setSelectedDayId(first.id)
    }
  }, [selectedDayId, trip.days])

  const selectedDay = trip.days.find((d) => d.id === selectedDayId) ?? trip.days[0]

  useEffect(() => {
    if (!selectedStopId) return
    const el = document.getElementById(`stop-${selectedStopId}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [selectedStopId])

  const [placeQuery, setPlaceQuery] = useState('')
  const [placeResults, setPlaceResults] = useState<NominatimPlace[]>([])
  const [placeLoading, setPlaceLoading] = useState(false)
  const [pendingPlace, setPendingPlace] = useState<NominatimPlace | null>(null)
  const [pendingCategory, setPendingCategory] = useState<StopCategory>('sight')

  const [pickedPoint, setPickedPoint] = useState<{ lat: number; lon: number } | null>(null)
  const [pickedName, setPickedName] = useState('')
  const [pickedCategory, setPickedCategory] = useState<StopCategory>('sight')

  useEffect(() => {
    if (!placeQuery.trim()) {
      setPlaceResults([])
      setPendingPlace(null)
      return
    }

    const ctrl = new AbortController()
    const t = window.setTimeout(async () => {
      setPlaceLoading(true)
      try {
        const results = await searchPlaces(placeQuery, ctrl.signal)
        setPlaceResults(results)
      } finally {
        setPlaceLoading(false)
      }
    }, 250)

    return () => {
      ctrl.abort()
      window.clearTimeout(t)
    }
  }, [placeQuery])

  const [route, setRoute] = useState<OsrmRoute | null>(null)
  const [routeLoading, setRouteLoading] = useState(false)

  useEffect(() => {
    const stops = selectedDay?.stops ?? []
    if (stops.length < 2) {
      setRoute(null)
      return
    }

    let cancelled = false
    ;(async () => {
      setRouteLoading(true)
      try {
        const r = await fetchOsrmRoute(trip.transportMode, stops.map((s) => ({ lat: s.lat, lon: s.lon })))
        if (!cancelled) setRoute(r)
      } finally {
        if (!cancelled) setRouteLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [selectedDay?.stops, trip.transportMode])

  const [weather, setWeather] = useState<DailyWeather[] | null>(null)
  const [weatherLoading, setWeatherLoading] = useState(false)
  const [destinationTimeZone, setDestinationTimeZone] = useState<string | null>(null)
  const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const effectiveTimeZone = destinationTimeZone || browserTimeZone
  const localNowAtDestination = formatNowInTimeZone(effectiveTimeZone)

  const [trafficMessage, setTrafficMessage] = useState<string>('')
  const [trafficLoading, setTrafficLoading] = useState(false)

  useEffect(() => {
    const first = selectedDay?.stops?.[0]
    if (!first) {
      setWeather(null)
      return
    }

    let cancelled = false
    ;(async () => {
      setWeatherLoading(true)
      try {
        const w = await fetchDailyForecast(first.lat, first.lon)
        if (!cancelled) setWeather(w)
      } finally {
        if (!cancelled) setWeatherLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [selectedDay?.stops])

  useEffect(() => {
    const first = selectedDay?.stops?.[0]
    if (!first) {
      setDestinationTimeZone(null)
      return
    }

    const ctrl = new AbortController()
    ;(async () => {
      try {
        const result = await fetchLocationTimezone(first.lat, first.lon, ctrl.signal)
        setDestinationTimeZone(result?.timeZone ?? null)
      } catch {
        setDestinationTimeZone(null)
      }
    })()

    return () => {
      ctrl.abort()
    }
  }, [selectedDay?.stops])

  useEffect(() => {
    const first = selectedDay?.stops?.[0]
    if (!first) {
      setTrafficMessage('添加地点后可显示路况提醒（需接入路况API）')
      return
    }

    let cancelled = false
    ;(async () => {
      setTrafficLoading(true)
      try {
        const url = new URL('/api/traffic', window.location.origin)
        url.searchParams.set('lat', String(first.lat))
        url.searchParams.set('lon', String(first.lon))
        const res = await fetch(url.toString())
        if (!res.ok) {
          if (!cancelled) setTrafficMessage('路况提醒获取失败')
          return
        }
        const json = (await res.json()) as any
        if (!cancelled) setTrafficMessage(String(json?.message ?? '未接入实时路况'))
      } catch {
        if (!cancelled) setTrafficMessage('路况提醒获取失败')
      } finally {
        if (!cancelled) setTrafficLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [selectedDay?.stops])

  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const aiAbortRef = useRef<AbortController | null>(null)

  async function runAiSuggest() {
    setAiError(null)
    setAiLoading(true)

    aiAbortRef.current?.abort()
    aiAbortRef.current = new AbortController()

    const transitInstruction =
      trip.transportMode === 'transit'
        ? '\nPublic transport requirement: use a Google Maps transit results style. Return 2 to 4 route options in markdown using this exact structure: "### Option 1 - Fastest", then bullet lines for "- Departure: ...", "- Arrival: ...", "- Duration: ...", "- Transfers: ...", "- Tools: metro > train > bus", "- Fare: ...", "- Why now: ...", "- Check at: Google Maps transit / local operator", followed by numbered step lines. Give detailed recommendations for likely tools such as subway/metro, commuter rail, high-speed rail, bus, tram, ferry, airport rail, and walking connections. For each leg, explain which public transport tool is most likely suitable, likely transfer count, first/last-mile walking, time buffer, and when taxi/walk is a better fallback. Do not invent exact live schedules.'
        : ''

    const prompt =
      `Trip name: ${trip.name}\n` +
      `Transport: ${getTransportLabel(trip.transportMode)} (${trip.transportMode})\n` +
      `Destination time zone: ${effectiveTimeZone}\n` +
      `Current local time at destination: ${localNowAtDestination}\n` +
      `Selected day: ${selectedDay?.title}\n` +
      `Stops:\n` +
      (selectedDay?.stops ?? [])
        .map((s, idx) => `${idx + 1}. [${s.category}] ${s.name} (${s.lat}, ${s.lon})`)
        .join('\n') +
      transitInstruction

    try {
      const res = await fetch('/api/ai/suggest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ locale: navigator.language, prompt, trip }),
        signal: aiAbortRef.current.signal,
      })

      if (!res.ok) {
        const text = await res.text()
        setAiError(text)
        return
      }

      const json = (await res.json()) as any
      actions.setAiSuggestion(String(json?.suggestionMarkdown ?? ''))
    } catch (e) {
      setAiError(String(e))
    } finally {
      setAiLoading(false)
    }
  }

  function onNewRoom() {
    const next = nanoid(10)
    setRoomId(next)
    setRoomInUrl(next)
    setSelectedStopId('')
    setPickedPoint(null)
  }

  function joinRoom(code: string) {
    const next = code.trim()
    if (!next) return
    setRoomId(next)
    setRoomInUrl(next)
    setSelectedStopId('')
    setPickedPoint(null)
  }

  async function onCopyLink() {
    const url = new URL(window.location.href)
    url.searchParams.set('room', roomId)
    await navigator.clipboard.writeText(url.toString())
  }

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="text-lg font-semibold">漫迹 Wander</div>
            <ConnectionPill connected={connected} />
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden text-xs text-slate-500 md:block">Room</div>
            <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-mono text-slate-700">
              {roomId}
            </div>
            <select
              className="hidden rounded-md border border-slate-200 bg-white px-2 py-1 text-sm md:block"
              value=""
              onChange={(e) => {
                const v = e.target.value
                if (!v) return
                joinRoom(v)
              }}
              title="最近加入/创建的房间"
            >
              <option value="">最近房间…</option>
              {recentRooms.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>

            <input
              className="w-28 rounded-md border border-slate-200 px-2 py-1 text-sm md:w-36"
              placeholder="输入房间码"
              value={roomInput}
              onChange={(e) => setRoomInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') joinRoom(roomInput)
              }}
            />
            <button
              type="button"
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
              onClick={() => joinRoom(roomInput)}
              title="输入房间码加入同一协作房间"
            >
              加入
            </button>
            <button
              type="button"
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
              onClick={onCopyLink}
            >
              复制协作链接
            </button>
            <button
              type="button"
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
              onClick={onNewRoom}
            >
              新房间
            </button>
          </div>
        </div>
      </header>

      <main className="flex min-h-0 flex-1">
        <aside className="w-full max-w-md shrink-0 overflow-y-auto border-r border-slate-200 bg-white">
          <div className="space-y-4 p-4">
            <div className="space-y-2">
              <div className="text-sm font-medium text-slate-900">交通方式</div>
              <ModeSelect value={trip.transportMode} onChange={actions.setTransportMode} />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-slate-900">行程（按天）</div>
                <button
                  type="button"
                  className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm hover:bg-slate-50"
                  onClick={() => {
                    const id = actions.addDay()
                    setSelectedDayId(id)
                  }}
                >
                  + 添加一天
                </button>
              </div>

              <div className="space-y-1">
                {trip.days.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    className={
                      'flex w-full items-center justify-between rounded-md border px-3 py-2 text-left ' +
                      (d.id === selectedDayId
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 bg-white text-slate-900 hover:bg-slate-50')
                    }
                    onClick={() => setSelectedDayId(d.id)}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{d.title}</div>
                      <div className={d.id === selectedDayId ? 'text-xs text-slate-200' : 'text-xs text-slate-500'}>
                        {d.stops.length} 个地点
                      </div>
                    </div>
                    <span className="text-xs opacity-80">→</span>
                  </button>
                ))}
              </div>
            </div>

            {selectedDay ? (
              <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
                <div className="flex items-center justify-between gap-2">
                  <input
                    className="w-full rounded-md border border-slate-200 px-2 py-1 text-sm"
                    value={selectedDay.title}
                    onChange={(e) => actions.renameDay(selectedDay.id, e.target.value)}
                  />
                  <button
                    type="button"
                    className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm hover:bg-slate-50"
                    onClick={() => actions.removeDay(selectedDay.id)}
                    title="删除这一天（至少保留一天）"
                  >
                    删除
                  </button>
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-medium text-slate-900">地点（景点 / 餐厅 / 厕所）</div>
                  {selectedDay.stops.length === 0 ? (
                    <div className="rounded-md border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-500">
                      还没有地点。先搜索并添加几个地点，右侧会自动计算路线和距离。
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {selectedDay.stops.map((s, idx) => (
                        <div
                          key={s.id}
                          id={`stop-${s.id}`}
                          className={
                            'rounded-md border p-2 ' +
                            (selectedStopId === s.id ? 'border-slate-900 bg-slate-50' : 'border-slate-200')
                          }
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium">
                                {idx + 1}. {s.name}
                              </div>
                              <div className="text-xs text-slate-500">
                                {s.lat.toFixed(5)}, {s.lon.toFixed(5)}
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <CategorySelect
                                value={s.category}
                                onChange={(v) => actions.updateStopCategory(selectedDay.id, s.id, v)}
                              />
                              <button
                                type="button"
                                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm hover:bg-slate-50"
                                onClick={() => actions.moveStop(selectedDay.id, s.id, -1)}
                                title="上移"
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm hover:bg-slate-50"
                                onClick={() => actions.moveStop(selectedDay.id, s.id, 1)}
                                title="下移"
                              >
                                ↓
                              </button>
                              <button
                                type="button"
                                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm hover:bg-slate-50"
                                onClick={() => actions.removeStop(selectedDay.id, s.id)}
                                title="删除"
                              >
                                ✕
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-medium text-slate-900">添加地点</div>
                  <input
                    className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
                    placeholder="搜索地点（例如：Shibuya Sky / 北京故宫 / 7-11）"
                    value={placeQuery}
                    onChange={(e) => setPlaceQuery(e.target.value)}
                  />

                  <div className="flex items-center gap-2">
                    <CategorySelect value={pendingCategory} onChange={setPendingCategory} />
                    <button
                      type="button"
                      className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                      disabled={!pendingPlace}
                      onClick={() => {
                        if (!pendingPlace) return
                        actions.addStop(selectedDay.id, {
                          name: pendingPlace.display_name,
                          lat: Number(pendingPlace.lat),
                          lon: Number(pendingPlace.lon),
                          category: pendingCategory,
                        })
                        setPendingPlace(null)
                        setPlaceQuery('')
                        setPlaceResults([])
                      }}
                    >
                      添加
                    </button>
                  </div>

                  {placeLoading ? <div className="text-xs text-slate-500">搜索中…</div> : null}

                  {placeResults.length > 0 ? (
                    <div className="max-h-56 overflow-auto rounded-md border border-slate-200">
                      {placeResults.map((p) => (
                        <button
                          key={String(p.place_id)}
                          type="button"
                          className={
                            'block w-full border-b border-slate-200 px-3 py-2 text-left text-sm hover:bg-slate-50 ' +
                            (pendingPlace?.place_id === p.place_id ? 'bg-slate-50' : '')
                          }
                          onClick={() => setPendingPlace(p)}
                        >
                          <div className="overflow-hidden text-ellipsis">{p.display_name}</div>
                          <div className="text-xs text-slate-500">
                            {Number(p.lat).toFixed(5)}, {Number(p.lon).toFixed(5)}
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : null}

                  <div className="text-xs text-slate-500">
                    提示：地点搜索使用 OpenStreetMap Nominatim；部分地区可能需要换地图源/网络。
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-medium text-slate-900">从地图选点添加</div>
                  {pickedPoint ? (
                    <div className="space-y-2 rounded-md border border-slate-200 p-2">
                      <div className="text-xs text-slate-600">
                        已选坐标：{pickedPoint.lat.toFixed(5)}, {pickedPoint.lon.toFixed(5)}
                      </div>
                      <input
                        className="w-full rounded-md border border-slate-200 px-2 py-1 text-sm"
                        placeholder="地点名称（例如：某个小众景点/公厕/餐厅）"
                        value={pickedName}
                        onChange={(e) => setPickedName(e.target.value)}
                      />
                      <div className="flex items-center gap-2">
                        <CategorySelect value={pickedCategory} onChange={setPickedCategory} />
                        <button
                          type="button"
                          className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
                          onClick={() => {
                            if (!selectedDay) return
                            actions.addStop(selectedDay.id, {
                              name: pickedName.trim() || '地图选点',
                              lat: pickedPoint.lat,
                              lon: pickedPoint.lon,
                              category: pickedCategory,
                            })
                            setPickedPoint(null)
                            setPickedName('')
                          }}
                        >
                          添加
                        </button>
                        <button
                          type="button"
                          className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50"
                          onClick={() => {
                            setPickedPoint(null)
                            setPickedName('')
                          }}
                        >
                          清除
                        </button>
                      </div>
                      <div className="text-xs text-slate-500">在右侧地图上点击任意位置即可选点。</div>
                    </div>
                  ) : (
                    <div className="rounded-md border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-500">
                      去右侧地图上点一下，即可把坐标带回这里添加。
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </aside>

        <section className="min-w-0 flex-1">
          <div className="flex h-full flex-col">
            <div className="border-b border-slate-200 bg-white">
              <div className="mx-auto grid max-w-6xl grid-cols-1 gap-3 px-4 py-3 md:grid-cols-4">
                <div className="rounded-lg border border-slate-200 p-3">
                  <div className="text-xs font-medium text-slate-500">今日行程概览</div>
                  <div className="mt-1 text-sm text-slate-900">
                    {selectedDay ? selectedDay.title : '-'}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {selectedDay?.stops.length ?? 0} 个地点 · {trip.transportMode}
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 p-3">
                  <div className="text-xs font-medium text-slate-500">路线 / 距离</div>
                  {routeLoading ? (
                    <div className="mt-1 text-sm text-slate-900">计算中…</div>
                  ) : route ? (
                    <div className="mt-1 text-sm text-slate-900">
                      {formatDistanceMeters(route.distance)} · {formatDurationSeconds(route.duration)}
                    </div>
                  ) : (
                    <div className="mt-1 text-sm text-slate-500">至少添加 2 个地点</div>
                  )}
                  <div className="mt-1 text-xs text-slate-500">路线基于 OSRM（非实时路况）。</div>
                </div>

                <div className="rounded-lg border border-slate-200 p-3">
                  <div className="text-xs font-medium text-slate-500">天气</div>
                  {weatherLoading ? (
                    <div className="mt-1 text-sm text-slate-900">加载中…</div>
                  ) : weather?.[0] ? (
                    <div className="mt-1 text-sm text-slate-900">
                      {weather[0].tMinC?.toFixed(0)}–{weather[0].tMaxC?.toFixed(0)}°C · {weather[0].precipProbMax ?? '-'}% 降水
                    </div>
                  ) : (
                    <div className="mt-1 text-sm text-slate-500">添加地点后显示</div>
                  )}
                  <div className="mt-1 text-xs text-slate-500">来源：Open-Meteo</div>
                </div>

                <div className="rounded-lg border border-slate-200 p-3">
                  <div className="text-xs font-medium text-slate-500">路况提醒</div>
                  <div className="mt-1 text-sm text-slate-900">{trafficLoading ? '加载中…' : trafficMessage}</div>
                  <div className="mt-1 text-xs text-slate-500">MVP：默认未接入实时路况</div>
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1">
              <div className="grid h-full grid-cols-1 md:grid-cols-5">
                <div className="md:col-span-3">
                  <ItineraryMap
                    stops={selectedDay?.stops ?? []}
                    route={route?.geometry ?? null}
                    selectedStopId={selectedStopId}
                    onSelectStop={(id) => setSelectedStopId(id)}
                    onPickPoint={(p) => {
                      setPickedPoint(p)
                      setPickedName((prev) => prev || '地图选点')
                    }}
                    onChangeCategory={(stopId, category) => {
                      if (!selectedDay) return
                      actions.updateStopCategory(selectedDay.id, stopId, category)
                    }}
                  />
                </div>
                <div className="min-h-0 border-t border-slate-200 bg-white p-4 md:col-span-2 md:border-l md:border-t-0">
                  <div className="space-y-4">
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-medium text-slate-900">怎么走 / 每段距离</div>
                      </div>
                      {route && selectedDay && selectedDay.stops.length >= 2 ? (
                        <div className="mt-2 space-y-2">
                          {route.legs.map((leg, idx) => (
                            <div key={idx} className="rounded-md border border-slate-200 p-2">
                              <div className="text-sm text-slate-900">
                                {idx + 1}. {selectedDay.stops[idx]?.name} → {selectedDay.stops[idx + 1]?.name}
                              </div>
                              <div className="text-xs text-slate-500">
                                {formatDistanceMeters(leg.distance)} · {formatDurationSeconds(leg.duration)}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-2 text-sm text-slate-500">添加至少 2 个地点后可视化路线</div>
                      )}
                    </div>

                    <div className="rounded-lg border border-slate-200 p-3">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-medium text-slate-900">智能推荐</div>
                        <button
                          type="button"
                          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                          onClick={runAiSuggest}
                          disabled={aiLoading || !selectedDay || selectedDay.stops.length === 0}
                        >
                          {aiLoading ? '生成中…' : 'AI 推荐'}
                        </button>
                      </div>

                      {aiError ? (
                        <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">
                          {aiError}
                        </div>
                      ) : null}

                      {trip.aiSuggestion ? (
                        trip.transportMode === 'transit' ? (
                          <TransitSuggestionPanel
                            suggestion={trip.aiSuggestion}
                            timeZone={effectiveTimeZone}
                            localNow={localNowAtDestination}
                          />
                        ) : (
                          <div className="mt-2 rounded-md border border-slate-200 bg-white p-4 text-sm prose prose-sm prose-slate max-w-none">
                            <ReactMarkdown>
                              {trip.aiSuggestion}
                            </ReactMarkdown>
                          </div>
                        )
                      ) : (
                        <div className="mt-2 text-xs text-slate-500">
                          点击 “AI 推荐” 生成按距离优化的建议（若未配置 `OPENAI_API_KEY`，会返回离线建议）。
                        </div>
                      )}
                    </div>

                    <div className="text-xs text-slate-500">
                      协作方式：把上方链接发给朋友，大家一起添加地点。
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
