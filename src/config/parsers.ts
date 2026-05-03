import { parse as parseJsonc } from "jsonc-parser"
import { parse as parseToml } from "smol-toml"
import YAML from "yaml"

export function parseYamlConfig(source: string) {
  return YAML.parse(source)
}

export function stringifyYamlConfig(value: unknown) {
  return YAML.stringify(value)
}

export function parseJsoncConfig<T>(source: string) {
  return parseJsonc(source) as T
}

export function parseTomlConfig<T>(source: string) {
  return parseToml(source) as T
}
