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

function modeToProfile(mode: TransportMode): string {
  switch (mode) {
    case 'driving':
      return 'driving'
    case 'bike':
      return 'bike'
    case 'foot':
    default:
      return 'foot'
  }
}

export async function fetchOsrmRoute(
  mode: TransportMode,
  points: Array<{ lat: number; lon: number }>,
): Promise<OsrmRoute | null> {
  if (points.length < 2) return null

  const profile = modeToProfile(mode)
  const coords = points.map((p) => `${p.lon},${p.lat}`).join(';')
  const url = `https://router.project-osrm.org/route/v1/${profile}/${coords}?overview=full&geometries=polyline&steps=false`

  const res = await fetch(url)
  if (!res.ok) return null
  const json = (await res.json()) as any
  const route = json?.routes?.[0]
  if (!route?.geometry) return null

  const decoded = polyline.decode(route.geometry) as [number, number][]
  const geometry = decoded.map(([lat, lng]) => ({ lat, lng }))

  const legs: OsrmLeg[] = (route.legs ?? []).map((l: any) => ({
    distance: typeof l?.distance === 'number' ? l.distance : 0,
    duration: typeof l?.duration === 'number' ? l.duration : 0,
  }))

  return {
    distance: typeof route.distance === 'number' ? route.distance : 0,
    duration: typeof route.duration === 'number' ? route.duration : 0,
    geometry,
    legs,
  }
}
