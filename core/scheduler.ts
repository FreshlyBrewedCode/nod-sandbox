export interface Job {
  id: string;
  run(): Promise<void>;
}

export async function runAll(jobs: Job[]): Promise<void> {
  for (const job of jobs) await job.run();
}
