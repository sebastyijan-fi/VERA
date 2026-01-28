import { Command } from 'commander';
import { Orchestrator } from './orchestrator.js';
import { MetricsAggregator } from './metrics.js';
import { Dashboard } from './dashboard.js';
import fs from 'node:fs/promises';
import pc from 'picocolors';

const program = new Command();

program
    .name('vera-stress-test')
    .description('Adversarial stress test for VERA')
    .version('0.1.0')
    .option('--nodes <number>', 'Number of nodes', '3')
    .option('--duration <seconds>', 'Test duration (0 for infinite)', '300')
    .option('--intensity <1-10>', 'Chaos intensity', '3')
    .option('--data <path>', 'Data directory', './stress-data')
    .option('--quiet', 'Disable dashboard', false)
    .parse(process.argv);

const options = program.opts();

async function main() {
    const metrics = new MetricsAggregator();
    const orchestrator = new Orchestrator({
        nodeCount: parseInt(options.nodes),
        duration: parseInt(options.duration),
        intensity: parseInt(options.intensity),
        dataDir: options.data
    }, metrics);

    const dashboard = new Dashboard(
        metrics,
        () => orchestrator.getPhase(),
        () => orchestrator.getTxRate()
    );

    console.log(pc.cyan('Initializing VERA Stress Test...'));
    await orchestrator.init();

    await orchestrator.start();

    const renderInterval = setInterval(() => {
        if (!options.quiet) {
            dashboard.render();
        }
    }, 1000);

    const shutdown = async () => {
        clearInterval(renderInterval);
        console.log(pc.yellow('\nGenerating report and shutting down...'));

        const report = metrics.getSummary(); // Get metrics while nodes are still alive
        const executedCount = orchestrator.getExecutedCount();
        await orchestrator.stop();

        const verdict = calculateVerdict(report, executedCount);

        await fs.mkdir('./reports', { recursive: true });
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const reportPath = `./reports/stress-${timestamp}.json`;
        await fs.writeFile(reportPath, JSON.stringify({
            ...report,
            executedTx: executedCount,
            executedThroughput: executedCount / report.duration,
            verdict
        }, null, 2));

        console.log(pc.bold('╔══════════════════════════════════════════════════════════════════╗'));
        console.log(pc.bold('║  VERA STRESS TEST REPORT                                         ║'));
        console.log(pc.bold('╠══════════════════════════════════════════════════════════════════╣'));
        console.log(`║  Verdict:      ${verdict === 'PASS' ? pc.green('PASS') : verdict === 'PARTIAL' ? pc.yellow('PARTIAL') : pc.red('FAIL')} `.padEnd(76) + pc.bold('║'));
        console.log(`║  Executed TX:  ${executedCount.toLocaleString()} in ${Math.round(report.duration)}s (${Math.round(executedCount / report.duration)} tx/sec) `.padEnd(67) + pc.bold('║'));
        console.log(`║  Security:     ${getSecurityStatus(report)} `.padEnd(67) + pc.bold('║'));
        console.log(`║  Resilience:   ${getResilienceStatus(report)} `.padEnd(67) + pc.bold('║'));
        console.log(pc.bold('╚══════════════════════════════════════════════════════════════════╝'));
        console.log(`Full report: ${reportPath} `);

        process.exit(verdict === 'FAIL' ? 1 : 0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Watch for completion
    while (!orchestrator.isFinished()) {
        await new Promise(r => setTimeout(r, 1000));
    }

    await shutdown();
}

function calculateVerdict(report: any, executedCount: number): 'PASS' | 'PARTIAL' | 'FAIL' {
    // 1. Security Check (Non-negotiable)
    for (const atk of Object.values(report.attacks as any)) {
        if ((atk as any).failed > 0) return 'FAIL';
    }

    // 2. Execution Throughput Check (end-to-end, not just submission)
    const executedThroughput = executedCount / report.duration;
    if (executedThroughput < 50) return 'FAIL';  // Less than 50 tx/sec executed = FAIL
    if (executedThroughput < 200) return 'PARTIAL';  // Less than 200 tx/sec = PARTIAL

    // 3. Issue Severity
    const errors = report.issues.filter((i: any) => i.severity === 'error');
    if (errors.length > 0) return 'FAIL';

    return 'PASS';
}

function getSecurityStatus(report: any) {
    const total = Object.values(report.attacks).reduce((acc: number, a: any) => acc + a.total, 0);
    const rejected = Object.values(report.attacks).reduce((acc: number, a: any) => acc + a.rejected, 0);
    return `${rejected}/${total} attacks rejected (${total > 0 ? Math.round((rejected / total) * 100) : 100}%)`;
}

function getResilienceStatus(report: any) {
    const alive = report.nodes.filter((n: any) => n.status === 'ok').length;
    return `${alive}/${report.nodes.length} nodes alive at end`;
}

main().catch(err => {
    console.error(pc.red('Critical failure:'), err);
    process.exit(1);
});
