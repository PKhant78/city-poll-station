import { defineHandler } from "nitro/h3";
import { proxyBackend } from "../server/backendProxy.js";

// Nitro supplies the server runtime while React remains a client-rendered SPA.
export default defineHandler((event) => proxyBackend(event.req));
