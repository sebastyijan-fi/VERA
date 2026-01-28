import { describe, it, expect } from 'vitest';
import * as RPC from '../src/index.js';

describe('RPC Package', () => {
    it('should export modules', () => {
        expect(RPC).toBeDefined();
    });
});
