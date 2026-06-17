import { MigrationEntry, SchemaType } from '../migrate';

/** Migration definitions for each schema type. */
const migrations: Record<SchemaType, MigrationEntry[]> = {};

export function getMigrations(schema: SchemaType): MigrationEntry[] {
  return migrations[schema] ?? [];
}
