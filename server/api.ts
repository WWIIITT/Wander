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
      ? '未接入实时路况（可配置路况 API 后启用提醒）'
      : '添加地点后可显示路况提醒（需要接入路况 API）',
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

function getOfflineSuggestion(isZh: boolean, wantsTransit: boolean): string {
  if (wantsTransit) {
    return isZh
      ? `### 公共交通建议（离线 / 未配置 Key）

- 优先把同一天的地点按地铁线、公交走廊或同一区域分组，减少跨城折返和换乘次数。
- 每段先查最近的地铁/火车站；短距离用步行接驳，距离较远或没有轨道交通时再考虑公交。
- 给每次换乘预留 8-15 分钟，热门景点和饭点前后要再多留排队与进站时间。
- 如果某一段需要多次换乘、绕路明显，建议改为步行/打车接驳到最近轨道站。
- 若当前是通勤高峰，优先推荐地铁/火车这类班次稳定的方式；若已接近深夜，提醒用户留意末班车并准备出租车备选。
- 输出时请明确写出建议工具，例如：地铁、公交、城铁、机场快线、渡轮，而不是只写“公共交通”。

提示：当前地图路线仍基于 OSRM 估算，不包含实时公交班次。`
      : `### Public Transport Suggestions (offline / no key)

- Group each day by metro/train lines, bus corridors, or nearby districts to reduce backtracking and transfers.
- For each leg, check the nearest station first; use walking for short access and buses when rail coverage is poor.
- Budget 8-15 minutes per transfer, plus extra time near popular sights or meal-time crowds.
- If a leg needs multiple transfers or a large detour, use a short walk/taxi hop to the nearest rail station.
- During commuter peaks, prefer metro/train options with stable frequency; near late evening, warn about last-train risk and suggest a taxi fallback.
- Name the likely tool for each leg explicitly: metro, bus, commuter rail, airport rail, ferry, tram, or walking connection.

Note: map routing is still OSRM-based and does not include live transit schedules.`
  }

  return isZh
    ? `### 建议（离线 / 未配置 Key）

- 先把每天的景点 / 餐厅 / 厕所按地理位置聚类到同一天。
- 每天优先：**上午景点** -> **午餐** -> **下午景点** -> **晚餐**。
- 交通方式：市内优先步行/地铁，跨区优先打车/公交。

把你想去的地点先添加到左侧列表，我会根据距离自动算出路线和距离。`
    : `### Suggestions (offline / no key)

- Group places by geography per day to avoid backtracking.
- Typical day: **morning sights** -> **lunch** -> **afternoon sights** -> **dinner**.
- City transport: walk/subway first, taxi/bus for longer hops.

Add the places you want on the left; the map will compute routes + distances.`
}

app.post('/api/ai/suggest', async (req, res) => {
  const parsed = SuggestRequest.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.flatten() })
    return
  }

  const { prompt, locale } = parsed.data
  const isZh = locale?.toLowerCase().startsWith('zh') ?? false
  const wantsTransit = /Transport:\s*(公共交通|transit)/i.test(prompt)
  const apiKey = process.env.OPENAI_API_KEY
  const baseUrl = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1'
  const model = process.env.OPENAI_MODEL ?? 'gpt-4.1-mini'

  if (!apiKey) {
    const response: SuggestResponse = {
      mode: 'stub',
      suggestionMarkdown: getOfflineSuggestion(isZh, wantsTransit),
    }
    res.json({ ok: true, ...response })
    return
  }

  try {
    const system = isZh
      ? '你是一个旅行规划助手。输出简洁的 Markdown，重点是每天行程、交通方式、距离/时间的优化建议。选择公共交通时，优先给出地铁、火车、公交、换乘、步行接驳和时间缓冲建议，不要默认推荐驾车。你会参考用户提供的目的地当前本地时间，区分白天、通勤高峰、夜间和末班车风险。请像 Google Maps 的公交路线建议那样具体说明每一段更适合的交通工具，但不要编造实时班次或具体发车时间。'
      : 'You are a travel planning assistant. Output concise Markdown focusing on day-by-day plan, transport mode choices, and distance/time optimization. When public transport is selected, prioritize metro, train, bus, transfers, walking access, and timing buffers instead of driving-first advice. Use the destination local time provided by the user to adapt the recommendation for daytime, commuter peak, evening, and last-train risk. Match the detail level of a Google Maps transit recommendation, but do not invent live schedules or exact departures.'

    const endpoint = baseUrl.endsWith('/chat/completions')
      ? baseUrl
      : `${baseUrl.replace(/\/$/, '')}/chat/completions`

    const completion = await fetch(endpoint, {
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
    const suggestionMarkdown = json.choices?.[0]?.message?.content ?? (isZh ? '（没有收到有效回复）' : '(No valid response)')

    const response: SuggestResponse = { mode: 'openai', suggestionMarkdown }
    res.json({ ok: true, ...response })
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) })
  }
})

app.listen(port, host, () => {
  console.log(`[api] listening on http://${host}:${port}`)
})
