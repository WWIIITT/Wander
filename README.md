# 漫迹 Wander

Global travel planner MVP (web): day-by-day itinerary + clear route visualization + real-time collaboration.

## What’s inside

- **行程（按天）**: add days, add places, reorder stops
- **可视化路线**: map + per-leg distance/time + total distance
- **多人协作**: share a room link; edits sync in real time (Yjs)
- **实时天气**: Open-Meteo forecast (no API key)
- **智能推荐**: optional OpenAI-compatible backend; falls back to offline suggestions

## Run locally

Requirements: Node.js >= 22 (or >= 20.19).

```bash
npm install
npm run dev
```

This starts:
- Web: http://localhost:5173
- Collab WS: ws://localhost:1234
- API: http://localhost:8787

## Optional config

Environment variables (server side):

- `OPENAI_API_KEY` — enable `/api/ai/suggest`
- `OPENAI_BASE_URL` — default `https://api.openai.com/v1`
- `OPENAI_MODEL` — default `gpt-4.1-mini`

Client side (Vite):

- `VITE_COLLAB_WS_URL` — default `ws://localhost:1234`
- `VITE_MAP_TILES_URL` — custom tile server URL (useful in some regions)

## Notes

- Routing uses the public OSRM endpoint (`router.project-osrm.org`). It’s great for a demo but may be rate-limited; for production, self-host OSRM or use a paid routing provider.
- This MVP doesn’t persist rooms across server restarts (in-memory Yjs docs).
