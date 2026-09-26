// Runs under `node --test` using Node's built-in TypeScript type stripping.
// prototype.ts has no runtime dependency on the `figma` global, so it is
// exercised here against a hand-built node tree.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PrototypeSerializer,
  flattenActions,
  readReactions,
  screenOf,
  traceFlow,
} from "../src/main/prototype.ts";
import type { ProtoNode, PrototypeResolver } from "../src/main/prototype.ts";

type Spec = {
  id: string;
  name?: string;
  type?: string;
  reactions?: unknown[];
  /** Simulate a node type without the ReactionMixin. */
  noReactions?: boolean;
  /** Simulate a getter that throws. */
  throwReactions?: string;
  overlayPositionType?: string;
  children?: Spec[];
};

/** Builds a linked tree and returns an id -> node index. */
function build(spec: Spec, parent: ProtoNode | null = null, index = new Map<string, ProtoNode>()) {
  const node: Record<string, unknown> = {
    id: spec.id,
    name: spec.name ?? spec.id,
    type: spec.type ?? "FRAME",
    parent,
  };
  if (spec.throwReactions) {
    Object.defineProperty(node, "reactions", {
      enumerable: true,
      get() {
        throw new Error(spec.throwReactions);
      },
    });
  } else if (!spec.noReactions) {
    node.reactions = spec.reactions ?? [];
  }
  if (spec.overlayPositionType) {
    node.overlayPositionType = spec.overlayPositionType;
    node.overlayBackground = { type: "SOLID_COLOR", color: { r: 0, g: 0, b: 0, a: 0.4 } };
    node.overlayBackgroundInteraction = "CLOSE_ON_CLICK_OUTSIDE";
  }
  index.set(spec.id, node as unknown as ProtoNode);
  node.children = (spec.children ?? []).map(
    (c) => build(c, node as unknown as ProtoNode, index).node
  );
  return { node: node as unknown as ProtoNode, index };
}

function resolverFor(
  index: Map<string, ProtoNode>,
  failing: Set<string> = new Set()
): PrototypeResolver {
  return {
    async getNode(id) {
      if (failing.has(id)) throw new Error(`boom ${id}`);
      return index.get(id) ?? null;
    },
    async getVariable(id) {
      return id === "VariableID:1" ? { id, name: "isLoggedIn", resolvedType: "BOOLEAN" } : null;
    },
    async getVariableCollection(id) {
      return id === "Coll:1"
        ? { id, name: "Theme", modes: [{ modeId: "m1", name: "Dark" }] }
        : null;
    },
  };
}

const click = { type: "ON_CLICK" };
const navigate = (destinationId: string | null, navigation = "NAVIGATE") => ({
  type: "NODE",
  destinationId,
  navigation,
  transition: { type: "DISSOLVE", easing: { type: "EASE_OUT" }, duration: 0.3 },
  resetScrollPosition: true,
});

