/**
 * Observed-request harness for Milestone A (Feature 003, design §7.1, §10.1).
 *
 * Every outbound transport reachable from the panel or the core modules is
 * replaced with a stub that records the attempt and throws immediately, so a
 * regression fails loudly and is proven by observation rather than by reading
 * source.
 */

export interface ObservedRequest {
  transport: string;
  detail: string;
}

export interface RequestObserver {
  requests: ObservedRequest[];
  restore: () => void;
}

const describeTarget = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "url" in value) return String((value as { url: unknown }).url);
  return String(value);
};

export const installRequestObserver = (): RequestObserver => {
  const requests: ObservedRequest[] = [];
  const target = globalThis as unknown as Record<string, unknown>;
  const patched: Array<{ key: string; existed: boolean; value: unknown }> = [];

  const record = (transport: string, detail: string): never => {
    requests.push({ transport, detail });
    throw new Error(`Zero-egress violation: ${transport} attempted an outbound request to ${detail}`);
  };

  const patch = (key: string, replacement: unknown) => {
    patched.push({ key, existed: key in target, value: target[key] });
    target[key] = replacement;
  };

  patch("fetch", (input: unknown) => record("fetch", describeTarget(input)));

  patch("XMLHttpRequest", class ObservedXhr {
    open(_method: string, url: string): void {
      record("XMLHttpRequest", describeTarget(url));
    }

    send(): void {
      record("XMLHttpRequest", "send");
    }

    setRequestHeader(): void {
      /* headers alone are not egress; open/send are the observed points */
    }
  });

  patch("WebSocket", class ObservedWebSocket {
    constructor(url: unknown) {
      record("WebSocket", describeTarget(url));
    }
  });

  patch("EventSource", class ObservedEventSource {
    constructor(url: unknown) {
      record("EventSource", describeTarget(url));
    }
  });

  let restoreBeacon: (() => void) | undefined;
  const runtimeNavigator = (globalThis as unknown as { navigator?: Record<string, unknown> }).navigator;
  if (runtimeNavigator) {
    try {
      const original = Object.getOwnPropertyDescriptor(runtimeNavigator, "sendBeacon");
      runtimeNavigator.sendBeacon = (url: unknown) => record("navigator.sendBeacon", describeTarget(url));
      restoreBeacon = () => {
        if (original) Object.defineProperty(runtimeNavigator, "sendBeacon", original);
        else Reflect.deleteProperty(runtimeNavigator, "sendBeacon");
      };
    } catch {
      restoreBeacon = undefined;
    }
  }

  return {
    requests,
    restore: () => {
      for (const entry of patched.reverse()) {
        if (entry.existed) target[entry.key] = entry.value;
        else Reflect.deleteProperty(target, entry.key);
      }
      patched.length = 0;
      restoreBeacon?.();
    },
  };
};

/** Runs `work` with every outbound transport observed, and returns what it attempted. */
export const withRequestObserver = async <T>(work: () => Promise<T> | T): Promise<{ result: T; requests: ObservedRequest[] }> => {
  const observer = installRequestObserver();
  try {
    const result = await work();
    return { result, requests: [...observer.requests] };
  } finally {
    observer.restore();
  }
};
