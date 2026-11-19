/**
 * Spreads per-page work across cores. The calling script is also the worker:
 * it checks isMainThread, calls runPool on the main thread and serveJobs in workers.
 * Results come back in job order, so logs and output match a sequential run.
 * A job that throws crashes its worker, which fails the build.
 */
import os from "os";
import { Worker, parentPort } from "worker_threads";

/**
 * `setup` may be a promise: workers start immediately and load their libraries
 * while it resolves, then get it as their first message.
 * Each worker spends ~0.3-0.9s loading libraries, and on a 16-thread machine 4
 * workers beat 6 or 8 for both scripts: extra workers cost more startup than they save.
 */
export async function runPool(moduleUrl, jobs, { setup, maxWorkers = 4 } = {}) {
    const results = new Array(jobs.length);
    if (jobs.length === 0) return results;

    // availableParallelism, not cpus().length: in a container cpus() can list the host's cores.
    const size = Math.min(os.availableParallelism(), maxWorkers, jobs.length);
    let next = 0;

    const workers = Array.from({ length: size }, () => new Worker(moduleUrl));
    const done = workers.map(
        (worker) =>
            new Promise((resolve, reject) => {
                const feed = () => worker.postMessage(next < jobs.length ? { i: next, job: jobs[next++] } : null);
                worker.on("message", ({ i, result }) => {
                    results[i] = result;
                    feed();
                });
                worker.on("error", reject);
                worker.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`worker exited with code ${code}`))));
            }),
    );

    let setupData;
    try {
        setupData = await setup;
    } catch (error) {
        await Promise.all(workers.map((w) => w.terminate()));
        throw error;
    }
    for (const worker of workers) worker.postMessage({ setup: setupData });
    // Messages queue in order, so the first job follows setup.
    for (const worker of workers) worker.postMessage(next < jobs.length ? { i: next, job: jobs[next++] } : null);

    await Promise.all(done);
    return results;
}

/**
 * makeHandler(setup) runs once per worker and returns the per-job handler. A null
 * job means the queue is empty; closing the port lets the worker exit.
 */
export function serveJobs(makeHandler) {
    let handler;
    parentPort.on("message", async (msg) => {
        if (msg === null) {
            parentPort.close();
            return;
        }
        if ("setup" in msg) {
            handler = makeHandler(msg.setup);
            return;
        }
        const run = await handler;
        parentPort.postMessage({ i: msg.i, result: await run(msg.job) });
    });
}
