import { nanoid } from 'nanoid'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ItineraryMap } from './components/ItineraryMap'
import { useTripRoom } from './collab/useTripRoom'
import type { StopCategory, TransportMode } from './domain/trip'
import { formatDistanceMeters, formatDurationSeconds } from './lib/format'
import { searchPlaces, type NominatimPlace } from './lib/nominatim'
import { fetchOsrmRoute, type OsrmRoute } from './lib/osrm'
import { fetchDailyForecast, type DailyWeather } from './lib/openMeteo'

function getRoomFromUrl(): string | null {
  const url = new URL(window.location.href)
  return url.searchParams.get('room')
}

function setRoomInUrl(roomId: string) {
  const url = new URL(window.location.href)
  url.searchParams.set('room', roomId)
  window.history.replaceState(null, '', url.toString())
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
    </select>
  )
}

export default function App() {
  const initialRoom = useMemo(() => {
    const fromUrl = getRoomFromUrl()
    if (fromUrl) return fromUrl
    const created = nanoid(10)
    setRoomInUrl(created)
    return created
  }, [])

  const [roomId, setRoomId] = useState(initialRoom)
  const { trip, connected, actions } = useTripRoom(roomId)

  const [selectedDayId, setSelectedDayId] = useState<string>(() => trip.days[0]?.id ?? '')

  useEffect(() => {
    const first = trip.days[0]
    if (!first) return
    if (!selectedDayId || !trip.days.some((d) => d.id === selectedDayId)) {
      setSelectedDayId(first.id)
    }
  }, [selectedDayId, trip.days])

  const selectedDay = trip.days.find((d) => d.id === selectedDayId) ?? trip.days[0]

  const [placeQuery, setPlaceQuery] = useState('')
  const [placeResults, setPlaceResults] = useState<NominatimPlace[]>([])
  const [placeLoading, setPlaceLoading] = useState(false)
  const [pendingPlace, setPendingPlace] = useState<NominatimPlace | null>(null)
  const [pendingCategory, setPendingCategory] = useState<StopCategory>('sight')

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

  const [aiMarkdown, setAiMarkdown] = useState<string>('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const aiAbortRef = useRef<AbortController | null>(null)

  async function runAiSuggest() {
    setAiError(null)
    setAiLoading(true)
    setAiMarkdown('')

    aiAbortRef.current?.abort()
    aiAbortRef.current = new AbortController()

    const prompt =
      `Trip name: ${trip.name}\n` +
      `Transport: ${trip.transportMode}\n` +
      `Selected day: ${selectedDay?.title}\n` +
      `Stops:\n` +
      (selectedDay?.stops ?? [])
        .map((s, idx) => `${idx + 1}. [${s.category}] ${s.name} (${s.lat}, ${s.lon})`)
        .join('\n')

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
      setAiMarkdown(String(json?.suggestionMarkdown ?? ''))
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
                        <div key={s.id} className="rounded-md border border-slate-200 p-2">
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
                          <div className="line-clamp-2">{p.display_name}</div>
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
              </div>
            ) : null}
          </div>
        </aside>

        <section className="min-w-0 flex-1">
          <div className="flex h-full flex-col">
            <div className="border-b border-slate-200 bg-white">
              <div className="mx-auto grid max-w-6xl grid-cols-1 gap-3 px-4 py-3 md:grid-cols-3">
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
              </div>
            </div>

            <div className="min-h-0 flex-1">
              <div className="grid h-full grid-cols-1 md:grid-cols-5">
                <div className="md:col-span-3">
                  <ItineraryMap stops={selectedDay?.stops ?? []} route={route?.geometry ?? null} />
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

                      {aiMarkdown ? (
                        <pre className="mt-2 whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-800">
                          {aiMarkdown}
                        </pre>
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
