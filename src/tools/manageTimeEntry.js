import * as z from "zod/v4";

export function registerManageTimeEntryTools(server, session) {
  registerCreateTool(server, session);
  registerUpdateTool(server, session);
  registerDeleteTool(server, session);
}

function registerCreateTool(server, session) {
  server.registerTool(
    "create_time_entry",
    {
      title: "Create Time Entry",
      description:
        "Create a new time entry for the current user. " +
        "Project and service can be specified by name or ID — names are resolved automatically.\n\n" +
        "Examples:\n" +
        '- 90 min on project 3663214 today: { "minutes": 90, "project_id": 3663214 }\n' +
        '- 2 h on "Development - Backend" for a specific date: { "minutes": 120, "service_name": "Development - Backend", "date_at": "2026-05-12", "note": "#123 - fix bug" }',
      inputSchema: z.object({
        minutes: z.number().int().positive()
          .describe("Duration in minutes (e.g. 90 for 1:30 h)"),
        date_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
          .describe("Date YYYY-MM-DD (defaults to today)"),
        project_id: z.number().int().positive().optional()
          .describe("Project ID"),
        project_name: z.string().optional()
          .describe("Project name (partial, case-insensitive)"),
        service_id: z.number().int().positive().optional()
          .describe("Service ID"),
        service_name: z.string().optional()
          .describe("Service name (partial, case-insensitive)"),
        note: z.string().optional()
          .describe("Entry note / description")
      }),
      annotations: { readOnlyHint: false, idempotentHint: false }
    },
    async (args) => {
      const client = session.miteClient;

      const projectId = await resolveId(
        args.project_id, args.project_name,
        () => client.getProjects(), "project"
      );
      const serviceId = await resolveId(
        args.service_id, args.service_name,
        () => client.getServices(), "service"
      );

      const fields = {
        minutes: args.minutes,
        date_at: args.date_at ?? today(),
        ...(projectId !== undefined && { project_id: projectId }),
        ...(serviceId !== undefined && { service_id: serviceId }),
        ...(args.note !== undefined && { note: args.note })
      };

      const payload = await client.createTimeEntry(fields);
      const entry = payload?.time_entry ?? payload;

      return {
        content: [{ type: "text", text: `Created time entry ${entry.id} (${fmtMinutes(entry.minutes)} on ${entry.date_at})` }],
        structuredContent: { time_entry: entry }
      };
    }
  );
}

function registerUpdateTool(server, session) {
  server.registerTool(
    "update_time_entry",
    {
      title: "Update Time Entry",
      description:
        "Edit an existing time entry by ID. Only the fields you provide are changed.\n\n" +
        "Examples:\n" +
        '- Fix minutes: { "id": 987654, "minutes": 60 }\n' +
        '- Add a note: { "id": 987654, "note": "#456 - review PR" }',
      inputSchema: z.object({
        id: z.number().int().positive()
          .describe("ID of the time entry to update"),
        minutes: z.number().int().positive().optional()
          .describe("New duration in minutes"),
        date_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
          .describe("New date YYYY-MM-DD"),
        project_id: z.number().int().positive().optional()
          .describe("New project ID"),
        project_name: z.string().optional()
          .describe("New project name (partial, case-insensitive)"),
        service_id: z.number().int().positive().optional()
          .describe("New service ID"),
        service_name: z.string().optional()
          .describe("New service name (partial, case-insensitive)"),
        note: z.string().optional()
          .describe("New note text")
      }),
      annotations: { readOnlyHint: false, idempotentHint: true }
    },
    async (args) => {
      const client = session.miteClient;

      const projectId = await resolveId(
        args.project_id, args.project_name,
        () => client.getProjects(), "project"
      );
      const serviceId = await resolveId(
        args.service_id, args.service_name,
        () => client.getServices(), "service"
      );

      const fields = {
        ...(args.minutes !== undefined && { minutes: args.minutes }),
        ...(args.date_at !== undefined && { date_at: args.date_at }),
        ...(projectId !== undefined && { project_id: projectId }),
        ...(serviceId !== undefined && { service_id: serviceId }),
        ...(args.note !== undefined && { note: args.note })
      };

      if (Object.keys(fields).length === 0) {
        throw new Error("No fields to update — provide at least one field to change.");
      }

      await client.updateTimeEntry(args.id, fields);

      return {
        content: [{ type: "text", text: `Updated time entry ${args.id}` }],
        structuredContent: { id: args.id, updated: fields }
      };
    }
  );
}

function registerDeleteTool(server, session) {
  server.registerTool(
    "delete_time_entry",
    {
      title: "Delete Time Entry",
      description:
        "Permanently delete a time entry by ID.\n\n" +
        'Example: { "id": 987654 }',
      inputSchema: z.object({
        id: z.number().int().positive()
          .describe("ID of the time entry to delete")
      }),
      annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: true }
    },
    async (args) => {
      await session.miteClient.deleteTimeEntry(args.id);
      return {
        content: [{ type: "text", text: `Deleted time entry ${args.id}` }],
        structuredContent: { id: args.id }
      };
    }
  );
}

async function resolveId(id, name, fetchList, label) {
  if (id !== undefined) return id;
  if (!name) return undefined;

  const list = await fetchList();
  const lower = name.toLowerCase();
  const matches = list.filter(item => item.name.toLowerCase().includes(lower));

  if (matches.length === 0) {
    throw new Error(`No ${label} found matching "${name}"`);
  }
  if (matches.length > 1) {
    const choices = matches.map(m => `"${m.name}" (id: ${m.id})`).join(", ");
    throw new Error(`Ambiguous ${label} name "${name}" — matches: ${choices}`);
  }
  return matches[0].id;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function fmtMinutes(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}