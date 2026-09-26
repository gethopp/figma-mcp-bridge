/**
 * Read-only serialization of Figma prototype interactions.
 *
 * Everything here is written against small structural interfaces rather than
 * the `figma` global so it can be exercised under plain Node in tests. The
 * plugin entry point (`code.ts`) supplies a resolver that looks nodes and
 * variables up through the real Plugin API.
 *
 * Distinctions this module is careful to keep:
 *   - a node whose `reactions` is an empty array   -> "none"
 *   - a node type that has no `reactions` property -> "unsupported"
 *   - a node whose `reactions` getter threw        -> "error"
 * so a caller never mistakes "could not read" for "has no interactions".
 */

// --- Structural inputs -------------------------------------------------------

/** The subset of a Figma node this module reads. */
export interface ProtoNode {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly parent: ProtoNode | null;
  readonly children?: ReadonlyArray<ProtoNode>;
  /** May be absent (unsupported node type) or throw when read. */
  readonly reactions?: ReadonlyArray<Reaction>;
  readonly overlayPositionType?: string;
  readonly overlayBackground?: unknown;
  readonly overlayBackgroundInteraction?: string;
}

export interface ResolvedVariable {
  id: string;
  name: string;
  resolvedType?: string;
}

export interface ResolvedCollection {
  id: string;
  name: string;
  modes: ReadonlyArray<{ modeId: string; name: string }>;
}

/** Lookups supplied by the host. Every method may reject; failures are recorded, not thrown. */
export interface PrototypeResolver {
  getNode(id: string): Promise<ProtoNode | null>;
  getVariable?(id: string): Promise<ResolvedVariable | null>;
  getVariableCollection?(id: string): Promise<ResolvedCollection | null>;
}

// --- Serialized outputs ------------------------------------------------------

export type NodeRef = { id: string; name: string; type: string };

export type DestinationRef =
  | {
      status: "resolved";
      id: string;
      name: string;
      type: string;
      /** Top-level screen containing the destination (the destination itself when it is a screen). */
      screen: NodeRef | null;
      page: NodeRef | null;
      overlay?: {
        positionType?: string;
        background?: unknown;
        backgroundInteraction?: string;
      };
    }
  | { status: "missing"; id: string }
  | { status: "error"; id: string; error: string }
  | { status: "none"; id: null };

export type VariableLookup =
  ResolvedVariable | { status: "missing" | "error" | "unavailable"; error?: string };

export type SerializedTrigger = { type: string; [key: string]: unknown };

export type SerializedVariableData = {
  type?: string;
  resolvedType?: string;
  value?: unknown;
};

export type SerializedAction =
  | { type: "BACK" | "CLOSE" }
  | { type: "URL"; url: string; openInNewTab?: boolean }
  | {
      type: "NODE";
      navigation: string;
      destinationId: string | null;
      destination: DestinationRef;
      transition: unknown;
      resetScrollPosition?: boolean;
      preserveScrollPosition?: boolean;
      resetVideoPosition?: boolean;
      resetInteractiveComponents?: boolean;
      overlayRelativePosition?: { x: number; y: number };
    }
  | {
      type: "SET_VARIABLE";
      variableId: string | null;
      variable: VariableLookup | null;
      variableValue?: SerializedVariableData;
    }
  | {
      type: "SET_VARIABLE_MODE";
      variableCollectionId: string | null;
      variableModeId: string | null;
      collectionName?: string;
      modeName?: string;
    }
  | {
      type: "CONDITIONAL";
      conditionalBlocks: Array<{
        /** null means the block has no condition: the "else" branch. */
        condition: SerializedVariableData | null;
        actions: SerializedAction[];
      }>;
    }
  | {
      type: "UPDATE_MEDIA_RUNTIME";
      mediaAction: string;
      destinationId: string | null;
      destination: DestinationRef;
      amountToSkip?: number;
      newTimestamp?: number;
    }
  | { type: string; unsupported: true; raw: unknown };

export type SerializedReaction = {
  trigger: SerializedTrigger | null;
  actions: SerializedAction[];
  /** Which field the actions came from; "action" is the deprecated single-action field. */
  actionsSource: "actions" | "action" | "none";
};

export type ReactionReadStatus = "ok" | "none" | "unsupported" | "error";

