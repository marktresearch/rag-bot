import { api } from "@/convex/_generated/api";
import { getServerConvexClient } from "@/app/lib/server/convex";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  const { chatId } = await params;
  const convex = getServerConvexClient();
  const chat = await convex.query(api.chat.getChat, { chatId });

  if (!chat) {
    return new Response(JSON.stringify({ error: "Chat not found." }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  return Response.json(chat);
}
