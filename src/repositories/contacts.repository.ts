/**
 * Emergency contact persistence.
 *
 * The `contacts` table has existed since the initial schema, and backups have
 * always carried it - `export.service.ts` writes it and `import.service.ts`
 * restores it. This repository and its screen are the last missing piece of a
 * feature that was otherwise wired end to end, which is why an existing backup
 * taken before this change will restore contacts correctly once they exist.
 *
 * Ordered by priority, then by folded name. In an emergency the person you need
 * first should be at the top, not wherever the alphabet puts them.
 */
import type { SqlDriver, SqlRow, SqlValue } from '../database/driver/types';
import { nowInstant } from '../domain/dates';
import { foldText } from '../domain/normalize';
import type { Contact, Priority } from '../types/domain';

export interface CreateContactInput {
  readonly id?: string | undefined;
  readonly name: string;
  readonly relationship?: string | null | undefined;
  readonly phone?: string | null | undefined;
  readonly email?: string | null | undefined;
  readonly location?: string | null | undefined;
  readonly notes?: string | null | undefined;
  readonly priority?: Priority | undefined;
}

export type UpdateContactInput = Partial<Omit<CreateContactInput, 'id'>>;

function mapContact(row: SqlRow): Contact {
  return {
    id: String(row.id),
    name: String(row.name),
    relationship: row.relationship === null ? null : String(row.relationship),
    phone: row.phone === null ? null : String(row.phone),
    email: row.email === null ? null : String(row.email),
    location: row.location === null ? null : String(row.location),
    notes: row.notes === null ? null : String(row.notes),
    priority: Number(row.priority) as Priority,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function createContactsRepository(db: SqlDriver) {
  async function requireById(id: string): Promise<Contact> {
    const row = await db.selectOne<SqlRow>('SELECT * FROM contacts WHERE id = :id', { id });
    if (row === undefined) throw new Error(`No contact with id "${id}".`);
    return mapContact(row);
  }

  return {
    async list(): Promise<Contact[]> {
      const rows = await db.select<SqlRow>(
        'SELECT * FROM contacts ORDER BY priority, name_norm, id',
      );
      return rows.map(mapContact);
    },

    async getById(id: string): Promise<Contact | undefined> {
      const row = await db.selectOne<SqlRow>('SELECT * FROM contacts WHERE id = :id', { id });
      return row === undefined ? undefined : mapContact(row);
    },

    /**
     * Accent- and case-insensitive across every field, matching the promise the
     * rest of the application makes.
     *
     * Filtered in memory rather than in SQL, deliberately. Only `name` has a
     * folded `name_norm` column; the others would have to be matched with
     * `LOWER()`, which in SQLite lowercases ASCII and does not touch accents at
     * all - so searching "medico" would silently miss a contact whose
     * relationship is "Médico". Rather than add four more `_norm` columns and a
     * migration for a list that holds tens of rows, the same `foldText` used
     * everywhere else is applied here.
     */
    async search(query: string): Promise<Contact[]> {
      const term = foldText(query);
      const all = await this.list();
      if (term === '') return all;

      return all.filter((contact) =>
        [
          contact.name,
          contact.relationship,
          contact.phone,
          contact.email,
          contact.location,
          contact.notes,
        ].some((field) => field !== null && foldText(field).includes(term)),
      );
    },

    async create(input: CreateContactInput): Promise<Contact> {
      const name = input.name.trim();
      if (name === '') throw new Error('A contact needs a name.');

      const id = input.id ?? crypto.randomUUID();
      const now = nowInstant();

      await db.exec(
        `INSERT INTO contacts
           (id, name, name_norm, relationship, phone, email, location, notes, priority, created_at, updated_at)
         VALUES (:id, :name, :norm, :relationship, :phone, :email, :location, :notes, :priority, :now, :now)`,
        {
          id,
          name,
          norm: foldText(name),
          relationship: input.relationship ?? null,
          phone: input.phone ?? null,
          email: input.email ?? null,
          location: input.location ?? null,
          notes: input.notes ?? null,
          priority: input.priority ?? 3,
          now,
        },
      );

      return requireById(id);
    },

    async update(id: string, patch: UpdateContactInput): Promise<Contact> {
      const columnByField: Record<string, string> = {
        relationship: 'relationship',
        phone: 'phone',
        email: 'email',
        location: 'location',
        notes: 'notes',
        priority: 'priority',
      };

      const assignments: string[] = ['updated_at = :updated_at'];
      const params: Record<string, SqlValue> = { id, updated_at: nowInstant() };

      if (patch.name !== undefined) {
        const name = patch.name.trim();
        if (name === '') throw new Error('A contact needs a name.');
        params.name = name;
        params.name_norm = foldText(name);
        assignments.push('name = :name', 'name_norm = :name_norm');
      }

      for (const [field, column] of Object.entries(columnByField)) {
        if (!(field in patch)) continue;
        params[column] = (patch as Record<string, SqlValue>)[field] as SqlValue;
        assignments.push(`${column} = :${column}`);
      }

      const result = await db.exec(
        `UPDATE contacts SET ${assignments.join(', ')} WHERE id = :id`,
        params,
      );
      if (result.rowsAffected === 0) throw new Error(`No contact with id "${id}".`);
      return requireById(id);
    },

    /**
     * Deletes a contact.
     *
     * Nothing references a contact, so unlike categories and locations there is
     * nothing to orphan and no reason to refuse. The interface still confirms.
     */
    async remove(id: string): Promise<void> {
      await db.exec('DELETE FROM contacts WHERE id = :id', { id });
    },

    async count(): Promise<number> {
      return Number((await db.selectValue<number>('SELECT count(*) FROM contacts')) ?? 0);
    },
  };
}

export type ContactsRepository = ReturnType<typeof createContactsRepository>;
