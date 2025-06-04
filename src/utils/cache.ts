/**
 * Memoization decorator - provides in-memory caching for async functions
 *
 * @param fn The original async function to be memoized
 * @returns A function wrapper with caching capability
 */

export function memoize<T>(fn: (...args: any[]) => Promise<T>) {
  const cache = new Map<string, Promise<T>>()

  return async (...args: any[]): Promise<T> => {
    const key = JSON.stringify(args) ?? 'default'
    if (cache.has(key)) {
      return cache.get(key)!
    }

    const promise = fn(...args)
    cache.set(key, promise)
    return promise
  }
}
