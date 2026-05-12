import * as z from "zod/v4";

const TIME_FRAMES = ["today", "yesterday", "this_week", "last_week", "this_month", "last_month"];

export function registerListTimeEntriesTool(server, session) {
  server.registerTool(
    "list_time_entries",
    {
      title: "List Time Entries",
      description:
        "List time entries with optional filters. " +
        "Accepts customer, project, service, and user by name or ID - names are resolved automatically. " +
        "Use 'at' for a predefined time frame or 'from'/'to' for an explicit date range.\n\n" +
        "Examples:\n" +
        '- My entries for this month on project 1234567: { "project_id": 1234567, "at": "this_month" }\n' +
        '- Entries for customer "My Customer" this month: { "customer_name": "Customer", "at": "this_month" }\n' +
        '- Combined: { "project_id": 1234567, "customer_name": "Customer", "at": "this_month" }',
      inputSchema: z.object({
        customer_id: z.number().int().positive().optional()
          .describe("Filter by customer ID"),
        customer_name: z.string().optional()
          .describe("Filter by customer name (partial, case-insensitive)"),

        project_id: z.number().int().positive().optional()
          .describe("Filter by project ID"),
        project_name: z.string().optional()
          .describe("Filter by project name (partial, case-insensitive)"),

        service_id: z.number().int().positive().optional()
          .describe("Filter by service ID"),
        service_name: z.string().optional()
          .describe("Filter by service name (partial, case-insensitive)"),

        user_id: z.number().int().positive().optional()
          .describe("Filter by user ID"),
        user_name: z.string().optional()
          .describe("Filter by user name (partial, case-insensitive)"),

        at: z.enum(TIME_FRAMES).optional()
          .describe("Predefined time frame: today | yesterday | this_week | last_week | this_month | last_month"),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
          .describe("Start date YYYY-MM-DD (use with 'to'; overrides 'at')"),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
          .describe("End date YYYY-MM-DD (use with 'from'; overrides 'at')"),

        note: z.string().optional()
          .describe("Filter by note text (partial match)"),
        locked: z.boolean().optional()
          .describe("Filter by locked status")
      }),
      annotations: { readOnlyHint: true }
    },
    async (args) => {
      const client = session.miteClient;
      const params = {};

      const customerId = await resolveId(
        args.customer_id, args.customer_name,
        () => client.getCustomers(), "customer"
      );
      if (customerId !== undefined) params.customer_id = customerId;

      const projectId = await resolveId(
        args.project_id, args.project_name,
        () => client.getProjects(), "project"
      );
      if (projectId !== undefined) params.project_id = projectId;

      const serviceId = await resolveId(
        args.service_id, args.service_name,
        () => client.getServices(), "service"
      );
      if (serviceId !== undefined) params.service_id = serviceId;

      const userId = await resolveId(
        args.user_id, args.user_name,
        () => client.getUsers(), "user"
      );
      if (userId !== undefined) params.user_id = userId;

      if (args.from || args.to) {
        if (args.from) params.from = args.from;
        if (args.to) params.to = args.to;
      } else if (args.at) {
        Object.assign(params, resolveTimeFrame(args.at));
      }

      if (args.note) params.note = args.note;
      if (args.locked !== undefined) params.locked = args.locked;

      const entries = await client.getTimeEntries(params);

      return {
        content: [
          {
            type: "text",
            text: `${entries.length} time entr${entries.length === 1 ? "y" : "ies"}`
          }
        ],
        structuredContent: {
          count: entries.length,
          entries: entries.map(toEntry)
        }
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

function resolveTimeFrame(at) {
  const today = new Date();
  const fmt = d => d.toISOString().slice(0, 10);

  switch (at) {
    case "today":
      return { at: fmt(today) };
    case "yesterday": {
      const d = new Date(today);
      d.setDate(d.getDate() - 1);
      return { at: fmt(d) };
    }
    case "this_week": {
      const dow = today.getDay() || 7;
      const start = new Date(today);
      start.setDate(today.getDate() - dow + 1);
      return { from: fmt(start), to: fmt(today) };
    }
    case "last_week": {
      const dow = today.getDay() || 7;
      const end = new Date(today);
      end.setDate(today.getDate() - dow);
      const start = new Date(end);
      start.setDate(end.getDate() - 6);
      return { from: fmt(start), to: fmt(end) };
    }
    case "this_month":
      return {
        from: fmt(new Date(today.getFullYear(), today.getMonth(), 1)),
        to: fmt(today)
      };
    case "last_month":
      return {
        from: fmt(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
        to: fmt(new Date(today.getFullYear(), today.getMonth(), 0))
      };
  }
}

function toEntry(e) {
  return {
    id: e.id,
    date: e.date_at,
    minutes: e.minutes,
    hours: fmtMinutes(e.minutes),
    customer_id: e.customer_id,
    customer: e.customer_name,
    project_id: e.project_id,
    project: e.project_name,
    service_id: e.service_id,
    service: e.service_name,
    user_id: e.user_id,
    user: e.user_name,
    note: e.note,
    billable: e.billable,
    locked: e.locked,
    revenue: e.revenue
  };
}

function fmtMinutes(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}