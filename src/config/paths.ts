import path from "node:path"

export const XIEZHI_DIRNAME = ".xiezhi"
export const CONFIG_FILENAME = "config.yaml"
export const DATABASE_FILENAME = "xiezhi.db"

export function getXieZhiDir(cwd: string) {
  return path.join(cwd, XIEZHI_DIRNAME)
}

export function getConfigPath(cwd: string) {
  return path.join(getXieZhiDir(cwd), CONFIG_FILENAME)
}

export function getDatabasePath(cwd: string) {
  return path.join(getXieZhiDir(cwd), DATABASE_FILENAME)
}
