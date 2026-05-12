export function createMiteClient(config, apiKey) {
  return {
    async getCurrentUser() {
      let response;

      try {
        response = await fetch(buildMiteUrl(config.miteBaseUrl, "/myself.json"), {
          method: "GET",
          headers: {
            Accept: "application/json",
            "User-Agent": config.miteUserAgent,
            "X-MiteApiKey": apiKey
          }
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
        throw createHttpError(
          502,
          `Mite API request failed with status ${response.status}.`
        );
      }

      const payload = await response.json();
      if (!payload?.user) {
        throw createHttpError(502, "Mite API response did not include a user.");
      }

      return payload.user;
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
