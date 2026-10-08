"use client";

/**
 * Client-side WebRTC config — fetches STUN/TURN settings from the
 * server's /api/settings endpoint (which reads from env vars + DB).
 *
 * Cached after the first fetch (the settings don't change during a
 * session — the user would need to restart the server to change env
 * vars, or use the superadmin panel to change DB settings).
 */

// RTCIceServer is a global DOM type (lib.dom) — no import needed.

let cachedServers: RTCIceServer[] | null = null;
let fetchPromise: Promise<RTCIceServer[]> | null = null;

/**
 * Build the iceServers array from the settings response.
 */
function buildIceServers(settings: {
  webrtcStunServers?: string;
  webrtcTurnServer?: string;
  webrtcTurnUsername?: string;
  webrtcTurnCredential?: string;
}): RTCIceServer[] {
  const servers: RTCIceServer[] = [];

  // STUN servers
  const stunStr = settings.webrtcStunServers;
  if (stunStr) {
    for (const url of stunStr.split(",").map(s => s.trim()).filter(Boolean)) {
      servers.push({ urls: url });
    }
  }

  // TURN server (if configured)
  const turnUrl = settings.webrtcTurnServer;
  if (turnUrl) {
    const turnUser = settings.webrtcTurnUsername;
    const turnPass = settings.webrtcTurnCredential;
    if (turnUser && turnPass) {
      servers.push({
        urls: turnUrl,
        username: turnUser,
        credential: turnPass,
      });
    }
  }

  // Fallback to Google STUN if nothing is configured.
  if (servers.length === 0) {
    servers.push(
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
    );
  }

  return servers;
}

/**
 * Returns the iceServers array for WebRTC peer connections.
 * Fetches from /api/settings on first call, then cached.
 */
export async function getIceServers(): Promise<RTCIceServer[]> {
  if (cachedServers) return cachedServers;
  if (fetchPromise) return fetchPromise;

  fetchPromise = (async () => {
    try {
      const res = await fetch("/api/settings");
      const json = await res.json();
      const settings = json?.data || {};
      cachedServers = buildIceServers(settings);
      return cachedServers;
    } catch {
      // Fallback to Google STUN on error.
      const fallback: RTCIceServer[] = [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ];
      cachedServers = fallback;
      return fallback;
    }
  })();

  return fetchPromise;
}
