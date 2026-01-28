import { bytesToHex } from '@vera/core';

export interface MetricSample {
    timestamp: number;
    value: number;
}

export interface NodeMetrics {
    id: string;
    status: 'ok' | 'syncing' | 'dead' | 'behind';
    blockHeight: number;
    stateRoot: string;
    memoryRss: number;
    latencyP99: number;
}

export interface AttackStats {
    total: number;
    rejected: number;
    failed: number;
}

export class MetricsAggregator {
    private startTime: number = Date.now();
    private throughputSamples: MetricSample[] = [];
    private memorySamples: Map<string, MetricSample[]> = new Map();
    private latencySamples: number[] = [];

    public attacks: Record<string, AttackStats> = {
        byzantine_flood: { total: 0, rejected: 0, failed: 0 },
        signature_forgery: { total: 0, rejected: 0, failed: 0 },
        replay_attack: { total: 0, rejected: 0, failed: 0 },
        state_tampering: { total: 0, rejected: 0, failed: 0 },
        nonce_manipulation: { total: 0, rejected: 0, failed: 0 },
        double_spend: { total: 0, rejected: 0, failed: 0 },
        malformed_payload: { total: 0, rejected: 0, failed: 0 },
    };

    public nodes: Map<string, NodeMetrics> = new Map();
    public discoveredIssues: { timestamp: number, message: string, severity: 'warn' | 'error' }[] = [];

    recordThroughput(txCount: number): void {
        this.throughputSamples.push({ timestamp: Date.now(), value: txCount });
    }

    recordLatency(ms: number): void {
        this.latencySamples.push(ms);
        if (this.latencySamples.length > 1000) this.latencySamples.shift();
    }

    recordMemory(nodeId: string, rss: number): void {
        const samples = this.memorySamples.get(nodeId) || [];
        samples.push({ timestamp: Date.now(), value: rss });
        this.memorySamples.set(nodeId, samples);
    }

    recordAttack(type: string, success: boolean): void {
        if (!this.attacks[type]) {
            this.attacks[type] = { total: 0, rejected: 0, failed: 0 };
        }
        this.attacks[type].total++;
        if (success) {
            this.attacks[type].failed++; // Attack succeeded = VERA failed
        } else {
            this.attacks[type].rejected++;
        }
    }

    addIssue(message: string, severity: 'warn' | 'error' = 'warn'): void {
        this.discoveredIssues.push({ timestamp: Date.now(), message, severity });
    }

    getSummary() {
        const duration = (Date.now() - this.startTime) / 1000;
        const totalTx = this.throughputSamples.reduce((acc, s) => acc + s.value, 0);
        const avgThroughput = totalTx / (duration || 1);

        const sortedLatency = [...this.latencySamples].sort((a, b) => a - b);
        const p99 = sortedLatency[Math.floor(sortedLatency.length * 0.99)] || 0;

        const peakThroughput = Math.max(...this.throughputSamples.map(s => s.value), 0);

        return {
            duration,
            totalTx,
            avgThroughput,
            peakThroughput,
            p99Latency: p99,
            attacks: this.attacks,
            issues: this.discoveredIssues,
            nodes: Array.from(this.nodes.values()),
        };
    }

    getThroughputWindow(seconds: number = 5): number {
        const now = Date.now();
        const window = this.throughputSamples.filter(s => now - s.timestamp < seconds * 1000);
        const total = window.reduce((acc, s) => acc + s.value, 0);
        return total / (seconds || 1);
    }
}
