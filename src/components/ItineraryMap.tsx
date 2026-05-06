import { useEffect, useMemo } from 'react'
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import marker2x from 'leaflet/dist/images/marker-icon-2x.png'
import marker from 'leaflet/dist/images/marker-icon.png'
import shadow from 'leaflet/dist/images/marker-shadow.png'
import type { Stop } from '../domain/trip'
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

export function ItineraryMap({
  stops,
  route,
}: {
  stops: Stop[]
  route: LatLng[] | null
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

      {stops.map((s, idx) => (
        <Marker key={s.id} position={[s.lat, s.lon]}>
          <Popup>
            <div className="text-sm">
              <div className="font-medium">{idx + 1}. {s.name}</div>
              <div className="text-slate-600">{s.category}</div>
            </div>
          </Popup>
        </Marker>
      ))}

      {routePoints.length > 0 ? <Polyline positions={routePoints} /> : null}
    </MapContainer>
  )
}
