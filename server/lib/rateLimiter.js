// Sliding-window rate limiter keyed by an arbitrary string (session id, IP, etc).
// Never blocks permanently — callers get a retryAfterMs value and the design
// rule from the blueprint ("never permanently lock players out") stays intact.

const buckets = new Map();

function checkLimit(key, { windowMs, max }) {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = [];
    buckets.set(key, bucket);
  }
  while (bucket.length && bucket[0] < now - windowMs) bucket.shift();

  if (bucket.length >= max) {
    const retryAfterMs = windowMs - (now - bucket[0]);
    return { allowed: false, retryAfterMs: Math.max(retryAfterMs, 0) };
  }

  bucket.push(now);
  return { allowed: true, remaining: max - bucket.length };
}

setInterval(() => {
  const cutoff = Date.now() - 1000 * 60 * 60;
  for (const [key, bucket] of buckets) {
    if (!bucket.length || bucket[bucket.length - 1] < cutoff) buckets.delete(key);
  }
}, 1000 * 60 * 30).unref();

export { checkLimit };
