export interface Job {
  id: string;
  run(): Promise<void>;
}

/** Runs jobs one after another; a job that throws is retried up to `retries` times. */
export async function runAll(jobs: Job[], retries = 2): Promise<void> {
  for (const job of jobs) {
    for (let attempt = 0; ; attempt++) {
      try {
        await job.run();
        break;
      } catch (error) {
        if (attempt >= retries) throw error;
      }
    }
  }
}
