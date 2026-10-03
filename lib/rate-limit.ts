export async function distributedLimit(
  key: string,
  hash: string,
  limit: number,
): Promise<boolean | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL,
    token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url && !token) return null;
  if (!url?.startsWith("https://") || !token)
    throw new Error("rate_limit_unavailable");
  // One atomic Lua operation across all instances. Keys contain only hashed network identity.
  const lua = `local count=tonumber(redis.call('GET',KEYS[1]) or '0');if count>=tonumber(ARGV[1]) or redis.call('EXISTS',KEYS[2])==1 or redis.call('EXISTS',KEYS[3])==1 then return 0 end;redis.call('INCR',KEYS[1]);if count==0 then redis.call('EXPIRE',KEYS[1],3600) end;redis.call('SET',KEYS[2],'1','EX',10);redis.call('SET',KEYS[3],'1','EX',60);return 1`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        "EVAL",
        lua,
        3,
        `zest:${key}:hour`,
        `zest:${key}:recent`,
        `zest:${key}:${hash}`,
        limit,
      ]),
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error();
    const data = await response.json();
    if (data.error || ![0, 1].includes(data.result)) throw new Error();
    return data.result === 1;
  } catch {
    throw new Error("rate_limit_unavailable");
  }
}
