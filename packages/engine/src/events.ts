/**
 * VERA Event System
 *
 * Collects events emitted during transaction execution.
 */

import type { Value } from './vm/value.js';

// ============================================================================
// Event Types
// ============================================================================

/**
 * An emitted event
 */
export interface EmittedEvent {
    /** Event name */
    name: string;
    /** Event data */
    data: Value;
    /** Emission order */
    index: number;
}

/**
 * Event collector interface
 */
export interface EventCollector {
    emit(name: string, data: Value): void;
    getEvents(): readonly EmittedEvent[];
    clear(): void;
}

// ============================================================================
// Event Emitter
// ============================================================================

/**
 * Collects events during execution
 */
export class EventEmitter implements EventCollector {
    private events: EmittedEvent[] = [];

    /**
     * Emits an event
     */
    emit(name: string, data: Value): void {
        this.events.push({
            name,
            data,
            index: this.events.length,
        });
    }

    /**
     * Gets all emitted events
     */
    getEvents(): readonly EmittedEvent[] {
        return this.events;
    }

    /**
     * Gets events by name
     */
    getEventsByName(name: string): readonly EmittedEvent[] {
        return this.events.filter(e => e.name === name);
    }

    /**
     * Gets the count of events
     */
    get count(): number {
        return this.events.length;
    }

    /**
     * Clears all events
     */
    clear(): void {
        this.events = [];
    }
}

/**
 * Creates a new event emitter
 */
export function createEventEmitter(): EventEmitter {
    return new EventEmitter();
}
