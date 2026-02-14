/**
 * Scraper error classes extracted to break circular dependency between
 * api-utils.ts and scrapers/index.ts.
 */

export class ScraperError extends Error {
  constructor(
    public readonly message: string,
    public readonly source: string,
    public readonly isRetryable: boolean = true,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'ScraperError';
  }
}

export class SelectorNotFoundError extends ScraperError {
  constructor(source: string, selector: string) {
    super(`Selector not found: ${selector}`, source, false, 'SELECTOR_NOT_FOUND');
    this.name = 'SelectorNotFoundError';
  }
}

export class ProxyBlockedError extends ScraperError {
  constructor(source: string) {
    super('Request blocked by proxy/WAF', source, true, 'PROXY_BLOCKED');
    this.name = 'ProxyBlockedError';
  }
}

export class RateLimitError extends ScraperError {
  constructor(source: string) {
    super('Rate limit exceeded', source, true, 'RATE_LIMIT');
    this.name = 'RateLimitError';
  }
}

export class DnsError extends ScraperError {
  constructor(source: string, hostname: string) {
    super(`DNS resolution failed for ${hostname}`, source, true, 'DNS_ERROR');
    this.name = 'DnsError';
  }
}

export class CircuitBreakerOpenError extends ScraperError {
  constructor(source: string) {
    super(`Circuit breaker is open for source: ${source}`, source, false, 'CIRCUIT_OPEN');
    this.name = 'CircuitBreakerOpenError';
  }
}
