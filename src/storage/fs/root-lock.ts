const queues = new Map<string, Promise<void>>();

/** Serialize mutations to one real vault root across all vault instances in this process. */
export async function withVaultRootLock<T>(root: string, operation: () => Promise<T>): Promise<T> {
  const key = process.platform === 'win32' ? root.toLowerCase() : root;
  const previous = queues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  queues.set(key, tail);

  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (queues.get(key) === tail) queues.delete(key);
  }
}
