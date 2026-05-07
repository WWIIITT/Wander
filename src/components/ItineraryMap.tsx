import { useEffect, useMemo } from 'react'
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import marker2x from 'leaflet/dist/images/marker-icon-2x.png'
import marker from 'leaflet/dist/images/marker-icon.png'
import shadow from 'leaflet/dist/images/marker-shadow.png'
import type { Stop, StopCategory } from '../domain/trip'
import type { LatLng } from '../lib/osrm'

L.Icon.Default.mergeOptions({
  iconRetinaUrl: marker2x,
  iconUrl: marker,
  shadowUrl: shadow,
})

function FitBounds({ points }: { points: Array<{ lat: number; lon: number }> }) {
  const map = useMap()

  useEffect(() => {
    if (points.length === 0) return
    if (points.length === 1) {
      map.setView([points[0].lat, points[0].lon], 13)
      return
    }
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lon] as [number, number]))
    map.fitBounds(bounds.pad(0.2))
  }, [map, points])

  return null
}

function MapPick({
  onPick,
}: {
  onPick?: (p: { lat: number; lon: number }) => void
}) {
  useMapEvents({
    click: (e) => {
      onPick?.({ lat: e.latlng.lat, lon: e.latlng.lng })
    },
  })
  return null
}

function categoryColor(category: StopCategory): string {
  switch (category) {
    case 'restaurant':
      return 'bg-amber-600'
    case 'toilet':
      return 'bg-emerald-600'
    case 'sight':
    default:
      return 'bg-indigo-600'
  }
}

function createNumberedIcon({
  index,
  category,
  selected,
}: {
  index: number
  category: StopCategory
  selected: boolean
}): L.DivIcon {
  const base =
    'flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white shadow-md ring-2 ring-white'
  const sel = selected ? ' scale-110 ring-4 ring-black/10' : ''
  const color = categoryColor(category)

  return L.divIcon({
    className: '',
    html: `<div class="${base} ${color}${sel}">${index}</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -32],
  })
}

export function ItineraryMap({
  stops,
  route,
  selectedStopId,
  onSelectStop,
  onPickPoint,
  onChangeCategory,
}: {
  stops: Stop[]
  route: LatLng[] | null
  selectedStopId?: string
  onSelectStop?: (stopId: string) => void
  onPickPoint?: (p: { lat: number; lon: number }) => void
  onChangeCategory?: (stopId: string, category: StopCategory) => void
}) {
  const center = useMemo(() => {
    const s = stops[0]
    return s ? ([s.lat, s.lon] as [number, number]) : ([0, 0] as [number, number])
  }, [stops])

  const routePoints = route?.map((p) => [p.lat, p.lng] as [number, number]) ?? []

  return (
    <MapContainer
      center={center}
      zoom={stops.length ? 12 : 2}
      style={{ height: '100%', width: '100%' }}
      scrollWheelZoom
    >
      <TileLayer
        // Default OSM tiles. In some regions (e.g. mainland China) you may want to set a different tile server.
        url={import.meta.env.VITE_MAP_TILES_URL ?? 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'}
        attribution="&copy; OpenStreetMap contributors"
      />

      <FitBounds points={stops.map((s) => ({ lat: s.lat, lon: s.lon }))} />

      <MapPick onPick={onPickPoint} />

      {stops.map((s, idx) => (
        <Marker
          key={s.id}
          position={[s.lat, s.lon]}
          icon={createNumberedIcon({
            index: idx + 1,
            category: s.category,
            selected: selectedStopId === s.id,
          })}
          eventHandlers={{
            click: () => onSelectStop?.(s.id),
          }}
        >
          <Popup>
            <div className="text-sm">
              <div className="font-medium">
                {idx + 1}. {s.name}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <div className="text-xs text-slate-600">分类</div>
                <select
                  className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm"
                  value={s.category}
                  onChange={(e) => onChangeCategory?.(s.id, e.target.value as StopCategory)}
                >
                  <option value="sight">景点</option>
                  <option value="restaurant">餐厅</option>
                  <option value="toilet">厕所</option>
                </select>
              </div>
            </div>
          </Popup>
        </Marker>
      ))}

      {routePoints.length > 0 ? <Polyline positions={routePoints} /> : null}
    </MapContainer>
  )
}
