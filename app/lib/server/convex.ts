import { ConvexHttpClient } from "convex/browser";

export function getServerConvexClient() {
  const convexUrl = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    throw new Error("CONVEX_URL or NEXT_PUBLIC_CONVEX_URL is not defined");
  }

  return new ConvexHttpClient(convexUrl);
}

export async function runServerQuery<T>(
  name: string,
  args: Record<string, unknown>
) {
  const client = getServerConvexClient();
  return (await client.query(name as never, args as never)) as T;
}

export async function runServerMutation<T>(
  name: string,
  args: Record<string, unknown>
) {
  const client = getServerConvexClient();
  return (await client.mutation(name as never, args as never)) as T;
}

export async function runServerAction<T>(
  name: string,
  args: Record<string, unknown>
) {
  const client = getServerConvexClient();
  return (await client.action(name as never, args as never)) as T;
}
