// Trailing-edge throttle: invoke fn at most once per `ms`. The last call's
// arguments are used when the trailing edge fires.
export const throttle = <Args extends unknown[]>(
  fn: (...args: Args) => void,
  ms: number,
): ((...args: Args) => void) => {
  let lastCall = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingArgs: Args | null = null;

  return (...args: Args) => {
    const now = Date.now();
    const elapsed = now - lastCall;
    if (elapsed >= ms) {
      lastCall = now;
      fn(...args);
      return;
    }
    pendingArgs = args;
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      lastCall = Date.now();
      if (pendingArgs) {
        const a = pendingArgs;
        pendingArgs = null;
        fn(...a);
      }
    }, ms - elapsed);
  };
};
