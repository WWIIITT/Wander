import { nanoid } from 'nanoid'
import * as Y from 'yjs'
import type { DayPlan, Stop, StopCategory, TransportMode, TripPlan } from '../domain/trip'

type YStopMap = Y.Map<unknown>
type YDayMap = Y.Map<unknown>

type YTripMap = Y.Map<unknown>

const DEFAULT_TRIP_NAME = '漫迹 Wander'

function getString(map: Y.Map<unknown>, key: string, fallback = ''): string {
  const v = map.get(key)
  return typeof v === 'string' ? v : fallback
}

function getNumber(map: Y.Map<unknown>, key: string, fallback = 0): number {
  const v = map.get(key)
  return typeof v === 'number' ? v : fallback
}

function getYArray<T>(map: Y.Map<unknown>, key: string): Y.Array<T> {
  let arr = map.get(key)
  if (!(arr instanceof Y.Array)) {
    arr = new Y.Array<T>()
    map.set(key, arr)
  }
  return arr as Y.Array<T>
}

export function getOrInitTrip(doc: Y.Doc): YTripMap {
  const trip = doc.getMap('trip') as YTripMap
  if (!trip.has('name')) trip.set('name', DEFAULT_TRIP_NAME)
  if (!trip.has('transportMode')) trip.set('transportMode', 'foot' satisfies TransportMode)

  const days = getYArray<YDayMap>(trip, 'days')
  if (days.length === 0) {
    const day = new Y.Map<unknown>() as YDayMap
    day.set('id', nanoid())
    day.set('title', 'Day 1')
    day.set('stops', new Y.Array<YStopMap>())
    days.push([day])
  }

  return trip
}

function yStopToJson(stopMap: YStopMap): Stop {
  return {
    id: getString(stopMap, 'id'),
    name: getString(stopMap, 'name'),
    lat: getNumber(stopMap, 'lat'),
    lon: getNumber(stopMap, 'lon'),
    category: (getString(stopMap, 'category', 'sight') as StopCategory) ?? 'sight',
  }
}

function yDayToJson(dayMap: YDayMap): DayPlan {
  const stopsArr = getYArray<YStopMap>(dayMap, 'stops')
  return {
    id: getString(dayMap, 'id'),
    title: getString(dayMap, 'title', 'Day'),
    dateISO: getString(dayMap, 'dateISO', undefined as unknown as string) || undefined,
    stops: stopsArr.toArray().map(yStopToJson),
  }
}

export function tripToJson(trip: YTripMap): TripPlan {
  const daysArr = getYArray<YDayMap>(trip, 'days')
  return {
    name: getString(trip, 'name', DEFAULT_TRIP_NAME),
    transportMode: (getString(trip, 'transportMode', 'foot') as TransportMode) ?? 'foot',
    days: daysArr.toArray().map(yDayToJson),
    aiSuggestion: getString(trip, 'aiSuggestion', ''),
  }
}

export function addDay(trip: YTripMap): string {
  const days = getYArray<YDayMap>(trip, 'days')
  const newId = nanoid()
  const day = new Y.Map<unknown>() as YDayMap
  day.set('id', newId)
  day.set('title', `Day ${days.length + 1}`)
  day.set('stops', new Y.Array<YStopMap>())
  days.push([day])
  return newId
}

export function removeDay(trip: YTripMap, dayId: string): void {
  const days = getYArray<YDayMap>(trip, 'days')
  const idx = days.toArray().findIndex((d) => getString(d, 'id') === dayId)
  if (idx >= 0 && days.length > 1) days.delete(idx, 1)
}

export function renameDay(trip: YTripMap, dayId: string, title: string): void {
  const days = getYArray<YDayMap>(trip, 'days')
  const day = days.toArray().find((d) => getString(d, 'id') === dayId)
  if (day) day.set('title', title)
}

export function setTransportMode(trip: YTripMap, mode: TransportMode): void {
  trip.set('transportMode', mode)
}

export function addStopToDay(trip: YTripMap, dayId: string, stop: Omit<Stop, 'id'>): string {
  const days = getYArray<YDayMap>(trip, 'days')
  const day = days.toArray().find((d) => getString(d, 'id') === dayId)
  if (!day) return ''

  const stops = getYArray<YStopMap>(day, 'stops')
  const stopId = nanoid()
  const yStop = new Y.Map<unknown>() as YStopMap
  yStop.set('id', stopId)
  yStop.set('name', stop.name)
  yStop.set('lat', stop.lat)
  yStop.set('lon', stop.lon)
  yStop.set('category', stop.category)
  stops.push([yStop])
  return stopId
}

export function removeStop(trip: YTripMap, dayId: string, stopId: string): void {
  const days = getYArray<YDayMap>(trip, 'days')
  const day = days.toArray().find((d) => getString(d, 'id') === dayId)
  if (!day) return
  const stops = getYArray<YStopMap>(day, 'stops')
  const idx = stops.toArray().findIndex((s) => getString(s, 'id') === stopId)
  if (idx >= 0) stops.delete(idx, 1)
}

export function moveStop(trip: YTripMap, dayId: string, stopId: string, direction: -1 | 1): void {
  const days = getYArray<YDayMap>(trip, 'days')
  const day = days.toArray().find((d) => getString(d, 'id') === dayId)
  if (!day) return
  const stops = getYArray<YStopMap>(day, 'stops')
  const arr = stops.toArray()
  const idx = arr.findIndex((s) => getString(s, 'id') === stopId)
  const nextIdx = idx + direction
  if (idx < 0 || nextIdx < 0 || nextIdx >= arr.length) return

  const [item] = arr.splice(idx, 1)
  arr.splice(nextIdx, 0, item)

  stops.delete(0, stops.length)
  stops.push(arr)
}

export function updateStopCategory(trip: YTripMap, dayId: string, stopId: string, category: StopCategory): void {
  const days = getYArray<YDayMap>(trip, 'days')
  const day = days.toArray().find((d) => getString(d, 'id') === dayId)
  if (!day) return
  const stops = getYArray<YStopMap>(day, 'stops')
  const stop = stops.toArray().find((s) => getString(s, 'id') === stopId)
  if (stop) stop.set('category', category)
}

export function setAiSuggestion(trip: YTripMap, suggestion: string): void {
  trip.set('aiSuggestion', suggestion)
}
