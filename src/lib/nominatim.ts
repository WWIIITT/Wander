export type NominatimPlace = {
  place_id: number
  display_name: string
  lat: string
  lon: string
}

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<NominatimPlace[]> {
  const q = query.trim()
  if (!q) return []

  const url = new URL('https://nominatim.openstreetmap.org/search')
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('limit', '6')
  url.searchParams.set('q', q)

  const res = await fetch(url.toString(), {
    signal,
    headers: {
      // Nominatim asks for an identifiable UA in production. For local dev this is usually fine.
      accept: 'application/json',
    },
  })

  if (!res.ok) return []
  const json = (await res.json()) as NominatimPlace[]
  return Array.isArray(json) ? json : []
}
