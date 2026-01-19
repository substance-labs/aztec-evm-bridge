export function createLogger(name: string) {
  return {
    info: (message: string) => {
      const timestamp = new Date().toLocaleTimeString("en-US", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        fractionalSecondDigits: 3,
      })
      console.log(`[${timestamp}] INFO: ${name} ${message}`)
    },
    error: (message: string) => {
      const timestamp = new Date().toLocaleTimeString("en-US", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        fractionalSecondDigits: 3,
      })
      console.error(`[${timestamp}] ERROR: ${name} ${message}`)
    },
  }
}
