import { createDatabase } from "db0";
import { createStorage, prefixStorage, type Storage } from "unstorage";
import dbDriver from "unstorage/drivers/db0";
import bunSqlite from "db0/connectors/bun-sqlite";
import { objectHash, sha256base64 } from "ohash";
import { resolveCode } from "./resolve-code";

const database = createDatabase(
  bunSqlite({
    name: "unstore.db",
  })
);

export const storage = createStorage({
  driver: dbDriver({
    database,
    tableName: "unstore",
  }),
});
export type DefId = `defs_${string}`;
export type ModuleId = `modules_${string}`;

export interface FunctionDef {
  type: "functionDef";
  /**
   * The function's arguments' types
   */
  arguments?: Record<string, unknown>;
  /**
   * The function's output type
   */
  outputType: string;
  /**
   * The function's jsdoc, technical description of the function
   */
  jsdoc?: string;
  /**
   * The function's actual implementation
   */
  implementation: string;
  /**
   * A function may require other functions to be defined before it can be executed
   * Represented as a map of the required function name to it's DefId
   */
  requires: Record<string, DefId>;
  /**
   * A function may have a name, but can also just be referenced by it's DefId
   */
  name?: string;
  /**
   * A function may have meta data
   */
  meta?: {
    /**
     * The time the function was created in Unix time
     */
    createdAt: number;
  };
}

// TODO do we need modules?
export interface ModuleDef {
  type: "moduleDef";
  /**
   * Maps a named export to a def id
   */
  exports: Record<string, DefId>;
  implementation: string;
  requires: string[];
}

storage.mount(
  "defs",
  dbDriver({
    database,
    tableName: "defs",
  })
);
export const defs = prefixStorage<FunctionDef>(
  storage as Storage<FunctionDef>,
  "defs_"
);
export const names = prefixStorage<DefId>(storage as Storage<DefId>, "names_");

export async function createFn({
  implementation,
  arguments: args,
  outputType,
  meta,
}: Omit<FunctionDef, "type" | "requires" | "jsdoc" | "name">): Promise<DefId> {
  const { code, imports, jsdoc, defaultExportName } =
    resolveCode(implementation);
  const id: DefId = `defs_${sha256base64(
    objectHash({
      code,
      arguments: args,
      jsdoc,
      outputType,
    })
  )}`;

  await defs.set(id, {
    implementation: code,
    arguments: args,
    jsdoc,
    outputType,
    requires: imports,
    type: "functionDef",
    name: defaultExportName || undefined,
    meta,
  });

  if (defaultExportName) {
    await names.set(defaultExportName, id);
  }

  return id;
}

export function isDefId(id: string): id is DefId {
  return id.startsWith("defs_");
}