export type NodeConnections = {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  /** True for sublayers of an instance (IDs of the form I<instance>;<child>). */
  instanceSublayer: boolean;
  /** Names from the screen down to this node, for orientation in large trees. */
  path: string[];
  screen: NodeRef | null;
  reactions: SerializedReaction[];
};

export type ScanResult = {
  root: NodeRef;
  connections: NodeConnections[];
  stats: {
    nodesScanned: number;
    nodesWithReactions: number;
    nodesWithoutReactions: number;
    unsupportedNodes: number;
    readErrors: number;
  };
  readErrors: Array<{ nodeId: string; nodeName: string; error: string }>;
  truncated: boolean;
};

// --- Helpers -----------------------------------------------------------------

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

const toRef = (node: ProtoNode): NodeRef => ({ id: node.id, name: node.name, type: node.type });

const SCREEN_CONTAINER_TYPES = new Set(["PAGE", "SECTION", "DOCUMENT"]);

/**
 * The top-level screen containing `node`: the outermost ancestor-or-self whose
 * parent is a page or section. Sections themselves and pages are not screens.
 */
export function screenOf(node: ProtoNode): ProtoNode | null {
  if (SCREEN_CONTAINER_TYPES.has(node.type)) return null;
  let current: ProtoNode = node;
  let guard = 0;
  while (current.parent && !SCREEN_CONTAINER_TYPES.has(current.parent.type)) {
    current = current.parent;
    if (++guard > 10_000) return null; // defensive: malformed parent chain
  }
  return current;
}

export function pageOf(node: ProtoNode): ProtoNode | null {
  let current: ProtoNode | null = node;
  let guard = 0;
  while (current) {
    if (current.type === "PAGE") return current;
    current = current.parent;
    if (++guard > 10_000) return null;
  }
  return null;
}

function pathFromScreen(node: ProtoNode, screen: ProtoNode | null): string[] {
  const names: string[] = [];
  let current: ProtoNode | null = node;
  let guard = 0;
  while (current) {
    names.unshift(current.name);
    if (current === screen || (screen && current.id === screen.id)) break;
    current = current.parent;
    if (++guard > 10_000) break;
  }
  return names;
}

/**
 * Reads `node.reactions` and classifies the outcome. The getter is invoked
 * inside try/catch because some node states make the Plugin API throw.
 */
export function readReactions(
  node: ProtoNode
):
  | { status: "ok"; reactions: ReadonlyArray<Reaction> }
  | { status: "none" }
  | { status: "unsupported" }
  | { status: "error"; error: string } {
  if (!("reactions" in node)) return { status: "unsupported" };
  try {
    const reactions = node.reactions;
    if (reactions === undefined || reactions === null) return { status: "unsupported" };
    if (reactions.length === 0) return { status: "none" };
    return { status: "ok", reactions };
  } catch (err) {
    return { status: "error", error: errorMessage(err) };
  }
}

export function serializeTrigger(trigger: Trigger | null | undefined): SerializedTrigger | null {
  if (!trigger) return null;
  const out: SerializedTrigger = {
    ...(trigger as unknown as Record<string, unknown>),
    type: trigger.type,
  };
  if ("keyCodes" in trigger) out.keyCodes = [...trigger.keyCodes];
  return out;
}

function cloneJson(value: unknown, depth = 0): unknown {
  if (depth > 20) return "[max depth]";
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => cloneJson(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "function" || typeof v === "symbol") continue;
    out[key] = cloneJson(v, depth + 1);
  }
  return out;
}

export function serializeVariableData(
  data: VariableData | undefined | null,
  depth = 0
): SerializedVariableData | undefined {
  if (!data) return undefined;
  const out: SerializedVariableData = {};
  if (data.type !== undefined) out.type = data.type;
  if (data.resolvedType !== undefined) out.resolvedType = data.resolvedType;
  const value = data.value as unknown;
  if (value !== undefined) {
    if (
      depth < 20 &&
      value !== null &&
      typeof value === "object" &&
      "expressionFunction" in (value as Record<string, unknown>)
    ) {
      const expr = value as Expression;
      out.value = {
        expressionFunction: expr.expressionFunction,
        expressionArguments: (expr.expressionArguments ?? []).map((arg) =>
          serializeVariableData(arg, depth + 1)
        ),
      };
    } else {
      out.value = cloneJson(value);
    }
  }
  return out;
}

