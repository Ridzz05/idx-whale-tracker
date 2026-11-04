export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // register() also runs in the edge runtime, which cannot load node:sqlite,
    // so the feed module must only be imported on the Node branch.
    const { ensureFeed } = await import("./market/feed");
    ensureFeed();
  }
}
