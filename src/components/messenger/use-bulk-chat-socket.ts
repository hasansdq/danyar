"use client";

import * as React from "react";
import { io, type Socket } from "socket.io-client";
import { socketAuthCallback } from "@/lib/socket-auth-client";

/**
 * Shared socket.io hook for the bulk chat management UI.
 *
 * Lazily connects to the chat mini-service on port 3003 (via the gateway
 * `XTransformPort` convention). Authentication uses a short-lived JWT
 * fetched from /api/socket/token (bound to the NextAuth session) — the
 * server ignores any client-supplied identity fields.
 *
 * Used by:
 *   - Admin bulk chat page (`/admin/bulk-chat`)
 *   - Teacher bulk chat Sheet in the messenger header
 *
 * The hook connects on mount and disconnects on unmount, so callers should
 * render it inside a dialog/page that is conditionally mounted (which is the
 * case for both consumers).
 */

export interface BulkChatUser {
  id: string;
  username: string;
  /** Display name (sent as `fullName` in the socket auth payload). */
  name: string;
  /** Matches MessengerUser["role"] — SUPERADMIN included for type parity. */
  role: "STUDENT" | "TEACHER" | "ADMIN" | "SUPERADMIN";
}

interface BulkCloseAck {
  ok?: boolean;
  error?: { message?: string };
  closedCount?: number;
}

interface BulkBroadcastAck {
  ok?: boolean;
  error?: { message?: string };
  sentCount?: number;
}

const ACK_TIMEOUT_MS = 8000;

export interface UseBulkChatSocketResult {
  connected: boolean;
  connecting: boolean;
  error: string | null;
  /** Emit `bulk_close_chats` — server closes all of the user's classes. */
  emitBulkClose: () => Promise<{ closedCount?: number }>;
  /** Emit `bulk_broadcast` — server creates a message in each of the user's classes. */
  emitBulkBroadcast: (content: string) => Promise<{ sentCount?: number }>;
}

export function useBulkChatSocket(
  user: BulkChatUser,
): UseBulkChatSocketResult {
  const [connected, setConnected] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const socketRef = React.useRef<Socket | null>(null);

  // Destructure into primitives so the connect effect only re-runs if any of
  // these actually change (which should never happen for a signed-in user).
  const { id, username, name, role } = user;

  React.useEffect(() => {
    const socket = io("/?XTransformPort=3003", {
      // SECURITY: verified server-side via shared-secret JWT.
      auth: socketAuthCallback(),
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      timeout: 10000,
    });
    socketRef.current = socket;

    const handleConnect = () => {
      setConnected(true);
      setError(null);
    };
    const handleDisconnect = () => setConnected(false);
    const handleConnectError = () => {
      setConnected(false);
      setError("اتصال به سرور برقرار نشد");
    };
    const handleError = (err: { message?: string }) => {
      if (err?.message) setError(err.message);
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("connect_error", handleConnectError);
    socket.on("error", handleError);

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
      setError(null);
    };
  }, [id, username, name, role]);

  const emitBulkClose = React.useCallback<UseBulkChatSocketResult["emitBulkClose"]>(() => {
    return new Promise((resolve, reject) => {
      const socket = socketRef.current;
      if (!socket || !socket.connected) {
        reject(new Error("اتصال به سرور برقرار نیست"));
        return;
      }
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error("پاسخی از سرور دریافت نشد (مهلت به پایان رسید)"));
      }, ACK_TIMEOUT_MS);

      try {
        socket.emit("bulk_close_chats", {}, (ack: BulkCloseAck) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (ack?.ok) {
            resolve({ closedCount: ack.closedCount });
          } else {
            reject(new Error(ack?.error?.message || "عملیات ناموفق بود"));
          }
        });
      } catch (e) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(e instanceof Error ? e : new Error("خطای غیرمنتظره"));
        }
      }
    });
  }, []);

  const emitBulkBroadcast = React.useCallback<
    UseBulkChatSocketResult["emitBulkBroadcast"]
  >((content: string) => {
    return new Promise((resolve, reject) => {
      const socket = socketRef.current;
      if (!socket || !socket.connected) {
        reject(new Error("اتصال به سرور برقرار نیست"));
        return;
      }
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error("پاسخی از سرور دریافت نشد (مهلت به پایان رسید)"));
      }, ACK_TIMEOUT_MS);

      try {
        socket.emit("bulk_broadcast", { content }, (ack: BulkBroadcastAck) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (ack?.ok) {
            resolve({ sentCount: ack.sentCount });
          } else {
            reject(new Error(ack?.error?.message || "عملیات ناموفق بود"));
          }
        });
      } catch (e) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(e instanceof Error ? e : new Error("خطای غیرمنتظره"));
        }
      }
    });
  }, []);

  return {
    connected,
    connecting: !connected,
    error,
    emitBulkClose,
    emitBulkBroadcast,
  };
}