// --- Serializer with resolution cache ---------------------------------------

export class PrototypeSerializer {
  private destinationCache = new Map<string, Promise<DestinationRef>>();
  private variableCache = new Map<string, Promise<VariableLookup>>();
  private readonly resolver: PrototypeResolver;

  constructor(resolver: PrototypeResolver) {
    this.resolver = resolver;
  }

  resolveDestination(id: string | null | undefined): Promise<DestinationRef> {
    if (!id) return Promise.resolve({ status: "none", id: null });
    let cached = this.destinationCache.get(id);
    if (!cached) {
      cached = this.lookupDestination(id);
      this.destinationCache.set(id, cached);
    }
    return cached;
  }

  private async lookupDestination(id: string): Promise<DestinationRef> {
    try {
      const node = await this.resolver.getNode(id);
      if (!node) return { status: "missing", id };
      const screen = screenOf(node);
      const page = pageOf(node);
      const ref: DestinationRef = {
        status: "resolved",
        id: node.id,
        name: node.name,
        type: node.type,
        screen: screen ? toRef(screen) : null,
        page: page ? toRef(page) : null,
      };
      if ("overlayPositionType" in node && node.overlayPositionType !== undefined) {
        try {
          ref.overlay = {
            positionType: node.overlayPositionType,
            background: cloneJson(node.overlayBackground),
            backgroundInteraction: node.overlayBackgroundInteraction,
          };
        } catch {
          // Overlay settings are advisory; a failed read leaves them out.
        }
      }
      return ref;
    } catch (err) {
      return { status: "error", id, error: errorMessage(err) };
    }
  }

  private resolveVariable(id: string | null): Promise<VariableLookup | null> {
    if (!id) return Promise.resolve(null);
    const getVariable = this.resolver.getVariable;
    if (!getVariable) return Promise.resolve({ status: "unavailable" });
    let cached = this.variableCache.get(id);
    if (!cached) {
      cached = getVariable
        .call(this.resolver, id)
        .then((v): VariableLookup => v ?? { status: "missing" })
        .catch((err: unknown): VariableLookup => ({ status: "error", error: errorMessage(err) }));
      this.variableCache.set(id, cached);
    }
    return cached;
  }

