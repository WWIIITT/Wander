export type DailyWeather = {
  dateISO: string
  tMinC?: number
  tMaxC?: number
  precipProbMax?: number
  weatherCode?: number
}

export async function fetchDailyForecast(lat: number, lon: number): Promise<DailyWeather[] | null> {
  const url = new URL('https://api.open-meteo.com/v1/forecast')
  url.searchParams.set('latitude', String(lat))
  url.searchParams.set('longitude', String(lon))
  url.searchParams.set('daily', 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max')
  url.searchParams.set('timezone', 'auto')

  const res = await fetch(url.toString())
  if (!res.ok) return null
  const json = (await res.json()) as any

  const time: string[] | undefined = json?.daily?.time
  const tMax: number[] | undefined = json?.daily?.temperature_2m_max
  const tMin: number[] | undefined = json?.daily?.temperature_2m_min
  const precip: number[] | undefined = json?.daily?.precipitation_probability_max
  const code: number[] | undefined = json?.daily?.weather_code

  if (!Array.isArray(time)) return null

  return time.map((dateISO, idx) => ({
    dateISO,
    tMinC: Array.isArray(tMin) ? tMin[idx] : undefined,
    tMaxC: Array.isArray(tMax) ? tMax[idx] : undefined,
    precipProbMax: Array.isArray(precip) ? precip[idx] : undefined,
    weatherCode: Array.isArray(code) ? code[idx] : undefined,
  }))
}
