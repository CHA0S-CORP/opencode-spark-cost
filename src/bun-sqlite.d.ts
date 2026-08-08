// Ambient declaration for the built-in bun:sqlite module. Kept minimal so the
// package typechecks without @types/bun. The runtime import is dynamic and
// guarded, so this only needs to cover what the plugin uses.
declare module "bun:sqlite" {
  export class Database {
    constructor(path: string, opts?: { readonly?: boolean })
    query(sql: string): { get(): unknown }
    close(): void
  }
}
