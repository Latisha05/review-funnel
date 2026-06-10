import { handleSession } from "../../_auth.js";
import { jsonError } from "../../_shared.js";

export async function onRequestGet(ctx) {
  try {
    return await handleSession(ctx);
  } catch (error) {
    return jsonError(error.message);
  }
}
