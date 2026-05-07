import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { z } from 'zod'

const port = Number(process.env.API_PORT ?? 8787)
const host = process.env.API_HOST ?? '0.0.0.0'

const app = express()
app.use(cors())
app.use(express.json({ limit: '1mb' }))

app.get('/api/health', (_, res) => {
  res.json({ ok: true, name: 'wander-api' })
})

app.get('/api/traffic', (req, res) => {
  const lat = Number(req.query.lat)
  const lon = Number(req.query.lon)

  const hasPoint = Number.isFinite(lat) && Number.isFinite(lon)

  // MVP stub: no real-time traffic provider wired.
  // You can extend this endpoint to call a provider (TomTom/HERE/Mapbox/Google) when API keys are configured.
  res.json({
    ok: true,
    mode: 'stub' as const,
    level: 'unknown' as const,
    message: hasPoint
      ? '未接入实时路况（可配置路况API后启用提醒）'
      : '添加地点后可显示路况提醒（需接入路况API）',
  })
})

const SuggestRequest = z.object({
  locale: z.string().optional(),
  trip: z.unknown().optional(),
  prompt: z.string().min(1).max(2000),
})

type SuggestResponse = {
  mode: 'stub' | 'openai'
  suggestionMarkdown: string
}

app.post('/api/ai/suggest', async (req, res) => {
  const parsed = SuggestRequest.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.flatten() })
    return
  }

  const { prompt, locale } = parsed.data
  const apiKey = process.env.OPENAI_API_KEY
  const baseUrl = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1'
  const model = process.env.OPENAI_MODEL ?? 'gpt-4.1-mini'

  if (!apiKey) {
    const suggestionMarkdown =
      locale?.toLowerCase().startsWith('zh')
        ? `### 建议（离线/无Key模式）\n\n- 先把每天的"景点 / 餐厅 / 厕所"按地理位置聚类到同一天\n- 每天优先：**早(景点)** → **午(餐厅)** → **下午(景点)** → **晚(餐厅)**\n- 交通方式：市内优先步行/地铁，跨区优先打车/公交\n\n把你想去的地点先添加到左侧列表，我会根据距离自动算出路线和距离。`
        : `### Suggestions (offline / no key)\n\n- Group places by geography per day to avoid backtracking\n- Typical day: **morning sights** → **lunch** → **afternoon sights** → **dinner**\n- City transport: walk/subway first, taxi/bus for longer hops\n\nAdd the places you want on the left; the map will compute routes + distances.`

    const response: SuggestResponse = { mode: 'stub', suggestionMarkdown }
    res.json({ ok: true, ...response })
    return
  }

  try {
    const system =
      locale?.toLowerCase().startsWith('zh')
        ? '你是一个旅行规划助手。输出简洁的Markdown，重点是每天行程、交通方式、距离/时间的优化建议。'
        : 'You are a travel planning assistant. Output concise Markdown focusing on day-by-day plan, transport mode choices, and distance/time optimization.'

    const completion = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
      }),
    })

    if (!completion.ok) {
      const text = await completion.text()
      res.status(502).json({ ok: false, error: `OpenAI error: ${completion.status} ${text}` })
      return
    }

    type OpenAIChatResponse = {
      choices?: Array<{ message?: { content?: string | null } }>
    }

    const json = (await completion.json()) as OpenAIChatResponse
    const suggestionMarkdown =
      json.choices?.[0]?.message?.content ??
      (locale?.toLowerCase().startsWith('zh') ? '（没有收到有效回复）' : '(No valid response)')

    const response: SuggestResponse = { mode: 'openai', suggestionMarkdown }
    res.json({ ok: true, ...response })
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) })
  }
})

app.listen(port, host, () => {
  console.log(`[api] listening on http://${host}:${port}`)
})
