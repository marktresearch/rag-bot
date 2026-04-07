import { api } from "@/convex/_generated/api";
import { getServerConvexClient } from "@/app/lib/server/convex";

export async function GET() {
  try {
    const convex = getServerConvexClient();
    const chats = await convex.query(api.chat.listChats, {});
    return Response.json({ chats, warning: null });
  } catch {
    return Response.json({ chats: [], warning: null });
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  try {
    const convex = getServerConvexClient();
    const chat = await convex.mutation(api.chat.createChat, {
      title:
        typeof body?.title === "string" && body.title.trim().length > 0
          ? body.title.trim()
          : undefined,
    });

    return Response.json({
      chat,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
