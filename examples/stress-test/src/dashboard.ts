import pc from 'picocolors';
import { MetricsAggregator } from './metrics.js';
import { TestPhase } from './orchestrator.js';

export class Dashboard {
    constructor(
        private readonly metrics: MetricsAggregator,
        private readonly getPhase: () => TestPhase,
        private readonly getTxRate: () => number
    ) { }

    render() {
        const stats = this.metrics.getSummary();
        const duration = Math.floor(stats.duration);
        const mm = String(Math.floor(duration / 60)).padStart(2, '0');
        const ss = String(duration % 60).padStart(2, '0');

        console.clear();
        process.stdout.write('\x1b[H'); // Move cursor to top

        console.log(pc.bold('╔══════════════════════════════════════════════════════════════════╗'));
        console.log(pc.bold(`║  VERA STRESS TEST                        [${mm}:${ss}] PHASE: ${this.getPhase()} `).padEnd(68) + '║');
        console.log(pc.bold('╠══════════════════════════════════════════════════════════════════╣'));
        console.log(pc.bold('║  NODES          STATE ROOT          BLOCK    STATUS              ║'));

        for (const node of stats.nodes) {
            const statusColor = node.status === 'ok' ? pc.green('●') : node.status === 'dead' ? pc.red('○') : pc.yellow('◐');
            const root = node.stateRoot.slice(0, 10) + '...';
            const height = String(node.blockHeight).padEnd(8);
            const statusText = node.status.toUpperCase().padEnd(19);
            console.log(`║  ${statusColor} ${node.id.padEnd(14)} ${pc.dim(root)}       ${height} ${statusText} ║`);
        }

        console.log(pc.bold('╠══════════════════════════════════════════════════════════════════╣'));
        const throughput = this.metrics.getThroughputWindow();
        const peak = stats.peakThroughput;
        const barWidth = 20;
        const filled = Math.min(barWidth, Math.floor((throughput / 2000) * barWidth));
        const bar = '▓'.repeat(filled) + '░'.repeat(barWidth - filled);

        console.log(`║  THROUGHPUT        [${pc.cyan(bar)}] ${Math.round(throughput).toLocaleString()}/sec (peak: ${Math.round(peak).toLocaleString()})`.padEnd(86) + pc.bold('║'));
        console.log(`║  MEMORY            PEAK: ${Math.round(Math.max(...stats.nodes.map(n => n.memoryRss)) / 1024 / 1024)}MB `.padEnd(67) + pc.bold('║'));

        console.log(pc.bold('╠══════════════════════════════════════════════════════════════════╣'));
        console.log(pc.bold('║  ATTACK SURFACE                                                  ║'));

        for (const [type, atk] of Object.entries(stats.attacks)) {
            const name = type.replace(/_/g, ' ').padEnd(18);
            const status = atk.failed > 0 ? pc.red('✗ FAILURE') : pc.green('✓ REJECTED');
            console.log(`║  ${name}  ${String(atk.rejected).padStart(2)}/${String(atk.total).padEnd(2)} ${status} `.padEnd(67) + pc.bold('║'));
        }

        console.log(pc.bold('╠══════════════════════════════════════════════════════════════════╣'));
        console.log(pc.bold('║  LATEST ISSUES                                                   ║'));
        const issues = stats.issues.slice(-3);
        for (const issue of issues) {
            const color = issue.severity === 'error' ? pc.red : pc.yellow;
            console.log(`║  ${color('!')} ${issue.message.slice(0, 60).padEnd(63)} ║`);
        }
        if (issues.length === 0) console.log('║  (None)                                                          ║');

        console.log(pc.bold('╚══════════════════════════════════════════════════════════════════╝'));
    }
}
