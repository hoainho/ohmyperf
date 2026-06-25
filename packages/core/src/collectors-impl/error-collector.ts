import {
  type CollectorContext,
  type CollectorFactory,
  type CollectorHandle,
  type CollectorResult,
  emptyCollectorResult,
} from "../collectors.js";
import type { CDPSessionLike, PageError } from "../types.js";

const MAX_ERRORS = 25;

interface ExceptionThrownParams {
  exceptionDetails?: {
    text?: string;
    url?: string;
    lineNumber?: number;
    stackTrace?: { callFrames?: Array<{ url: string; functionName: string; lineNumber: number }> };
    exception?: { className?: string; description?: string; value?: unknown };
  };
}

function classifySource(text: string): PageError["source"] {
  return /in promise/i.test(text) ? "unhandledrejection" : "exception";
}

/**
 * Passive error collector — subscribes to CDP `Runtime.exceptionThrown` (uncaught exceptions and,
 * in modern Chrome, unhandled promise rejections — disambiguated by the "(in promise)" hint).
 * Root frame only. originClass is attributed at engine aggregation time.
 */
export const errorCollectorFactory: CollectorFactory = {
  id: "ohmyperf.errors",
  requires: [],
  async create(session: CDPSessionLike, ctx: CollectorContext): Promise<CollectorHandle> {
    const errors: PageError[] = [];
    let installed = false;

    if (ctx.isRoot) {
      try {
        await session.send("Runtime.enable", {});
        installed = true;
      } catch (err) {
        ctx.logger.debug("error-collector: Runtime.enable failed", {
          frameId: ctx.frameId,
          error: errMessage(err),
        });
      }

      session.on("Runtime.exceptionThrown", (raw: unknown) => {
        if (errors.length >= MAX_ERRORS) return;
        const d = (raw as ExceptionThrownParams).exceptionDetails;
        if (!d) return;
        const exc = d.exception;
        const description = exc?.description;
        const rawText = d.text ?? "";
        const message = (description ?? rawText ?? "Uncaught error").split("\n")[0]!.trim() || "Uncaught error";
        const url = d.url ?? d.stackTrace?.callFrames?.[0]?.url;
        const error: PageError = {
          message,
          source: classifySource(`${rawText} ${message}`),
          ...(exc?.className ? { name: exc.className } : {}),
          ...(description && description !== message ? { stack: description } : {}),
          ...(url ? { url } : {}),
        };
        errors.push(error);
      });
    }

    return {
      id: errorCollectorFactory.id,
      async finalize(): Promise<CollectorResult> {
        if (!ctx.isRoot) return emptyCollectorResult();
        if (!installed) return emptyCollectorResult("error-collector-install-failed");
        return { metrics: {}, longTasks: [], resources: [], available: true, pageErrors: errors };
      },
      async dispose(): Promise<void> {
        return undefined;
      },
    };
  },
};

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
