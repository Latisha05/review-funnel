import { handleLogout } from "../../_auth.js";

export async function onRequestPost(ctx) {
  return handleLogout(ctx);
}
