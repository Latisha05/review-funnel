import { handleLogin } from "../../_auth.js";
import { jsonError } from "../../_shared.js";

export async function onRequestPost(ctx) {
  try {
    return await handleLogin(ctx);
  } catch (error) {
    const status =
      error.message === "Incorrect email or password."
        ? 401
        : error.message.includes("not mapped")
          ? 403
          : 500;
    return jsonError(error.message, status);
  }
}
