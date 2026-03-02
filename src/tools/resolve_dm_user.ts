import { getDMChannels } from "./get_dms.js";

export async function resolveDmUser(username: string, account = "default") {
  const dms = await getDMChannels(account);

  const query = username.toLowerCase().trim();

  // Try exact match first, then partial
  let match = dms.find(dm => dm.with.toLowerCase() === query);
  if (!match) {
    match = dms.find(dm => dm.with.toLowerCase().includes(query));
  }

  if (!match) {
    return {
      error_code: "DM_NOT_FOUND",
      account,
      query: username,
      remedy: `No open DM found with "${username}". They must have an existing DM conversation.`,
      available: dms.map(d => d.with),
    };
  }

  return {
    channelId: match.channelId,
    displayName: match.with,
    matchedQuery: username,
  };
}
