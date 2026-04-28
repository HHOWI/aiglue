/** Minimal Tracer / Span shape compatible with `@opentelemetry/api`. We deliberately do NOT take a
 *  hard dependency on @opentelemetry/api — the user wires it in when they want, and aiglue stays
 *  ship-able for projects that have no observability stack. */

export const SpanStatus = {
  UNSET: 0,
  OK: 1,
  ERROR: 2,
} as const

export type SpanStatusCode = typeof SpanStatus[keyof typeof SpanStatus]

export interface SpanLike {
  setAttribute(key: string, value: string | number | boolean): SpanLike | void
  setAttributes?(attributes: Record<string, string | number | boolean | undefined>): SpanLike | void
  setStatus(status: { code: SpanStatusCode; message?: string }): SpanLike | void
  recordException(exception: unknown): SpanLike | void
  end(): void
}

export interface TracerLike {
  /** Same shape as @opentelemetry/api Tracer.startActiveSpan(name, fn). */
  startActiveSpan<T>(name: string, fn: (span: SpanLike) => T | Promise<T>): T | Promise<T>
}

class NoOpSpan implements SpanLike {
  setAttribute(): void {}
  setAttributes(): void {}
  setStatus(): void {}
  recordException(): void {}
  end(): void {}
}

const NOOP_SPAN = new NoOpSpan()

class NoOpTracer implements TracerLike {
  startActiveSpan<T>(_name: string, fn: (span: SpanLike) => T | Promise<T>): T | Promise<T> {
    return fn(NOOP_SPAN)
  }
}

export const NO_OP_TRACER: TracerLike = new NoOpTracer()

/** Sets an attribute, accepting undefined values silently (OTel rejects undefined). */
export function setAttr(span: SpanLike, key: string, value: string | number | boolean | undefined): void {
  if (value === undefined) return
  span.setAttribute(key, value)
}
