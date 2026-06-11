import { jsonError } from "../../_shared.js";

export async function onRequestPost() {
  return jsonError("Password reset is managed from Firebase Authentication for the hosted Pages app.", 501);
}
