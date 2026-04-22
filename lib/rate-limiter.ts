/**
 * Token-bucket rate limiter for external API calls.
 * Replaces the arbitrary sleep() calls in v1.
 */
export class RateLimiter {
  private tokens: number
  private lastRefill: number

  constructor(
    private maxTokens: number,
    private refillRate: number,
    private refillInterval = 1000
  ) {
    this.tokens = maxTokens
    this.lastRefill = Date.now()
  }

  private refill() {
    const elapsed = Date.now() - this.lastRefill
    const add = Math.floor(elapsed / this.refillInterval) * this.refillRate
    if (add > 0) {
      this.tokens = Math.min(this.maxTokens, this.tokens + add)
      this.lastRefill = Date.now()
    }
  }

  async acquire(count = 1) {
    while (true) {
      this.refill()
      if (this.tokens >= count) {
        this.tokens -= count
        return
      }
      await new Promise(r => setTimeout(r, 200))
    }
  }
}