  async serializeAction(action: Action, depth = 0): Promise<SerializedAction> {
    const type = (action as { type: string }).type;
    switch (type) {
      case "BACK":
      case "CLOSE":
        return { type: type as "BACK" | "CLOSE" };
      case "URL": {
        const a = action as Extract<Action, { type: "URL" }>;
        const out: SerializedAction = { type: "URL", url: a.url };
        if (a.openInNewTab !== undefined) out.openInNewTab = a.openInNewTab;
        return out;
      }
      case "NODE": {
        const a = action as Extract<Action, { type: "NODE" }>;
        const out: Extract<SerializedAction, { type: "NODE" }> = {
          type: "NODE",
          navigation: a.navigation,
          destinationId: a.destinationId,
          destination: await this.resolveDestination(a.destinationId),
          transition: cloneJson(a.transition),
        };
        if (a.resetScrollPosition !== undefined) out.resetScrollPosition = a.resetScrollPosition;
        if (a.preserveScrollPosition !== undefined)
          out.preserveScrollPosition = a.preserveScrollPosition;
        if (a.resetVideoPosition !== undefined) out.resetVideoPosition = a.resetVideoPosition;
        if (a.resetInteractiveComponents !== undefined)
          out.resetInteractiveComponents = a.resetInteractiveComponents;
        if (a.overlayRelativePosition)
          out.overlayRelativePosition = {
            x: a.overlayRelativePosition.x,
            y: a.overlayRelativePosition.y,
          };
        return out;
      }
      case "SET_VARIABLE": {
        const a = action as Extract<Action, { type: "SET_VARIABLE" }>;
        const out: Extract<SerializedAction, { type: "SET_VARIABLE" }> = {
          type: "SET_VARIABLE",
          variableId: a.variableId,
          variable: await this.resolveVariable(a.variableId),
        };
        const value = serializeVariableData(a.variableValue);
        if (value) out.variableValue = value;
        return out;
      }
      case "SET_VARIABLE_MODE": {
        const a = action as Extract<Action, { type: "SET_VARIABLE_MODE" }>;
        const out: Extract<SerializedAction, { type: "SET_VARIABLE_MODE" }> = {
          type: "SET_VARIABLE_MODE",
          variableCollectionId: a.variableCollectionId,
          variableModeId: a.variableModeId,
        };
        if (a.variableCollectionId && this.resolver.getVariableCollection) {
          try {
            const collection = await this.resolver.getVariableCollection(a.variableCollectionId);
            if (collection) {
              out.collectionName = collection.name;
              const mode = collection.modes.find((m) => m.modeId === a.variableModeId);
              if (mode) out.modeName = mode.name;
            }
          } catch {
            // Names are a convenience; IDs are always present.
          }
        }
        return out;
      }
      case "CONDITIONAL": {
        const a = action as Extract<Action, { type: "CONDITIONAL" }>;
        if (depth > 20) return { type, unsupported: true, raw: "[max conditional depth]" };
        const blocks = [];
        for (const block of a.conditionalBlocks ?? []) {
          blocks.push({
            condition: serializeVariableData(block.condition) ?? null,
            actions: await this.serializeActions(block.actions ?? [], depth + 1),
          });
        }
        return { type: "CONDITIONAL", conditionalBlocks: blocks };
      }
      case "UPDATE_MEDIA_RUNTIME": {
        const a = action as Extract<Action, { type: "UPDATE_MEDIA_RUNTIME" }> & {
          amountToSkip?: number;
          newTimestamp?: number;
        };
        const destinationId = a.destinationId ?? null;
        const out: Extract<SerializedAction, { type: "UPDATE_MEDIA_RUNTIME" }> = {
          type: "UPDATE_MEDIA_RUNTIME",
          mediaAction: a.mediaAction,
          destinationId,
          destination: await this.resolveDestination(destinationId),
        };
        if (a.amountToSkip !== undefined) out.amountToSkip = a.amountToSkip;
        if (a.newTimestamp !== undefined) out.newTimestamp = a.newTimestamp;
        return out;
      }
      default:
        // An action type newer than these typings: keep the data, flag it.
        return { type, unsupported: true, raw: cloneJson(action) };
    }
  }

  async serializeActions(actions: ReadonlyArray<Action>, depth = 0): Promise<SerializedAction[]> {
    const out: SerializedAction[] = [];
    for (const action of actions) out.push(await this.serializeAction(action, depth));
    return out;
  }

  async serializeReaction(reaction: Reaction): Promise<SerializedReaction> {
    let source: SerializedReaction["actionsSource"] = "none";
    let actions: ReadonlyArray<Action> = [];
    if (reaction.actions && reaction.actions.length > 0) {
      source = "actions";
      actions = reaction.actions;
    } else if (reaction.action) {
      source = "action";
      actions = [reaction.action];
    }
    return {
      trigger: serializeTrigger(reaction.trigger),
      actions: await this.serializeActions(actions),
      actionsSource: source,
    };
  }

