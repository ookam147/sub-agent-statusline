export type SidebarReturnFocusAction = "none" | "clear-pending" | "focus-prompt";

export type PromptFocusTarget = {
  focus: () => void;
  readonly isDestroyed?: boolean;
};

type PromptFocusRenderer = {
  readonly currentFocusedEditor?: unknown;
  readonly currentFocusedRenderable?: unknown;
  on?: (event: string, listener: (current: unknown) => void) => unknown;
  off?: (event: string, listener: (current: unknown) => void) => unknown;
  removeListener?: (
    event: string,
    listener: (current: unknown) => void,
  ) => unknown;
};

export type PromptFocusController = {
  rememberCurrent: () => boolean;
  tryFocus: () => boolean;
  dispose: () => void;
};

function asPromptFocusTarget(value: unknown): PromptFocusTarget | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as PromptFocusTarget;
  if (typeof candidate.focus !== "function" || candidate.isDestroyed === true) {
    return undefined;
  }
  return candidate;
}

/**
 * Tracks the host-owned prompt editor without contributing a prompt slot.
 * Older renderers may expose only currentFocusedRenderable; that path is
 * sampled explicitly and does not subscribe to generic focus changes so the
 * sidebar itself cannot replace the remembered prompt target.
 */
export function createPromptFocusController(
  renderer: unknown,
  canRemember: () => boolean = () => true,
): PromptFocusController {
  const source =
    renderer && typeof renderer === "object"
      ? (renderer as PromptFocusRenderer)
      : undefined;
  const supportsFocusedEditor = Boolean(
    source && "currentFocusedEditor" in source,
  );
  let remembered: PromptFocusTarget | undefined;
  let disposed = false;
  let subscribed = false;

  const remember = (value: unknown): boolean => {
    if (disposed || !canRemember()) return false;
    const target = asPromptFocusTarget(value);
    if (!target) return false;
    remembered = target;
    return true;
  };

  const rememberCurrent = (): boolean => {
    if (!source) return false;
    try {
      return remember(
        supportsFocusedEditor
          ? source.currentFocusedEditor
          : source.currentFocusedRenderable,
      );
    } catch {
      return false;
    }
  };

  const handleFocusedEditor = (current: unknown): void => {
    remember(current);
  };

  if (supportsFocusedEditor && typeof source?.on === "function") {
    try {
      source.on("focused_editor", handleFocusedEditor);
      subscribed = true;
    } catch {
      subscribed = false;
    }
  }
  rememberCurrent();

  return {
    rememberCurrent,
    tryFocus(): boolean {
      if (disposed) return false;
      if (!asPromptFocusTarget(remembered)) {
        remembered = undefined;
        rememberCurrent();
      }
      const target = asPromptFocusTarget(remembered);
      if (!target) return false;
      try {
        target.focus();
        return true;
      } catch {
        remembered = undefined;
        return false;
      }
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (supportsFocusedEditor && subscribed) {
        try {
          if (typeof source?.off === "function") {
            source.off("focused_editor", handleFocusedEditor);
          } else if (typeof source?.removeListener === "function") {
            source.removeListener("focused_editor", handleFocusedEditor);
          }
        } catch {
          // Focus tracking is best-effort on older/custom renderers.
        }
      }
      remembered = undefined;
    },
  };
}

export type PendingSidebarRefocus = {
  parentSessionID: string;
  childSessionID: string;
  childRowID: string;
  showCompletedHistory?: boolean;
};

export type ChildSessionState = {
  id: string;
  parentID: string;
  targetSessionID?: string;
};

export function shouldReleaseSidebarListFocus(input: {
  previousRunningCount?: number;
  runningCount: number;
  listFocusModeActive: boolean;
}): boolean {
  return (
    input.listFocusModeActive &&
    (input.previousRunningCount ?? 0) > 0 &&
    input.runningCount === 0
  );
}

export function resolveSiblingSidebarRefocus(input: {
  pendingSidebarRefocus?: PendingSidebarRefocus;
  routeSessionID?: string;
  children: Record<string, ChildSessionState> | ChildSessionState[];
}): Pick<PendingSidebarRefocus, "childSessionID" | "childRowID"> | undefined {
  const { pendingSidebarRefocus, routeSessionID, children } = input;
  if (
    !pendingSidebarRefocus ||
    !routeSessionID ||
    routeSessionID === pendingSidebarRefocus.parentSessionID ||
    routeSessionID === pendingSidebarRefocus.childSessionID
  ) {
    return undefined;
  }

  const sibling = Object.values(children).find(
    (child) =>
      child.parentID === pendingSidebarRefocus.parentSessionID &&
      child.targetSessionID === routeSessionID,
  );
  if (!sibling) return undefined;

  return {
    childSessionID: routeSessionID,
    childRowID: sibling.id,
  };
}

export function resolveSidebarReturnFocusAction(input: {
  pendingSidebarRefocus?: PendingSidebarRefocus;
  previousRouteSessionID?: string;
  routeSessionID?: string;
}): SidebarReturnFocusAction {
  const { pendingSidebarRefocus, previousRouteSessionID, routeSessionID } = input;
  if (!pendingSidebarRefocus || previousRouteSessionID === routeSessionID) {
    return "none";
  }

  if (
    previousRouteSessionID === pendingSidebarRefocus.childSessionID &&
    routeSessionID === pendingSidebarRefocus.parentSessionID
  ) {
    return "focus-prompt";
  }

  if (routeSessionID !== pendingSidebarRefocus.childSessionID) {
    return "clear-pending";
  }

  return "none";
}

export function focusPromptWithDeferredRetry(
  tryFocusPrompt: () => boolean,
  schedule: (callback: () => void) => void = (callback) => {
    setTimeout(callback, 0);
  },
): void {
  schedule(() => {
    if (tryFocusPrompt()) return;
    schedule(() => {
      void tryFocusPrompt();
    });
  });
}
