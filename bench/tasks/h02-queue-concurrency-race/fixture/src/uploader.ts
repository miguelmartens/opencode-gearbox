import { TaskQueue } from './queue.ts';

export type UploadFn = (name: string) => Promise<void>;

export type UploadReport = {
  uploaded: string[];
  failed: Array<{ name: string; error: string }>;
};

/**
 * Uploads every file with at most `concurrency` uploads in flight and resolves once all of them
 * have finished, successfully or not. Lists keep the input order.
 */
export async function uploadAll(
  files: string[],
  upload: UploadFn,
  concurrency = 3,
): Promise<UploadReport> {
  const queue = new TaskQueue({ concurrency });
  const outcomes = new Map<string, string | null>();
  for (const name of files) {
    queue
      .add(() => upload(name))
      .then(
        () => outcomes.set(name, null),
        (error: unknown) =>
          outcomes.set(name, error instanceof Error ? error.message : String(error)),
      );
  }
  await queue.onIdle();

  const report: UploadReport = { uploaded: [], failed: [] };
  for (const name of files) {
    if (!outcomes.has(name)) continue;
    const error = outcomes.get(name);
    if (error == null) report.uploaded.push(name);
    else report.failed.push({ name, error });
  }
  return report;
}
