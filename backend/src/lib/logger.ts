import pino from "pino";

/**
 * Application logger
 * Uses pino for structured logging
 */
export const logger = pino({
  transport: {
    target: "pino-pretty",
    options: {
      translateTime: "HH:MM:ss Z",
      ignore: "pid,hostname",
    },
  },
  level: process.env.LOG_LEVEL || "info",
});
