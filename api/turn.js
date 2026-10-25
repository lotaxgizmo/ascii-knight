// Vercel serverless function: hands players short-lived TURN credentials from Cloudflare Realtime.
// TURN relays game traffic for players whose networks block direct WebRTC connections (mobile data,
// strict Wi-Fi): without it those players never see each other. The game itself stays peer-to-peer;
// the secret key stays here on the server and the credentials expire after a day.
// Set CF_TURN_KEY_ID and CF_TURN_API_TOKEN in the Vercel project's environment variables.
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const id = process.env.CF_TURN_KEY_ID, token = process.env.CF_TURN_API_TOKEN;
  if (!id || !token) return res.status(200).json({iceServers: [], configured: false});
  try {
    const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${id}/credentials/generate-ice-servers`, {
      method: "POST",
      headers: {Authorization: `Bearer ${token}`, "Content-Type": "application/json"},
      body: JSON.stringify({ttl: 86400}),
    });
    const j = await r.json();
    const ice = Array.isArray(j.iceServers) ? j.iceServers : j.iceServers ? [j.iceServers] : [];
    return res.status(200).json({iceServers: ice, configured: true});
  } catch (e) {
    return res.status(200).json({iceServers: [], configured: true, error: "turn unavailable"});
  }
}
