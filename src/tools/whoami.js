import * as z from "zod/v4";

export function registerWhoAmITool(server, session) {
  server.registerTool(
    "whoami",
    {
      title: "Who Am I",
      description: "Return the currently authenticated Mite user.",
      inputSchema: z.object({}),
      outputSchema: z.object({
        miteBaseUrl: z.string(),
        user: z.object({
          id: z.number(),
          name: z.string(),
          email: z.string(),
          note: z.string(),
          archived: z.boolean(),
          role: z.string(),
          language: z.string(),
          created_at: z.string(),
          updated_at: z.string()
        })
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true
      }
    },
    async () => ({
      content: [
        {
          type: "text",
          text: `${session.user.name} <${session.user.email}> (${session.user.role})`
        }
      ],
      structuredContent: {
        miteBaseUrl: session.miteBaseUrl,
        user: session.user
      }
    })
  );
}
