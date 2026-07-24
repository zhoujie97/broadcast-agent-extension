import { handleProxyRequest } from "../proxy/server.mjs";

export default function handler(request, response) {
  request.url = "/v1/register";
  return handleProxyRequest(request, response);
}