/** page > section > [A (with button + instance), B, C, Overlay] */
function fixture() {
  return build({
    id: "0:1",
    type: "PAGE",
    name: "Page 1",
    noReactions: true,
    children: [
      {
        id: "1:1",
        type: "SECTION",
        name: "flow",
        noReactions: true,
        children: [
          {
            id: "10:1",
            name: "screen A",
            children: [
              {
                id: "10:2",
                name: "sheet",
                children: [
                  {
                    id: "10:3",
                    name: "continue",
                    type: "INSTANCE",
                    reactions: [{ trigger: click, actions: [navigate("20:5")] }],
                    children: [{ id: "I10:3;1:1", name: "label", type: "TEXT", noReactions: true }],
                  },
                  {
                    id: "10:4",
                    name: "card",
                    type: "INSTANCE",
                    children: [
                      {
                        id: "I10:4;9:9",
                        name: "add car",
                        type: "INSTANCE",
                        reactions: [{ trigger: click, actions: [navigate("40:1", "OVERLAY")] }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            id: "20:1",
            name: "screen B",
            children: [
              { id: "20:5", name: "anchor", noReactions: true },
              {
                id: "20:2",
                name: "back",
                reactions: [{ trigger: click, actions: [{ type: "BACK" }] }],
              },
              {
                id: "20:3",
                name: "next",
                reactions: [
                  {
                    trigger: click,
                    actions: [
                      {
                        type: "CONDITIONAL",
                        conditionalBlocks: [
                          {
                            condition: {
                              type: "EXPRESSION",
                              resolvedType: "BOOLEAN",
                              value: {
                                expressionFunction: "EQUALS",
                                expressionArguments: [
                                  {
                                    type: "VARIABLE_ALIAS",
                                    value: { type: "VARIABLE_ALIAS", id: "VariableID:1" },
                                  },
                                  { type: "BOOLEAN", resolvedType: "BOOLEAN", value: true },
                                ],
                              },
                            },
                            actions: [navigate("30:1")],
                          },
                          { actions: [navigate("10:1")] },
                        ],
                      },
                    ],
                  },
                ],
              },
              {
                id: "20:4",
                name: "scroll",
                reactions: [{ trigger: click, actions: [navigate("20:5", "SCROLL_TO")] }],
              },
            ],
          },
          {
            id: "30:1",
            name: "screen C",
            reactions: [
              { trigger: { type: "AFTER_TIMEOUT", timeout: 800 }, actions: [navigate("99:9")] },
            ],
          },
          { id: "40:1", name: "overlay", overlayPositionType: "BOTTOM_CENTER" },
        ],
      },
    ],
  });
}

test("readReactions separates none, unsupported and failed reads", () => {
  const { index } = build({
    id: "p",
    type: "PAGE",
    noReactions: true,
    children: [
      { id: "a", reactions: [] },
      { id: "b", type: "TEXT", noReactions: true },
      { id: "c", throwReactions: "not loaded" },
    ],
  });
  assert.deepEqual(readReactions(index.get("a")!), { status: "none" });
  assert.deepEqual(readReactions(index.get("b")!), { status: "unsupported" });
  assert.deepEqual(readReactions(index.get("c")!), { status: "error", error: "not loaded" });
});

test("screenOf returns the top-level frame under a page or section", () => {
  const { index } = fixture();
  assert.equal(screenOf(index.get("I10:4;9:9")!)?.id, "10:1");
  assert.equal(screenOf(index.get("10:1")!)?.id, "10:1");
  assert.equal(screenOf(index.get("1:1")!), null);
});

test("serializeReaction keeps every action, in order, and falls back to the deprecated field", async () => {
  const { index } = fixture();
  const s = new PrototypeSerializer(resolverFor(index));

  const multi = await s.serializeReaction({
    trigger: { type: "ON_KEY_DOWN", device: "KEYBOARD", keyCodes: [13] },
    actions: [
      { type: "SET_VARIABLE_MODE", variableCollectionId: "Coll:1", variableModeId: "m1" },
      navigate("20:1"),
      { type: "URL", url: "https://example.com", openInNewTab: true },
    ],
  } as unknown as Reaction);
  assert.equal(multi.actionsSource, "actions");
  assert.deepEqual(multi.trigger, { type: "ON_KEY_DOWN", device: "KEYBOARD", keyCodes: [13] });
  assert.deepEqual(
    multi.actions.map((a) => a.type),
    ["SET_VARIABLE_MODE", "NODE", "URL"]
  );
  assert.equal((multi.actions[0] as { modeName?: string }).modeName, "Dark");
  assert.equal((multi.actions[0] as { collectionName?: string }).collectionName, "Theme");

  const legacy = await s.serializeReaction({
    trigger: click,
    action: { type: "CLOSE" },
  } as unknown as Reaction);
  assert.equal(legacy.actionsSource, "action");
  assert.deepEqual(legacy.actions, [{ type: "CLOSE" }]);

  const empty = await s.serializeReaction({ trigger: null } as unknown as Reaction);
  assert.equal(empty.actionsSource, "none");
  assert.equal(empty.trigger, null);
});

test("NODE destinations resolve to name, screen, page and overlay settings", async () => {
  const { index } = fixture();
  const s = new PrototypeSerializer(resolverFor(index, new Set(["66:6"])));

  const inner = await s.serializeAction(navigate("20:5") as unknown as Action);
  assert.equal(inner.type, "NODE");
  const dest = (inner as { destination: Record<string, unknown> }).destination;
  assert.equal(dest.status, "resolved");
  assert.equal(dest.name, "anchor");
  assert.deepEqual(dest.screen, { id: "20:1", name: "screen B", type: "FRAME" });
  assert.deepEqual(dest.page, { id: "0:1", name: "Page 1", type: "PAGE" });
  assert.equal((inner as { resetScrollPosition?: boolean }).resetScrollPosition, true);

  const overlay = await s.serializeAction(navigate("40:1", "OVERLAY") as unknown as Action);
  assert.deepEqual((overlay as { destination: { overlay?: unknown } }).destination.overlay, {
    positionType: "BOTTOM_CENTER",
    background: { type: "SOLID_COLOR", color: { r: 0, g: 0, b: 0, a: 0.4 } },
    backgroundInteraction: "CLOSE_ON_CLICK_OUTSIDE",
  });

  assert.deepEqual(
    ((await s.serializeAction(navigate("12:34") as unknown as Action)) as { destination: unknown })
      .destination,
    { status: "missing", id: "12:34" }
  );
  assert.deepEqual(
    ((await s.serializeAction(navigate("66:6") as unknown as Action)) as { destination: unknown })
      .destination,
    { status: "error", id: "66:6", error: "boom 66:6" }
  );
  assert.deepEqual(
    ((await s.serializeAction(navigate(null) as unknown as Action)) as { destination: unknown })
      .destination,
    { status: "none", id: null }
  );
});

test("conditional blocks keep their conditions, else branch and nested actions", async () => {
  const { index } = fixture();
  const s = new PrototypeSerializer(resolverFor(index));
  const [conn] = (await s.scan(index.get("20:3")!)).connections;
  const cond = conn.reactions[0].actions[0] as {
    type: string;
    conditionalBlocks: Array<{
      condition: { value?: { expressionFunction?: string } } | null;
      actions: Array<{ destinationId?: string }>;
    }>;
  };
  assert.equal(cond.type, "CONDITIONAL");
  assert.equal(cond.conditionalBlocks.length, 2);
  assert.equal(cond.conditionalBlocks[0].condition?.value?.expressionFunction, "EQUALS");
  assert.equal(cond.conditionalBlocks[0].actions[0].destinationId, "30:1");
  assert.equal(cond.conditionalBlocks[1].condition, null);
  assert.equal(cond.conditionalBlocks[1].actions[0].destinationId, "10:1");

  const flat = flattenActions(conn.reactions[0].actions, "reactions[0]");
  assert.deepEqual(
    flat.map((f) => [f.actionPath, f.conditional]),
    [
      ["reactions[0].actions[0].conditionalBlocks[0].actions[0]", true],
      ["reactions[0].actions[0].conditionalBlocks[1].actions[0]", true],
    ]
  );
});

test("SET_VARIABLE resolves the variable and unknown action types are preserved, not dropped", async () => {
  const { index } = fixture();
  const s = new PrototypeSerializer(resolverFor(index));
  const set = await s.serializeAction({
    type: "SET_VARIABLE",
    variableId: "VariableID:1",
    variableValue: { type: "BOOLEAN", resolvedType: "BOOLEAN", value: false },
  } as unknown as Action);
  assert.deepEqual((set as { variable: unknown }).variable, {
    id: "VariableID:1",
    name: "isLoggedIn",
    resolvedType: "BOOLEAN",
  });
  assert.deepEqual((set as { variableValue: unknown }).variableValue, {
    type: "BOOLEAN",
    resolvedType: "BOOLEAN",
    value: false,
  });

  const missingVar = await s.serializeAction({
    type: "SET_VARIABLE",
    variableId: "VariableID:2",
  } as unknown as Action);
  assert.deepEqual((missingVar as { variable: unknown }).variable, { status: "missing" });

  const future = await s.serializeAction({ type: "TELEPORT", where: "moon" } as unknown as Action);
  assert.deepEqual(future, {
    type: "TELEPORT",
    unsupported: true,
    raw: { type: "TELEPORT", where: "moon" },
  });
});

test("scan inspects descendants including instance sublayers and reports stats", async () => {
  const { index } = build({
    id: "p",
    type: "PAGE",
    noReactions: true,
    children: [
      {
        id: "s",
        name: "screen",
        children: [
          {
            id: "b",
            name: "button",
            type: "INSTANCE",
            reactions: [{ trigger: click, actions: [{ type: "BACK" }] }],
            children: [
              { id: "Ib;1:1", name: "icon", type: "VECTOR", noReactions: true },
              {
                id: "Ib;1:2",
                name: "hit",
                type: "FRAME",
                reactions: [{ trigger: click, actions: [{ type: "CLOSE" }] }],
              },
            ],
          },
          { id: "broken", throwReactions: "cannot read" },
        ],
      },
    ],
  });
  const result = await new PrototypeSerializer(resolverFor(index)).scan(index.get("s")!);
  assert.deepEqual(
    result.connections.map((c) => [c.nodeId, c.instanceSublayer, c.path.join(" > "), c.screen?.id]),
    [
      ["b", false, "screen > button", "s"],
      ["Ib;1:2", true, "screen > button > hit", "s"],
    ]
  );
  assert.deepEqual(result.stats, {
    nodesScanned: 5,
    nodesWithReactions: 2,
    nodesWithoutReactions: 1,
    unsupportedNodes: 1,
    readErrors: 1,
  });
  assert.deepEqual(result.readErrors, [
    { nodeId: "broken", nodeName: "broken", error: "cannot read" },
  ]);
  assert.equal(result.truncated, false);

  const withEmpty = await new PrototypeSerializer(resolverFor(index)).scan(index.get("s")!, {
    includeEmpty: true,
  });
  assert.ok(withEmpty.connections.some((c) => c.nodeId === "s" && c.reactions.length === 0));

  const limited = await new PrototypeSerializer(resolverFor(index)).scan(index.get("s")!, {
    maxNodes: 2,
  });
  assert.equal(limited.truncated, true);
  assert.equal(limited.stats.nodesScanned, 2);
});

test("traceFlow follows screens breadth-first, marks cycles, skips in-screen scrolls, lists unresolved", async () => {
  const { index } = fixture();
  const resolver = resolverFor(index);
  const trace = await traceFlow(index.get("10:3")!, new PrototypeSerializer(resolver), resolver);

  assert.equal(trace.start.id, "10:1");
  assert.deepEqual(
    trace.screens.map((s) => [s.id, s.depth, s.reachedVia]),
    [
      ["10:1", 0, null],
      ["20:1", 1, "10:3"],
      ["40:1", 1, "I10:4;9:9"],
      ["30:1", 2, "20:3"],
    ]
  );

  const byPath = (sourceId: string) => trace.edges.filter((e) => e.source.id === sourceId);
  assert.equal(byPath("10:3")[0].toScreen?.id, "20:1"); // inner anchor resolves to its screen
  assert.equal(byPath("I10:4;9:9")[0].source.instanceSublayer, true);
  assert.equal(byPath("20:2")[0].kind, "back");
  assert.equal(byPath("20:4")[0].kind, "in-screen");
  assert.equal(byPath("20:4")[0].toScreen, undefined);

  const [toC, toA] = byPath("20:3");
  assert.equal(toC.conditional, true);
  assert.equal(toC.revisit, false);
  assert.equal(toA.condition, null); // else branch
  assert.equal(toA.revisit, true); // cycle back to the start

  assert.equal(byPath("30:1")[0].trigger?.type, "AFTER_TIMEOUT");
  assert.deepEqual(
    trace.unresolved.map((u) => u.destination),
    [{ status: "missing", id: "99:9" }]
  );
  assert.equal(trace.truncated, false);
});

test("traceFlow stops at maxScreens and reports what was left", async () => {
  const { index } = fixture();
  const resolver = resolverFor(index);
  const trace = await traceFlow(index.get("10:1")!, new PrototypeSerializer(resolver), resolver, {
    maxScreens: 1,
  });
  assert.deepEqual(
    trace.screens.map((s) => s.id),
    ["10:1"]
  );
  assert.equal(trace.truncated, true);
  assert.deepEqual(
    trace.pending.map((p) => p.id),
    ["20:1", "40:1"]
  );
});
