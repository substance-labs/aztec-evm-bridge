import { createLogger as createWinstonLogger, format, transports } from "winston"

export function createLogger(name: string) {
  return createWinstonLogger({
    level: "info",
    format: format.combine(
      format.timestamp({ format: "HH:mm:ss.SSS" }),
      format.printf(({ timestamp, level, message }) => {
        return `[${timestamp}] ${level.toUpperCase()}: ${name} ${message}`
      }),
    ),
    transports: [new transports.Console()],
  })
}
