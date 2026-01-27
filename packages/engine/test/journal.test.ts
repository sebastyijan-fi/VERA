
import { describe, it, expect } from 'vitest';
import { StateJournal } from '../src/state/journal.js';
import { stringValue, intValue } from '../src/vm/value.js';

describe('StateJournal', () => {
    const ACCOUNT = 'account';
    const CONTRACT = 'contract';

    it('should track read sets on get', async () => {
        const journal = new StateJournal();
        const key = stringValue('alice');

        await journal.get(ACCOUNT, key);

        const { reads, writes } = journal.getAccessSet();
        expect(reads.size).toBe(1);
        expect(writes.size).toBe(0);
        expect(reads.has(`${ACCOUNT}:"alice"`)).toBe(true);
    });

    it('should track read sets on exists', async () => {
        const journal = new StateJournal();
        const key = stringValue('bob');

        await journal.exists(ACCOUNT, key);

        const { reads } = journal.getAccessSet();
        expect(reads.has(`${ACCOUNT}:"bob"`)).toBe(true);
    });

    it('should track write sets on set', async () => {
        const journal = new StateJournal();
        const key = stringValue('charlie');
        const value = intValue(100n);

        await journal.set(ACCOUNT, key, value);

        const { reads, writes } = journal.getAccessSet();
        expect(writes.size).toBe(1);
        expect(writes.has(`${ACCOUNT}:"charlie"`)).toBe(true);
        expect(reads.size).toBe(0); // Set does not imply read
    });

    it('should track write sets on delete', async () => {
        const journal = new StateJournal();
        const key = stringValue('dave');

        await journal.delete(ACCOUNT, key);

        const { writes } = journal.getAccessSet();
        expect(writes.has(`${ACCOUNT}:"dave"`)).toBe(true);
    });

    it('should clear sets on commit', async () => {
        const journal = new StateJournal();
        await journal.get(ACCOUNT, stringValue('read'));
        await journal.set(ACCOUNT, stringValue('write'), intValue(1n));

        expect(journal.getAccessSet().reads.size).toBe(1);
        expect(journal.getAccessSet().writes.size).toBe(1);

        journal.commit();

        const { reads, writes } = journal.getAccessSet();
        expect(reads.size).toBe(0);
        expect(writes.size).toBe(0);
    });

    it('should clear sets on rollback', async () => {
        const journal = new StateJournal();
        await journal.get(ACCOUNT, stringValue('read'));
        await journal.set(ACCOUNT, stringValue('write'), intValue(1n));

        journal.rollback();

        const { reads, writes } = journal.getAccessSet();
        expect(reads.size).toBe(0);
        expect(writes.size).toBe(0);
    });

    it('should track multiple entity types and keys', async () => {
        const journal = new StateJournal();
        await journal.get(ACCOUNT, stringValue('a'));
        await journal.get(CONTRACT, stringValue('b'));
        await journal.set(ACCOUNT, stringValue('c'), intValue(1n));

        const { reads, writes } = journal.getAccessSet();
        expect(reads.has(`${ACCOUNT}:"a"`)).toBe(true);
        expect(reads.has(`${CONTRACT}:"b"`)).toBe(true);
        expect(writes.has(`${ACCOUNT}:"c"`)).toBe(true);
    });
});
