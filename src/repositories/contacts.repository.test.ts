import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryDriver } from '../database/driver/memory.driver';
import type { SqlDriver } from '../database/driver/types';
import { migrate } from '../database/migrations/runner';
import { seedDatabase } from '../database/seed/seed';
import { createContactsRepository } from './contacts.repository';
import { buildBackup } from '../services/backup/export.service';
import { applyImport, inspectBackup } from '../services/backup/import.service';

describe('contacts', () => {
  let db: SqlDriver;
  let contacts: ReturnType<typeof createContactsRepository>;

  beforeEach(async () => {
    db = await createMemoryDriver();
    await migrate(db);
    await seedDatabase(db);
    contacts = createContactsRepository(db);
  });

  afterEach(async () => {
    await db.close().catch(() => undefined);
  });

  describe('creating and editing', () => {
    it('creates a contact with sensible defaults', async () => {
      const contact = await contacts.create({ name: 'Dr. Silva' });
      expect(contact).toMatchObject({ name: 'Dr. Silva', priority: 3, phone: null });
      expect(contact.id).toMatch(/[0-9a-f-]{36}/);
    });

    it('trims the name and stores a folded copy for search', async () => {
      const contact = await contacts.create({ name: '  José Antônio  ' });
      expect(contact.name).toBe('José Antônio');

      const norm = await db.selectValue<string>('SELECT name_norm FROM contacts WHERE id = ?', [
        contact.id,
      ]);
      expect(norm).toBe('jose antonio');
    });

    it('refuses an empty name', async () => {
      await expect(contacts.create({ name: '   ' })).rejects.toThrow();
    });

    it('applies a partial patch and leaves the rest alone', async () => {
      const created = await contacts.create({
        name: 'Maria',
        phone: '+55 11 90000-0000',
        relationship: 'Vizinha',
      });
      const updated = await contacts.update(created.id, { priority: 1 });

      expect(updated.priority).toBe(1);
      expect(updated.phone).toBe('+55 11 90000-0000');
      expect(updated.relationship).toBe('Vizinha');
    });

    it('keeps the folded name in step with a rename', async () => {
      const created = await contacts.create({ name: 'Ana' });
      await contacts.update(created.id, { name: 'Ângela' });

      const norm = await db.selectValue<string>('SELECT name_norm FROM contacts WHERE id = ?', [
        created.id,
      ]);
      expect(norm).toBe('angela');
    });

    it('can clear an optional field', async () => {
      const created = await contacts.create({ name: 'Ana', phone: '123' });
      expect((await contacts.update(created.id, { phone: null })).phone).toBeNull();
    });

    it('reports a missing contact rather than silently doing nothing', async () => {
      await expect(contacts.update('nope', { priority: 1 })).rejects.toThrow(/no contact/i);
    });
  });

  describe('ordering', () => {
    it('puts the most urgent first, then alphabetical', async () => {
      await contacts.create({ name: 'Zulmira', priority: 1 });
      await contacts.create({ name: 'Alberto', priority: 3 });
      await contacts.create({ name: 'Beatriz', priority: 1 });
      await contacts.create({ name: 'Carlos', priority: 4 });

      // In an emergency the person you need first belongs at the top, not
      // wherever the alphabet puts them.
      expect((await contacts.list()).map((c) => c.name)).toEqual([
        'Beatriz',
        'Zulmira',
        'Alberto',
        'Carlos',
      ]);
    });

    it('orders accented names as a reader would expect', async () => {
      await contacts.create({ name: 'Ãngela' });
      await contacts.create({ name: 'Bruno' });
      expect((await contacts.list()).map((c) => c.name)).toEqual(['Ãngela', 'Bruno']);
    });
  });

  describe('search', () => {
    beforeEach(async () => {
      await contacts.create({
        name: 'José Antônio',
        phone: '+55 11 91234-5678',
        relationship: 'Médico',
      });
      await contacts.create({ name: 'Ana Paula', email: 'ana@example.org' });
    });

    it('finds an accented name typed without accents', async () => {
      expect((await contacts.search('jose')).map((c) => c.name)).toEqual(['José Antônio']);
    });

    it('searches phone numbers', async () => {
      expect((await contacts.search('91234')).map((c) => c.name)).toEqual(['José Antônio']);
    });

    it('searches email addresses', async () => {
      expect((await contacts.search('example.org')).map((c) => c.name)).toEqual(['Ana Paula']);
    });

    it('searches the relationship', async () => {
      expect((await contacts.search('medico')).map((c) => c.name)).toEqual(['José Antônio']);
    });

    it('returns everything for a blank query', async () => {
      expect(await contacts.search('   ')).toHaveLength(2);
    });

    it('treats a wildcard character literally', async () => {
      expect(await contacts.search('%')).toHaveLength(0);
    });
  });

  describe('deleting', () => {
    it('removes the contact', async () => {
      const created = await contacts.create({ name: 'Ana' });
      await contacts.remove(created.id);
      expect(await contacts.count()).toBe(0);
    });

    it('is harmless when the contact is already gone', async () => {
      await expect(contacts.remove('never-existed')).resolves.toBeUndefined();
    });
  });

  describe('backups', () => {
    it('round-trips through a backup', async () => {
      // The contacts table has been in the backup format since the first
      // release, so an older backup restores correctly now the screen exists.
      await contacts.create({
        name: 'Dr. Silva',
        relationship: 'Médico',
        phone: '+55 11 90000-0000',
        email: 'silva@example.org',
        location: 'Clínica Central',
        notes: 'Atende aos sábados',
        priority: 1,
      });

      const file = JSON.stringify(await buildBackup(db));

      const fresh = await createMemoryDriver();
      try {
        await migrate(fresh);
        await seedDatabase(fresh);

        const preview = await inspectBackup(file, fresh);
        expect(preview.ok).toBe(true);
        const result = await applyImport(fresh, preview.payload!, 'replace');
        expect(result.contactsInserted).toBe(1);

        const restored = await createContactsRepository(fresh).list();
        expect(restored[0]).toMatchObject({
          name: 'Dr. Silva',
          relationship: 'Médico',
          phone: '+55 11 90000-0000',
          email: 'silva@example.org',
          location: 'Clínica Central',
          notes: 'Atende aos sábados',
          priority: 1,
        });
      } finally {
        await fresh.close().catch(() => undefined);
      }
    });
  });
});
