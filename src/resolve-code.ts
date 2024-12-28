import { parseModule, generateCode } from "magicast";
import * as recast from "recast";
import { isDefId, type DefId } from "./db";

/**
 * Maps a local variable to a module import
 */
type ImportMap = Record<string, DefId>;
const builders = recast.types.builders;

function replaceDynamicImportWithRequire(
  mod: ReturnType<typeof parseModule>
): void {
  recast.visit(mod.$ast, {
    visitImport(path) {
      const node = path.parent.value;
      if (node.type === "CallExpression" && node.callee.type === "Import") {
        path.parentPath.replace(
          builders.callExpression(builders.identifier("require"), [
            builders.literal(node.arguments[0].value as string),
          ])
        );
      }
      return false;
    },
  });
}

/**
 * This will extract all import statements from the code and rewrite to use module.exports for the default export
 */
export function resolveCode(
  code: string,
  options = { strict: false }
): {
  /**
   * A mapping of a local variable to a module import (DefId)
   */
  imports: ImportMap;
  /**
   * The code with the imports resolved and rewritten to use module.exports
   */
  code: string;
  /**
   * The JSDoc comment for the default export
   */
  jsdoc: string | undefined;
  /**
   * The name of the function's default export
   */
  defaultExportName: string | false;
} {
  const mod = parseModule(code);
  const program = mod.$ast;
  if (program.type !== "Program") {
    throw new Error("Expected input to be a program");
  }
  const imports: ImportMap = {};
  let defaultExportName: string | null | false = null;
  let jsdoc: string | undefined = undefined;

  program.body = program.body
    .map((n) => {
      if (n.type === "ImportDeclaration") {
        for (const specifier of n.specifiers) {
          const resolvedId = n.source.value as DefId;

          if (options.strict && !isDefId(resolvedId)) {
            throw new Error(`Expected ${resolvedId} to be a def id`);
          }

          imports[specifier.local.name] = resolvedId;
        }
        return null;
      }
      if (n.type === "ExportDefaultDeclaration") {
        if (n.declaration.type === "FunctionDeclaration") {
          jsdoc = n.leadingComments?.map((c) => c.value).join("\n");
          defaultExportName = n.declaration.id?.name ?? false;

          const x = builders.expressionStatement(
            builders.assignmentExpression(
              "=",
              builders.memberExpression(
                builders.identifier("module"),
                builders.identifier("exports")
              ),
              builders.functionExpression.from({
                body: n.declaration.body as any,
                params: n.declaration.params as any,
                async: n.declaration.async,
                generator: n.declaration.generator,
                id: n.declaration.id as any,
              })
            )
          );

          return x as any as typeof n;
        } else {
          throw new Error(
            `Expected function declaration, got ${n.declaration.type}`
          );
        }
      }
      return n;
    })
    .filter((n) => n !== null);

  if (defaultExportName === null) {
    throw new Error("Expected a default export");
  }

  replaceDynamicImportWithRequire(mod);

  return { imports, code: generateCode(mod).code, jsdoc, defaultExportName };
}
