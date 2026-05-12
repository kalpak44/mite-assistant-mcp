export function createMiteClient(config, apiKey) {
  const headers = {
    Accept: "application/json",
    "User-Agent": config.miteUserAgent,
    "X-MiteApiKey": apiKey
  };

  const jsonHeaders = { ...headers, "Content-Type": "application/json" };

  async function get(path, params = {}) {
    const url = new URL(buildMiteUrl(config.miteBaseUrl, path));
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }

    let response;
    try {
      response = await fetch(url.toString(), { method: "GET", headers });
    } catch (error) {
      throw createHttpError(
        502,
        `Failed to reach Mite API: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw createHttpError(401, "Unauthorized Mite API key.");
    }

    if (!response.ok) {
      throw createHttpError(502, `Mite API request failed with status ${response.status}.`);
    }

    return response.json();
  }

  async function mutate(method, path, body) {
    const url = buildMiteUrl(config.miteBaseUrl, path);
    let response;
    try {
      response = await fetch(url, {
        method,
        headers: jsonHeaders,
        body: body !== undefined ? JSON.stringify(body) : undefined
      });
    } catch (error) {
      throw createHttpError(
        502,
        `Failed to reach Mite API: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw createHttpError(401, "Unauthorized Mite API key.");
    }

    if (!response.ok) {
      throw createHttpError(502, `Mite API request failed with status ${response.status}.`);
    }

    if (response.status === 204 || response.headers.get("content-length") === "0") {
      return null;
    }

    return response.json();
  }

  return {
    async getCurrentUser() {
      const payload = await get("/myself.json");
      if (!payload?.user) {
        throw createHttpError(502, "Mite API response did not include a user.");
      }
      return payload.user;
    },

    async getTimeEntries(params = {}) {
      const data = await get("/time_entries.json", { limit: 100, ...params });
      return Array.isArray(data) ? data.map(item => item.time_entry) : [];
    },

    async getCustomers() {
      const data = await get("/customers.json");
      return Array.isArray(data) ? data.map(item => item.customer) : [];
    },

    async getProjects() {
      const data = await get("/projects.json");
      return Array.isArray(data) ? data.map(item => item.project) : [];
    },

    async getServices() {
      const data = await get("/services.json");
      return Array.isArray(data) ? data.map(item => item.service) : [];
    },

    async getUsers() {
      const data = await get("/users.json");
      return Array.isArray(data) ? data.map(item => item.user) : [];
    },

    async createTimeEntry(fields) {
      return mutate("POST", "/time_entries.json", { time_entry: fields });
    },

    async updateTimeEntry(id, fields) {
      return mutate("PATCH", `/time_entries/${id}.json`, { time_entry: fields });
    },

    async deleteTimeEntry(id) {
      return mutate("DELETE", `/time_entries/${id}.json`);
    }
  };
}

function buildMiteUrl(baseUrl, path) {
  return new URL(path, ensureTrailingSlash(baseUrl)).toString();
}

function ensureTrailingSlash(url) {
  return url.endsWith("/") ? url : `${url}/`;
}

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}