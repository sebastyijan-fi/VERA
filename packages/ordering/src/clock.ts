/**
 * VERA Clock Abstraction
 *
 * Provides a deterministic time source for the system.
 */

/**
 * Interface for getting the current time
 */
export interface Clock {
    /**
     * Returns the current timestamp in milliseconds (Unix epoch)
     */
    now(): number;
}

/**
 * System clock using Date.now()
 */
export class SystemClock implements Clock {
    now(): number {
        return Date.now();
    }
}

/**
 * Fixed clock for deterministic testing
 */
export class FixedClock implements Clock {
    private currentTime: number;

    constructor(initialTime: number) {
        this.currentTime = initialTime;
    }

    now(): number {
        return this.currentTime;
    }

    /**
     * Advances the clock by the specified milliseconds
     */
    advance(ms: number): void {
        this.currentTime += ms;
    }

    /**
     * Sets the clock to a specific time
     */
    set(time: number): void {
        this.currentTime = time;
    }
}
