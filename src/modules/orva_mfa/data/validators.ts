import { z } from 'zod'

/** A 6-digit TOTP or a 10-char recovery code (with optional dash/space). */
export const challengeCodeSchema = z
  .string()
  .min(6)
  .max(16)
  .regex(/^[0-9A-Za-z\s-]+$/)

export const activateSchema = z.object({ code: challengeCodeSchema })
export const disableSchema = z.object({ code: challengeCodeSchema })
export const verifySchema = z.object({ code: challengeCodeSchema })
