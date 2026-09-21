/**
 * Helpers every extension area shares: parameter reading, the error wording of
 * a failed write, and the two phases of a batch tool.
 *
 * The batch conventions these implement are repo-wide (CLAUDE.md §6.7 to §6.9):
 * a batch examines all items before the first write, a validation failure
 * writes nothing and reports every bad item, and a write failure afterwards
 * stops the batch and reports what was not reached. Keeping them here lets an
 * area file follow them without importing another area.
 */

/** The most items one batch call accepts. */
export const MAX_BATCH_ITEMS = 200;

/**
 * Reads a required non-empty string parameter.
 * @param params - The request params.
 * @param key - The parameter name.
 * @param tool - The tool name, for the error message.
 * @returns The parameter value.
 */
export const readRequiredString = (
  params: Record<string, unknown>,
  key: string,
  tool: string
): string => {
  const value = params[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(
      `${tool} requires ${key} as a non-empty string, received ${describeValue(value)}. Pass ${key} and call it again.`
    );
  }
  return value;
};

/**
 * Names the type of a value for an error message.
 * @param raw - The value.
 * @returns A phrase such as "a string".
 */
export const describeValue = (raw: unknown): string => {
  if (raw === null) return "null";
  if (Array.isArray(raw)) return raw.length === 0 ? "an empty array" : "an array";
  return `a ${typeof raw}`;
};

/**
 * Reads the message of a thrown value.
 * @param err - The thrown value.
 * @returns The message.
 */
export const messageOf = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/**
 * Rewrites a failure from a Figma write so the message carries a correction,
 * and names the plan limit when Figma rejected the call because of one.
 * @param err - The error Figma threw.
 * @returns The sentence to report.
 */
export const describeWriteFailure = (err: unknown): string => {
  const message = messageOf(err);
  if (/\b(limit|plan|upgrade|professional|organization|enterprise|subscri\w*)\b/i.test(message)) {
    return `${message}. Figma refused this because of a plan limit: a Starter plan gives a variable collection one mode and offers no extended collections. Upgrading the file's plan lifts the limit; otherwise keep the call within the collection's default mode.`;
  }
  return `${message}.`;
};

/**
 * Wraps a failed Figma write in an error that names what the handler was doing.
 * @param action - What the handler was doing, phrased for a message.
 * @param err - The error Figma threw.
 * @returns The error to throw on.
 */
export const describeWriteError = (action: string, err: unknown): Error =>
  new Error(`${action}: ${describeWriteFailure(err)}`);

/**
 * Builds the single error a failed validation pass returns.
 * @param tool - The tool name.
 * @param problems - One line per bad item.
 * @returns The error to throw.
 */
export const validationError = (tool: string, problems: readonly string[]): Error =>
  new Error(
    `${tool} wrote nothing. Correct these items and call it again:\n${problems.join("\n")}`
  );

/**
 * Reads the array parameter of a batch tool and checks its size.
 * @param params - The request params.
 * @param key - The parameter name.
 * @param tool - The tool name, for the error message.
 * @returns The raw items, still unexamined.
 */
export const readBatchArray = (
  params: Record<string, unknown>,
  key: string,
  tool: string
): unknown[] => {
  const raw = params[key];
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(
      `${tool} requires ${key} as an array of 1 to ${MAX_BATCH_ITEMS} items, received ${describeValue(raw)}. Pass at least one item.`
    );
  }
  if (raw.length > MAX_BATCH_ITEMS) {
    throw new Error(
      `${tool} accepts at most ${MAX_BATCH_ITEMS} items per call, received ${raw.length}. Split the batch.`
    );
  }
  return raw;
};

/** One entry of the `results` array a batch tool returns. */
export type BatchResult = Record<string, unknown> & { index: number; ok: boolean };

/**
 * Runs the write phase of a batch.
 *
 * Validation has already passed here, so a failure is Figma refusing a write.
 * The call stops at that item: the items before it keep their result, the
 * failed item carries the cause, and every item after it reports that nothing
 * was written for it.
 * @param plans - The validated items, one per input item and in input order.
 * @param write - Writes one item and returns the fields of its result.
 * @returns One result entry per item.
 */
export const runBatchWrites = async <TPlan>(
  plans: readonly TPlan[],
  write: (plan: TPlan) => Promise<Record<string, unknown>>
): Promise<{ results: BatchResult[] }> => {
  const results: BatchResult[] = [];
  for (let index = 0; index < plans.length; index++) {
    try {
      results.push({ index, ok: true, ...(await write(plans[index])) });
    } catch (err) {
      results.push({ index, ok: false, error: describeWriteFailure(err) });
      for (let rest = index + 1; rest < plans.length; rest++) {
        results.push({ index: rest, ok: false, error: "not written" });
      }
      break;
    }
  }
  return { results };
};
