async function ensureDatabase(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS app_stats (
      id INTEGER PRIMARY KEY,
      visits INTEGER NOT NULL DEFAULT 0,
      users INTEGER NOT NULL DEFAULT 0
    )
  `).run()

  await db.prepare(`
    INSERT OR IGNORE INTO app_stats (id, visits, users)
    VALUES (1, 0, 0)
  `).run()
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  })
}

export async function onRequestGet(context) {
  try {
    const db = context.env.STATS_DB
    if (!db) return json({ error: 'STATS_DB binding is missing' }, 500)
    await ensureDatabase(db)
    const row = await db.prepare(`
      SELECT visits, users FROM app_stats WHERE id = 1
    `).first()
    return json({
      visits: Number(row?.visits ?? 0),
      users: Number(row?.users ?? 0)
    })
  } catch (error) {
    console.error(error)
    return json({ error: 'Could not read statistics' }, 500)
  }
}

export async function onRequestPost(context) {
  try {
    const db = context.env.STATS_DB
    if (!db) return json({ error: 'STATS_DB binding is missing' }, 500)
    await ensureDatabase(db)

    const body = await context.request.json()
    const type = body?.type
    if (type !== 'visit' && type !== 'use') {
      return json({ error: 'Invalid counter type' }, 400)
    }

    const column = type === 'visit' ? 'visits' : 'users'
    const row = await db.prepare(`
      UPDATE app_stats
      SET ${column} = ${column} + 1
      WHERE id = 1
      RETURNING visits, users
    `).first()

    return json({
      visits: Number(row?.visits ?? 0),
      users: Number(row?.users ?? 0)
    })
  } catch (error) {
    console.error(error)
    return json({ error: 'Could not update statistics' }, 500)
  }
}
