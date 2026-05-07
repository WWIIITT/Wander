import { useEffect, useMemo, useState } from 'react'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import type { StopCategory, TransportMode, TripPlan } from '../domain/trip'
import {
  addDay,
  addStopToDay,
  getOrInitTrip,
  moveStop,
  removeDay,
  removeStop,
  renameDay,
  setTransportMode,
  tripToJson,
  updateStopCategory,
} from './tripDoc'

type Actions = {
  addDay: () => string
  removeDay: (dayId: string) => void
  renameDay: (dayId: string, title: string) => void
  setTransportMode: (mode: TransportMode) => void
  addStop: (dayId: string, stop: { name: string; lat: number; lon: number; category: StopCategory }) => string
  removeStop: (dayId: string, stopId: string) => void
  moveStop: (dayId: string, stopId: string, direction: -1 | 1) => void
  updateStopCategory: (dayId: string, stopId: string, category: StopCategory) => void
}

export function useTripRoom(roomId: string): {
  trip: TripPlan
  connected: boolean
  actions: Actions
} {
  const wsBaseUrl = import.meta.env.VITE_COLLAB_WS_URL ?? 'ws://localhost:1234'

  const { doc, tripMap } = useMemo(() => {
    const doc = new Y.Doc()
    const tripMap = getOrInitTrip(doc)
    return { doc, tripMap }
  }, [roomId])

  const [connected, setConnected] = useState(false)
  const [trip, setTrip] = useState<TripPlan>(() => tripToJson(tripMap))

  useEffect(() => {
    const provider = new WebsocketProvider(wsBaseUrl, roomId, doc)

    const update = () => {
      setTrip(tripToJson(tripMap))
    }

    tripMap.observeDeep(update)

    const onStatus = (event: { status: 'connected' | 'disconnected' | 'connecting' }) => {
      setConnected(event.status === 'connected')
    }

    provider.on('status', onStatus)

    update()

    return () => {
      provider.off('status', onStatus)
      provider.destroy()
      tripMap.unobserveDeep(update)
      doc.destroy()
    }
  }, [doc, roomId, tripMap, wsBaseUrl])

  const actions: Actions = useMemo(
    () => ({
      addDay: () => addDay(tripMap),
      removeDay: (dayId) => removeDay(tripMap, dayId),
      renameDay: (dayId, title) => renameDay(tripMap, dayId, title),
      setTransportMode: (mode) => setTransportMode(tripMap, mode),
      addStop: (dayId, stop) => addStopToDay(tripMap, dayId, stop),
      removeStop: (dayId, stopId) => removeStop(tripMap, dayId, stopId),
      moveStop: (dayId, stopId, direction) => moveStop(tripMap, dayId, stopId, direction),
      updateStopCategory: (dayId, stopId, category) => updateStopCategory(tripMap, dayId, stopId, category),
    }),
    [tripMap],
  )

  return { trip, connected, actions }
}
