import { sleep } from "@aztec/foundation/sleep"

/**
 * Retry a function with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries: number
    initialDelay?: number
    backoffMultiplier?: number
    onRetry?: (attempt: number, error: Error) => void
  },
): Promise<T> {
  const { maxRetries, initialDelay = 2000, backoffMultiplier = 1.5, onRetry } = options
  let lastError: Error

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error as Error

      if (attempt < maxRetries - 1) {
        const delay = initialDelay * Math.pow(backoffMultiplier, attempt)
        onRetry?.(attempt + 1, lastError)
        await sleep(delay)
      }
    }
  }

  throw new Error(`Failed after ${maxRetries} attempts: ${lastError!.message}`)
}

/**
 * Retry a condition check until it returns true or times out
 */
export async function waitForCondition(
  checkFn: () => Promise<boolean>,
  options: {
    timeout?: number
    interval?: number
    timeoutMessage?: string
  } = {},
): Promise<void> {
  const { timeout = 60000, interval = 3000, timeoutMessage = "Condition not met within timeout" } = options
  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    if (await checkFn()) {
      return
    }
    await sleep(interval)
  }

  throw new Error(timeoutMessage)
}
