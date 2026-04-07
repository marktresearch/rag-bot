import {
  createThread,
  getThreadMetadata,
  listMessages,
  saveMessages,
  updateThreadMetadata,
} from "@convex-dev/agent";
import { v } from "convex/values";
import { components } from "./_generated/api";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";

const DEFAULT_CHAT_USER_ID = "local-demo-user";
const PAGE_SIZE = 128;
const QUERY_LOG_MATCH_WINDOW_MS = 5 * 60 * 1000;

const routeValidator = v.union(
  v.literal("dataset_meta"),
  v.literal("rag"),
  v.literal("conversation")
);

type AssistantMetadataRecord = {
  messageId: string;
  threadId: string;
  route?: "dataset_meta" | "rag" | "conversation";
  matches?: Array<Record<string, unknown>>;
  metrics?: Record<string, unknown> | null;
  routingReason?: string;
};

type PersistedThreadMessage = {
  _creationTime: number;
  _id: string;
  message?: {
    role: "user" | "assistant" | "system" | "tool";
    content:
      | string
      | Array<
          | { type: "text"; text: string }
          | { type: "reasoning"; text: string }
          | { type: string; [key: string]: unknown }
        >;
  };
};

function defaultPagination(cursor: string | null = null) {
  return {
    cursor,
    numItems: PAGE_SIZE,
  };
}

function buildChatTitle(question: string) {
  const cleaned = question.replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return "New conversation";
  }

  return cleaned.length <= 72 ? cleaned : `${cleaned.slice(0, 69).trimEnd()}...`;
}

function buildChatSummary(answer: string) {
  const cleaned = answer.replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return null;
  }

  return cleaned.length <= 180 ? cleaned : `${cleaned.slice(0, 177).trimEnd()}...`;
}

function extractMessageText(
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "reasoning"; text: string }
        | { type: string; [key: string]: unknown }
      >
) {
  if (typeof content === "string") {
    return content;
  }

  return content
    .flatMap((part) =>
      part.type === "text" || part.type === "reasoning" ? [part.text] : []
    )
    .join("\n")
    .trim();
}

async function listAllMessagesForThread(
  ctx: Parameters<typeof listMessages>[0],
  threadId: string
) {
  const messages: PersistedThreadMessage[] = [];

  let cursor: string | null = null;

  while (true) {
    const page = await listMessages(ctx, components.agent, {
      threadId,
      excludeToolMessages: true,
      paginationOpts: defaultPagination(cursor),
    });

    messages.push(...page.page);

    if (page.isDone) {
      break;
    }

    cursor = page.continueCursor;
  }

  return messages;
}

function buildQueryLogMatches(messages: PersistedThreadMessage[]) {
  const matches: Array<{
    question: string;
    answer: string;
    assistantCreatedAt: number;
  }> = [];
  let pendingQuestion: string | null = null;

  for (const message of messages) {
    if (!message.message) {
      continue;
    }

    const content = extractMessageText(message.message.content).trim();
    if (!content) {
      continue;
    }

    if (message.message.role === "user") {
      pendingQuestion = content;
      continue;
    }

    if (message.message.role === "assistant" && pendingQuestion) {
      matches.push({
        question: pendingQuestion,
        answer: content,
        assistantCreatedAt: message._creationTime,
      });
      pendingQuestion = null;
    }
  }

  return matches;
}

async function deleteQueryLogsForThread(ctx: MutationCtx, threadId: string) {
  const messages = await listAllMessagesForThread(ctx, threadId);
  const threadLogMatches = buildQueryLogMatches(messages);
  if (threadLogMatches.length === 0) {
    return 0;
  }

  const queryLogs = await ctx.db.query("queryLogs").withIndex("by_timestamp").collect();
  const logsToDelete = queryLogs.filter((log) =>
    threadLogMatches.some(
      (match) =>
        log.query === match.question &&
        log.responseText === match.answer &&
        Math.abs(log.timestamp - match.assistantCreatedAt) <= QUERY_LOG_MATCH_WINDOW_MS
    )
  );

  await Promise.all(logsToDelete.map((log) => ctx.db.delete(log._id)));
  return logsToDelete.length;
}

async function getAssistantMetadataByThread(
  ctx: QueryCtx,
  threadId: string
) {
  const docs = await ctx.db
    .query("chatMessageMetadata")
    .withIndex("by_thread_message", (q) => q.eq("threadId", threadId))
    .collect();

  return new Map(
    docs.map((doc) => [doc.messageId, doc as AssistantMetadataRecord])
  );
}

export const listChats = query({
  args: {},
  handler: async (ctx) => {
    const threads = await ctx.runQuery(components.agent.threads.listThreadsByUserId, {
      order: "desc",
      paginationOpts: {
        cursor: null,
        numItems: 64,
      },
      userId: DEFAULT_CHAT_USER_ID,
    });

    const chats = await Promise.all(
      threads.page.map(async (thread) => {
        const messages = await listAllMessagesForThread(ctx, thread._id);
        const latestMessage = messages[messages.length - 1] ?? null;
        const previewSource =
          latestMessage?.message?.content && latestMessage.message.role !== "system"
            ? extractMessageText(latestMessage.message.content)
            : null;

        return {
          id: thread._id,
          title: thread.title ?? "New conversation",
          createdAt: thread._creationTime,
          updatedAt: latestMessage?._creationTime ?? thread._creationTime,
          lastMessageAt: latestMessage?._creationTime ?? thread._creationTime,
          messageCount: messages.length,
          summary: thread.summary ?? null,
          preview: previewSource || null,
        };
      })
    );

    return chats.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  },
});

