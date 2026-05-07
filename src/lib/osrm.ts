import polyline from '@mapbox/polyline'
import type { TransportMode } from '../domain/trip'

export type LatLng = { lat: number; lng: number }

export type OsrmLeg = {
  distance: number
  duration: number
}

export type OsrmRoute = {
  distance: number
  duration: number
  geometry: LatLng[]
  legs: OsrmLeg[]
}

export async function fetchOsrmRoute(
  mode: TransportMode,
  points: Array<{ lat: number; lon: number }>,
): Promise<OsrmRoute | null> {
  if (points.length < 2) return null

  // router.project-osrm.org only supports the "driving" profile on the public demo server.
  // So we always fetch "driving", but we adjust the duration based on transportation mode.
  const coords = points.map((p) => `${p.lon},${p.lat}`).join(';')
  const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=polyline&steps=false`

  const res = await fetch(url)
  if (!res.ok) return null
  const json = (await res.json()) as any
  const route = json?.routes?.[0]
  if (!route?.geometry) return null

  const decoded = polyline.decode(route.geometry) as [number, number][]
  const geometry = decoded.map(([lat, lng]) => ({ lat, lng }))

  const legs: OsrmLeg[] = (route.legs ?? []).map((l: any) => {
    const dist = typeof l?.distance === 'number' ? l.distance : 0
    let dur = typeof l?.duration === 'number' ? l.duration : 0
    
    if (mode === 'foot') {
      dur = dist / 1.4 // ~5 km/h
    } else if (mode === 'bike') {
      dur = dist / 4.1 // ~15 km/h
    } else if (mode === 'transit') {
      dur = dist / 5.5 + 8 * 60 // ~20 km/h plus wait/walk/transfer buffer
    }
    
    return { distance: dist, duration: dur }
  })

  let totalDist = typeof route.distance === 'number' ? route.distance : 0
  let totalDur = typeof route.duration === 'number' ? route.duration : 0

  if (mode === 'foot') {
    totalDur = totalDist / 1.4
  } else if (mode === 'bike') {
    totalDur = totalDist / 4.1
  } else if (mode === 'transit') {
    totalDur = legs.reduce((sum, leg) => sum + leg.duration, 0)
  }

  return {
    distance: totalDist,
    duration: totalDur,
    geometry,
    legs,
  }
}
