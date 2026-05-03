import { bootstrapDatabase } from "./bootstrap.js"
import { openDatabaseConnection } from "./client.js"

async function main() {
  const cwd = process.cwd()
  const sqlite = openDatabaseConnection(cwd)

  try {
    const result = await bootstrapDatabase(cwd, sqlite)
    console.log(`Applied ${result.appliedMigrations.length} migration(s).`)
  } finally {
    sqlite.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
