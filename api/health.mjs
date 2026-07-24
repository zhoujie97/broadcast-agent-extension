import { handleProxyRequest } from "../proxy/server.mjs";

export default function handler(request, response) {
  request.url = "/health";
  return handleProxyRequest(request, response);
}
