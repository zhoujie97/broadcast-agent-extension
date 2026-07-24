import { handleProxyRequest } from "../proxy/server.mjs";

export default function handler(request, response) {
  request.url = "/v1/web-search";
  return handleProxyRequest(request, response);
}
