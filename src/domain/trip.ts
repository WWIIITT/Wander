export type StopCategory = 'sight' | 'restaurant' | 'toilet'

export type TransportMode = 'driving' | 'foot' | 'bike'

export type Stop = {
  id: string
  name: string
  lat: number
  lon: number
  category: StopCategory
}

export type DayPlan = {
  id: string
  title: string
  dateISO?: string
  stops: Stop[]
}

export type TripPlan = {
  name: string
  transportMode: TransportMode
  days: DayPlan[]
  aiSuggestion?: string
}
