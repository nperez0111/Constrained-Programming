import { defs, isDefId, names, type DefId, type FunctionDef } from "./db";
import vm, { type RunningCodeInNewContextOptions } from "vm";

type ExecutionContext = {
  id: DefId;
  def: FunctionDef;
  tree: Record<DefId, ExecutionContext>;
};

// Consider using a library like `isolated-vm` for this
function safeEval(
  code: string,
  context: Record<string, any>,
  opts = { eval: true }
) {
  const resultKey = "SAFE_EVAL_" + Math.floor(Math.random() * 1000000);

  const codeToExecute = `
    (function() {
      Function = undefined;
      const keys = Object.getOwnPropertyNames(this).concat(['constructor']);
      keys.forEach((key) => {
        const item = this[key];
        if (!item || typeof item.constructor !== 'function') return;
        this[key].constructor = undefined;
      });
    })();

    module = {};
    module.exports = {};

    ${code}

    
    ${opts?.eval ? resultKey + "= module.exports(args)" : ""}
  `;

  console.log("executing", code);
  vm.runInNewContext(codeToExecute, context);

  return opts?.eval ? context[resultKey] : context["module"].exports;
}

export function assertArguments(
  def: FunctionDef,
  args: FunctionDef["arguments"]
): void {
  if (
    Object.keys(args || {}).length !== Object.keys(def.arguments || {}).length
  ) {
    throw new Error(
      `Expected ${Object.keys(def.arguments || {}).length} arguments, got ${
        Object.keys(args || {}).length
      }`
    );
  }
  if (args) {
    Object.keys(args).forEach((key) => {
      if (!def.arguments) {
        throw new Error(`Expected no arguments, got ${key}`);
      }
      if (typeof args[key] !== def.arguments[key]) {
        throw new Error(
          `Expected arguments[${key}] to be of type ${
            def.arguments[key]
          }, but got ${typeof args[key]}`
        );
      }
    });
  }
}

export function assertOutput(def: FunctionDef, output: unknown): void {
  if (typeof output !== def.outputType) {
    throw new Error(
      `Expected output to be of type ${
        def.outputType
      }, but got ${typeof output}`
    );
  }
}

export function execute(
  context: ExecutionContext,
  args?: FunctionDef["arguments"],
  options?: { runtimeTypeChecks: boolean; eval?: boolean }
): unknown {
  const availableFunctions = Object.fromEntries(
    Object.entries(context.def.requires).map(([name, id]) => {
      return [
        name,
        (childArgs: FunctionDef["arguments"]) => {
          if (options?.runtimeTypeChecks) {
            assertArguments(context.tree[id].def, childArgs);
          }

          // Actually execute the function
          const output = execute(context.tree[id], childArgs, options);

          if (options?.runtimeTypeChecks) {
            assertOutput(context.tree[id].def, output);
          }
          return output;
        },
      ];
    })
  );

  return safeEval(
    context.def.implementation,
    {
      ...availableFunctions,
      // For some reason, the safeEval does not allow using the `import` keyword, so we using a require function as the dynamic import instead
      async require(name: string) {
        return execute(
          await resolveExecutionContext(await resolveNameToId(name)),
          undefined,
          {
            eval: false,
            runtimeTypeChecks: options?.runtimeTypeChecks || false,
          }
        );
      },
      args,
    },
    { eval: options?.eval ?? true }
  );
}

// TODO cycle detection
export async function resolveExecutionContext(
  id: DefId
): Promise<ExecutionContext> {
  const def = await defs.get(id);
  if (!def) {
    throw new Error(`Def not found: ${id}`);
  }
  if (def.type === "functionDef") {
    const tree: Record<DefId, ExecutionContext> = Object.fromEntries(
      await Promise.all(
        Object.values(def.requires).map(async (id) => [
          id,
          await resolveExecutionContext(id),
        ])
      )
    );

    return {
      id,
      def,
      tree,
    };
  }

  throw new Error(`Def is not a function: ${id}`);
}

export async function resolveNameToId(name: string): Promise<DefId> {
  if (isDefId(name)) {
    return name;
  }
  const id = await names.get(name);
  if (!id) {
    throw new Error(`Def not found: ${name}`);
  }
  return id;
}