  /**
   * Walks `root` and every descendant, including instance sublayers, and
   * records each node that carries reactions.
   */
  async scan(
    root: ProtoNode,
    options: { maxNodes?: number; includeEmpty?: boolean } = {}
  ): Promise<ScanResult> {
    const maxNodes = options.maxNodes ?? 5000;
    const result: ScanResult = {
      root: toRef(root),
      connections: [],
      stats: {
        nodesScanned: 0,
        nodesWithReactions: 0,
        nodesWithoutReactions: 0,
        unsupportedNodes: 0,
        readErrors: 0,
      },
      readErrors: [],
      truncated: false,
    };

    const stack: Array<{ node: ProtoNode; depth: number }> = [{ node: root, depth: 0 }];
    const seen = new Set<string>();
    while (stack.length > 0) {
      const { node, depth } = stack.pop()!;
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      if (result.stats.nodesScanned >= maxNodes) {
        result.truncated = true;
        break;
      }
      result.stats.nodesScanned++;

      const read = readReactions(node);
      if (read.status === "ok") {
        result.stats.nodesWithReactions++;
        const screen = screenOf(node);
        const reactions: SerializedReaction[] = [];
        for (const reaction of read.reactions)
          reactions.push(await this.serializeReaction(reaction));
        result.connections.push({
          nodeId: node.id,
          nodeName: node.name,
          nodeType: node.type,
          instanceSublayer: node.id.startsWith("I"),
          path: pathFromScreen(node, screen),
          screen: screen ? toRef(screen) : null,
          reactions,
        });
      } else if (read.status === "none") {
        result.stats.nodesWithoutReactions++;
        if (options.includeEmpty) {
          const screen = screenOf(node);
          result.connections.push({
            nodeId: node.id,
            nodeName: node.name,
            nodeType: node.type,
            instanceSublayer: node.id.startsWith("I"),
            path: pathFromScreen(node, screen),
            screen: screen ? toRef(screen) : null,
            reactions: [],
          });
        }
      } else if (read.status === "unsupported") {
        result.stats.unsupportedNodes++;
      } else {
        result.stats.readErrors++;
        result.readErrors.push({ nodeId: node.id, nodeName: node.name, error: read.error });
      }

      let children: ReadonlyArray<ProtoNode> = [];
      try {
        children = node.children ?? [];
      } catch (err) {
        result.stats.readErrors++;
        result.readErrors.push({
          nodeId: node.id,
          nodeName: node.name,
          error: `children unreadable: ${errorMessage(err)}`,
        });
      }
      if (depth < 200) {
        // Push in reverse so traversal order matches layer order.
        for (let i = children.length - 1; i >= 0; i--)
          stack.push({ node: children[i], depth: depth + 1 });
      } else if (children.length > 0) {
        result.truncated = true;
      }
    }
    return result;
  }
}

// --- Flow tracing ------------------------------------------------------------

/** Navigations that put a different screen in front of the user. */
const SCREEN_NAVIGATIONS = new Set(["NAVIGATE", "SWAP", "OVERLAY"]);

export type FlowEdge = {
  fromScreen: NodeRef;
  source: { id: string; name: string; type: string; path: string[]; instanceSublayer: boolean };
  trigger: SerializedTrigger | null;
  /** Position of the action: reaction index, action index, and any conditional branches. */
  actionPath: string;
  /** True when the action sits inside a CONDITIONAL block. */
  conditional: boolean;
  condition?: SerializedVariableData | null;
  action: SerializedAction;
  kind: "screen" | "in-screen" | "back" | "close" | "url" | "variable" | "media" | "unsupported";
  /** For screen navigations: the screen the destination belongs to. */
  toScreen?: NodeRef | null;
  /** True when the destination screen was already reached earlier in this trace. */
  revisit?: boolean;
};

export type FlowTrace = {
  start: NodeRef;
  flowStartingPoints?: ReadonlyArray<{ nodeId: string; name: string }>;
  /** Screens in the order first reached (breadth-first). */
  screens: Array<NodeRef & { depth: number; reachedVia: string | null }>;
  edges: FlowEdge[];
  unresolved: Array<{ edgeIndex: number; destination: DestinationRef }>;
  readErrors: ScanResult["readErrors"];
  truncated: boolean;
  /** Screens discovered but not expanded because maxScreens was reached. */
  pending: NodeRef[];
};

function edgeKind(action: SerializedAction): FlowEdge["kind"] {
  if ("unsupported" in action && action.unsupported) return "unsupported";
  switch (action.type) {
    case "NODE":
      return SCREEN_NAVIGATIONS.has((action as { navigation: string }).navigation)
        ? "screen"
        : "in-screen";
    case "BACK":
      return "back";
    case "CLOSE":
      return "close";
    case "URL":
      return "url";
    case "SET_VARIABLE":
    case "SET_VARIABLE_MODE":
      return "variable";
    case "UPDATE_MEDIA_RUNTIME":
      return "media";
    default:
      return "unsupported";
  }
}

