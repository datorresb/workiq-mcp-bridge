declare module "tree-kill" {
  /**
   * Kill a process tree by root PID. On Windows this delegates to
   * `taskkill /pid <pid> /T /F`.
   */
  function treeKill(
    pid: number,
    signal?: string | number,
    callback?: (error?: Error) => void
  ): void;
  export = treeKill;
}
