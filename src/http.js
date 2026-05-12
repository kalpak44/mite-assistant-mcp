export function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

export async function readJsonBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const bodyText = Buffer.concat(chunks).toString("utf8");

  try {
    return JSON.parse(bodyText);
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}

export function getSessionId(headerValue) {
  return Array.isArray(headerValue) ? headerValue[0] : headerValue;
}