/** Flattens actions, descending into CONDITIONAL blocks while recording where each came from. */
export function flattenActions(
  actions: SerializedAction[],
  prefix: string,
  inherited: { conditional: boolean; condition?: SerializedVariableData | null } = {
    conditional: false,
  }
): Array<{
  action: SerializedAction;
  actionPath: string;
  conditional: boolean;
  condition?: SerializedVariableData | null;
}> {
  const out: Array<{
    action: SerializedAction;
    actionPath: string;
    conditional: boolean;
    condition?: SerializedVariableData | null;
  }> = [];
  actions.forEach((action, i) => {
    const path = `${prefix}.actions[${i}]`;
    if (action.type === "CONDITIONAL" && "conditionalBlocks" in action) {
      action.conditionalBlocks.forEach((block, b) => {
        out.push(
          ...flattenActions(block.actions, `${path}.conditionalBlocks[${b}]`, {
            conditional: true,
            condition: block.condition,
          })
        );
      });
      return;
    }
    out.push({ action, actionPath: path, ...inherited });
  });
  return out;
}

/**
 * Breadth-first trace of screen-to-screen navigation starting at `start`
 * (a screen or any node inside one). Cycles are recorded as revisits and not
 * re-expanded. Destinations that cannot be resolved are listed in `unresolved`.
 */
export async function traceFlow(
  start: ProtoNode,
  serializer: PrototypeSerializer,
  resolver: PrototypeResolver,
  options: { maxScreens?: number; maxNodesPerScreen?: number } = {}
): Promise<FlowTrace> {
  const maxScreens = options.maxScreens ?? 25;
  const startScreen = screenOf(start) ?? start;
  const trace: FlowTrace = {
    start: toRef(startScreen),
    screens: [],
    edges: [],
    unresolved: [],
    readErrors: [],
    truncated: false,
    pending: [],
  };

  const reached = new Map<string, { depth: number; reachedVia: string | null }>();
  const queue: Array<{ node: ProtoNode; depth: number; reachedVia: string | null }> = [
    { node: startScreen, depth: 0, reachedVia: null },
  ];
  reached.set(startScreen.id, { depth: 0, reachedVia: null });

  while (queue.length > 0) {
    const { node: screen, depth, reachedVia } = queue.shift()!;
    if (trace.screens.length >= maxScreens) {
      trace.truncated = true;
      trace.pending.push(toRef(screen), ...queue.map((q) => toRef(q.node)));
      break;
    }
    trace.screens.push({ ...toRef(screen), depth, reachedVia });

    const scan = await serializer.scan(screen, { maxNodes: options.maxNodesPerScreen ?? 5000 });
    trace.readErrors.push(...scan.readErrors);
    if (scan.truncated) trace.truncated = true;

    for (const connection of scan.connections) {
      connection.reactions.forEach((reaction, r) => {
        for (const flat of flattenActions(reaction.actions, `reactions[${r}]`)) {
          const edge: FlowEdge = {
            fromScreen: toRef(screen),
            source: {
              id: connection.nodeId,
              name: connection.nodeName,
              type: connection.nodeType,
              path: connection.path,
              instanceSublayer: connection.instanceSublayer,
            },
            trigger: reaction.trigger,
            actionPath: flat.actionPath,
            conditional: flat.conditional,
            action: flat.action,
            kind: edgeKind(flat.action),
          };
          if (flat.conditional) edge.condition = flat.condition ?? null;
          trace.edges.push(edge);
        }
      });
    }

    // Enqueue destinations after recording this screen's edges, in edge order.
    for (let i = 0; i < trace.edges.length; i++) {
      const edge = trace.edges[i];
      if (edge.fromScreen.id !== screen.id || edge.kind !== "screen" || edge.toScreen !== undefined)
        continue;
      const destination = (edge.action as { destination: DestinationRef }).destination;
      if (destination.status !== "resolved") {
        edge.toScreen = null;
        trace.unresolved.push({ edgeIndex: i, destination });
        continue;
      }
      const target = destination.screen ?? {
        id: destination.id,
        name: destination.name,
        type: destination.type,
      };
      edge.toScreen = target;
      if (reached.has(target.id)) {
        edge.revisit = true;
        continue;
      }
      edge.revisit = false;
      const targetNode = await resolver.getNode(target.id).catch(() => null);
      if (!targetNode) {
        trace.unresolved.push({ edgeIndex: i, destination: { status: "missing", id: target.id } });
        continue;
      }
      reached.set(target.id, { depth: depth + 1, reachedVia: edge.source.id });
      queue.push({ node: targetNode, depth: depth + 1, reachedVia: edge.source.id });
    }
  }

  return trace;
}