export const getChat = query({
  args: {
    chatId: v.string(),
  },
  handler: async (ctx, args) => {
    const thread = await getThreadMetadata(ctx, components.agent, {
      threadId: args.chatId,
    }).catch(() => null);

    if (!thread || thread.userId !== DEFAULT_CHAT_USER_ID) {
      return null;
    }

    const [messages, metadataByMessageId] = await Promise.all([
      listAllMessagesForThread(ctx, args.chatId),
      getAssistantMetadataByThread(ctx, args.chatId),
    ]);

    const chatMessages = messages
      .filter(
        (message): message is typeof message & {
          message: NonNullable<typeof message.message>;
        } =>
          Boolean(message.message) &&
          (message.message?.role === "user" ||
            message.message?.role === "assistant" ||
            message.message?.role === "system")
      )
      .map((message) => {
        const metadata = metadataByMessageId.get(message._id) ?? null;
        return {
          id: message._id,
          role: message.message.role,
          content: extractMessageText(message.message.content),
          createdAt: message._creationTime,
          route: metadata?.route ?? null,
          metadata: metadata
            ? {
                matches: (metadata.matches as Array<Record<string, unknown>> | undefined) ?? [],
                metrics:
                  (metadata.metrics as Record<string, unknown> | null | undefined) ?? null,
                routingReason: metadata.routingReason ?? null,
              }
            : null,
        };
      });

    const latestMessage = chatMessages[chatMessages.length - 1] ?? null;

    return {
      chat: {
        id: thread._id,
        title: thread.title ?? "New conversation",
        createdAt: thread._creationTime,
        updatedAt: latestMessage?.createdAt ?? thread._creationTime,
        lastMessageAt: latestMessage?.createdAt ?? thread._creationTime,
        messageCount: chatMessages.length,
        summary: thread.summary ?? null,
        preview:
          latestMessage && latestMessage.role !== "system"
            ? latestMessage.content
            : null,
      },
      messages: chatMessages,
    };
  },
});

export const createChat = mutation({
  args: {
    title: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const title = args.title?.trim() || "New conversation";
    const threadId = await createThread(ctx, components.agent, {
      title,
      userId: DEFAULT_CHAT_USER_ID,
    });

    return {
      id: threadId,
      title,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastMessageAt: Date.now(),
      messageCount: 0,
      summary: null,
      preview: null,
    };
  },
});

export const deleteChat = mutation({
  args: {
    chatId: v.string(),
  },
  handler: async (ctx, args) => {
    const thread = await getThreadMetadata(ctx, components.agent, {
      threadId: args.chatId,
    }).catch(() => null);

    if (!thread || thread.userId !== DEFAULT_CHAT_USER_ID) {
      throw new Error("Chat not found.");
    }

    const metadataDocs = await ctx.db
      .query("chatMessageMetadata")
      .withIndex("by_thread_message", (q) => q.eq("threadId", args.chatId))
      .collect();

    const deletedQueryLogCount = await deleteQueryLogsForThread(ctx, args.chatId);

    await Promise.all(metadataDocs.map((doc) => ctx.db.delete(doc._id)));
    await ctx.runMutation(components.agent.threads.deleteAllForThreadIdAsync, {
      threadId: args.chatId,
      limit: 1024,
    });

    return {
      deletedChatId: args.chatId,
      deletedMetadataCount: metadataDocs.length,
      deletedQueryLogCount,
    };
  },
});

export const saveExchange = mutation({
  args: {
    chatId: v.optional(v.string()),
    question: v.string(),
    answer: v.string(),
    route: routeValidator,
    routingReason: v.string(),
    matches: v.optional(v.array(v.any())),
    metrics: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const existingThread = args.chatId
      ? await getThreadMetadata(ctx, components.agent, {
          threadId: args.chatId,
        }).catch(() => null)
      : null;

    const threadId =
      existingThread?._id ??
      (await createThread(ctx, components.agent, {
        title: buildChatTitle(args.question),
        userId: DEFAULT_CHAT_USER_ID,
      }));

    const saved = await saveMessages(ctx, components.agent, {
      threadId,
      userId: DEFAULT_CHAT_USER_ID,
      messages: [
        {
          role: "user",
          content: args.question,
        },
        {
          role: "assistant",
          content: args.answer,
        },
      ],
    });

    const assistantMessage = [...saved.messages]
      .reverse()
      .find((message) => message.message?.role === "assistant");

    if (assistantMessage) {
      await ctx.db.insert("chatMessageMetadata", {
        threadId,
        messageId: assistantMessage._id,
        route: args.route,
        matches: args.matches,
        metrics: args.metrics,
        routingReason: args.routingReason,
      });
    }

    const currentTitle = existingThread?.title?.trim();
    const title = currentTitle && currentTitle.length > 0
      ? currentTitle
      : buildChatTitle(args.question);

    await updateThreadMetadata(ctx, components.agent, {
      threadId,
      patch: {
        summary: buildChatSummary(args.answer) ?? undefined,
        title,
      },
    });

    return {
      chatId: threadId,
      chatTitle: title,
    };
  },
});
