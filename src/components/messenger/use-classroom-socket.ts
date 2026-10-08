"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { MessengerUser } from "./types";
import { getIceServers } from "@/lib/webrtc-config";
import { socketAuthCallback } from "@/lib/socket-auth-client";

/* ========================================================================== */
/* Types                                                                       */
/* ========================================================================== */

export interface Participant {
  userId: string;
  username: string;
  fullName: string;
  role: string;
  avatar: string | null;
  micOn: boolean;
  camOn: boolean;
  screenSharing: boolean;
  handRaised: boolean;
  isSpeaking: boolean;
  // Phase 36 — teacher-granted permissions. false for students/principal
  // until the teacher grants mic/cam access.
  micAllowed?: boolean;
  camAllowed?: boolean;
  // Local-only: the latest reaction emoji (briefly shown as a floating bubble).
  lastReaction?: { emoji: string; at: number };
}

export interface ClassroomMessage {
  id: string;
  sessionId: string;
  userId: string;
  username: string;
  fullName: string;
  role: string;
  avatar: string | null;
  content: string;
  replyToId: string | null;
  createdAt: string;
}

export interface PrivateMessage {
  id: string;
  sessionId: string;
  fromUserId: string;
  fromUsername: string;
  fromFullName: string;
  fromAvatar: string | null;
  toUserId: string;
  content: string;
  createdAt: string;
}

// Phase 36h-3+4 — Collaborative whiteboard stroke. Coordinates are
// NORMALIZED (0..1) fractions of the canvas dimensions so the drawing
// looks the same on different screen sizes. When rendering, the canvas
// multiplies each coordinate by its actual pixel dimensions.
export interface WhiteboardPoint { x: number; y: number }
export interface WhiteboardStroke {
  tool: "pencil" | "eraser" | "rectangle" | "circle" | "arrow";
  color: string;
  size: number;
  // For pencil/eraser — many points (the path of the stroke). For shapes
  // (rectangle/circle/arrow) — exactly 2 points: start + end.
  points: WhiteboardPoint[];
}

export type ConnectionState = "connecting" | "connected" | "reconnecting" | "disconnected" | "error";

/* ========================================================================== */
/* The hook                                                                    */
/* ========================================================================== */

/**
 * useClassroomSocket — manages the socket.io connection to the
 * classroom-service (port 3004) + the WebRTC mesh peer connections
 * to every other participant.
 *
 * Mesh topology: each peer connects to every other peer directly via
 * RTCPeerConnection. The signaling server just relays SDP offers/answers
 * + ICE candidates between peers (it never terminates the media).
 *
 * Public state:
 *   - connectionState: socket connection status.
 *   - localStream: the user's camera/mic stream (null when not started).
 *   - localError: error from getUserMedia (e.g. permission denied).
 *   - participants: the live list of participants (with mic/cam state).
 *   - remoteStreams: Map<userId, MediaStream> for rendering remote video.
 *   - messages: ephemeral classroom chat messages.
 *   - activeSpeakerId: the userId of the currently-speaking participant
 *     (used by Speaker View).
 *   - raisedHandUsers: Set<userId> of users with raised hands.
 *
 * Public actions:
 *   - joinSession(sessionId, opts): join a session + start local media.
 *   - leaveSession(): leave + tear down all peer connections.
 *   - setMic(on), setCam(on), setScreenSharing(on): toggle local state
 *     + broadcast to peers.
 *   - raiseHand(on)
 *   - sendMessage(content, replyToId?)
 *   - sendPrivateMessage(toUserId, content)
 *   - sendReaction(emoji)
 *   - muteUser(userId) [teacher only]
 *   - removeUser(userId) [teacher only]
 *   - onIncomingEvent handlers — caller can register callbacks for
 *     `participant_joined`, `participant_left`, `reaction`, `removed`,
 *     `mute_user`, `private_message` (so the UI can show toasts).
 */
export function useClassroomSocket(user: MessengerUser) {
  // Socket + WebRTC peer connections.
  const socketRef = useRef<Socket | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  // Local stream + screen-share stream.
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  // Participants + their remote streams.
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  // Connection + local media state.
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  // Chat messages (ephemeral).
  const [messages, setMessages] = useState<ClassroomMessage[]>([]);
  const [privateMessages, setPrivateMessages] = useState<PrivateMessage[]>([]);
  // Active speaker (the most recent userId to fire `speaking=true`).
  const [activeSpeakerId, setActiveSpeakerId] = useState<string | null>(null);
  // Session id (set on join, used by event handlers).
  const sessionIdRef = useRef<string | null>(null);
  // Mic/cam/screen-share state (so setMic etc. can read the latest).
  const [micOn, setMicOn] = useState<boolean>(false);
  const [camOn, setCamOn] = useState<boolean>(false);
  const [screenSharing, setScreenSharing] = useState<boolean>(false);
  // Phase 35f — exposed screen stream for the local tile display.
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [handRaised, setHandRaised] = useState<boolean>(false);
  // Forced-muted flag (when a teacher mute_user fires).
  const [forceMuted, setForceMuted] = useState<boolean>(false);
  // Phase 36 — mic/cam PERMISSIONS for the LOCAL user.
  // Teachers start with both allowed (true); students + ADMIN (principal)
  // start with both denied (false) — the teacher must grant access before
  // they can turn on their mic/cam.
  const isTeacherRole = user.role === "TEACHER" || user.role === "SUPERADMIN";
  const [micAllowed, setMicAllowed] = useState<boolean>(isTeacherRole);
  const [camAllowed, setCamAllowed] = useState<boolean>(isTeacherRole);
  // Refs mirroring the permission state so setMic/setCam callbacks (which
  // are memoized) can read the latest value without re-creating.
  const micAllowedRef = useRef<boolean>(isTeacherRole);
  const camAllowedRef = useRef<boolean>(isTeacherRole);
  useEffect(() => { micAllowedRef.current = micAllowed; }, [micAllowed]);
  useEffect(() => { camAllowedRef.current = camAllowed; }, [camAllowed]);

  // Phase 36h-3+4 — Whiteboard state.
  // `whiteboardActive` is a UI flag so the parent ClassroomView knows when
  // to render the WhiteboardCanvas component (instead of, or on top of,
  // the video tiles).
  const [whiteboardActive, setWhiteboardActive] = useState<boolean>(false);
  // Phase 36h — classroom chat enabled/disabled by the teacher. Default
  // true (chat is open). When false, students can't send messages.
  const [chatEnabled, setChatEnabled] = useState<boolean>(true);
  // Callback registry — the WhiteboardCanvas component registers handlers
  // via the onWhiteboard* helpers below. The socket listeners (registered
  // in joinSession) read these refs + invoke the registered callback (if
  // any). Using refs (instead of state) so re-renders don't re-register
  // socket listeners.
  const onStrokeRef = useRef<((stroke: WhiteboardStroke) => void) | null>(null);
  const onClearRef = useRef<(() => void) | null>(null);
  const onRequestStateRef = useRef<((fromUserId: string) => void) | null>(null);
  const onFullStateRef = useRef<((strokes: WhiteboardStroke[]) => void) | null>(null);

  /* ---------- Local media helpers ---------- */

  /** Start the local camera + mic. Returns the stream (also stored in
   * localStreamRef + state). Throws a friendly Persian error when
   * getUserMedia fails. Phase 36: when `opts.video`/`opts.audio` are
   * false, getUserMedia is skipped entirely (no camera/mic permission
   * prompt) — used for students/principal who join with no media. */
  const startLocalMedia = useCallback(async (opts: { video: boolean; audio: boolean }) => {
    console.log("[classroom] startLocalMedia called with opts:", JSON.stringify(opts));
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      throw new Error("مرورگر شما از دوربین/میکروفون پشتیبانی نمی‌کند.");
    }
    // Phase 36 — if neither video nor audio is requested, skip getUserMedia
    // entirely. This avoids the browser permission prompt for students who
    // join with mic/cam off by default.
    if (!opts.video && !opts.audio) {
      console.log("[classroom] skipping getUserMedia — both video + audio are false (student/principal mode)");
      const empty = new MediaStream();
      localStreamRef.current = empty;
      setLocalStream(empty);
      setLocalError(null);
      setMicOn(false);
      setCamOn(false);
      return empty;
    }
    try {
      // Stop any existing local stream first.
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      console.log("[classroom] calling getUserMedia with video:", opts.video, "audio:", opts.audio);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: opts.video ? { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } } : false,
        audio: opts.audio ? { echoCancellation: true, noiseSuppression: true, autoGainControl: true } : false,
      });
      console.log("[classroom] getUserMedia success — tracks:", stream.getTracks().map(t => `${t.kind}:${t.enabled}`));
      localStreamRef.current = stream;
      setLocalStream(stream);
      setLocalError(null);
      // Sync the mic/cam state with what was actually granted.
      const hasVideo = stream.getVideoTracks().length > 0;
      const hasAudio = stream.getAudioTracks().length > 0;
      setMicOn(hasAudio);
      setCamOn(hasVideo);
      return stream;
    } catch (err: any) {
      const msg =
        err?.name === "NotAllowedError"
          ? "دسترسی به دوربین/میکروفون رد شد. لطفاً در تنظیمات مرورگر اجازه دهید."
          : err?.name === "NotFoundError"
            ? "دوربین یا میکروفون یافت نشد."
            : err?.name === "NotReadableError"
              ? "دوربین یا میکروفون توسط برنامه دیگری در حال استفاده است."
              : "خطا در راه‌اندازی دوربین/میکروفون.";
      setLocalError(msg);
      // Create an empty stream so the rest of the flow can still work
      // (the participant will appear with no video/audio).
      const empty = new MediaStream();
      localStreamRef.current = empty;
      setLocalStream(empty);
      setMicOn(false);
      setCamOn(false);
      return empty;
    }
  }, []);

  /** Stop the local stream + screen-share stream. */
  const stopLocalMedia = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    setLocalStream(null);
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    setScreenStream(null);
    setScreenSharing(false);
  }, []);

  /* ---------- WebRTC peer connection helpers ---------- */

  /** Create a new RTCPeerConnection for a remote peer. Adds the local
   * stream's tracks, sets up ICE candidate + track + connection-state
   * handlers, and stores it in peersRef. Phase 36 fix (B1): if we're
   * currently screen-sharing, replace the camera video track with the
   * screen track in this NEW peer so late-joining peers see the screen
   * (not the camera). */
  const createPeer = useCallback(
    async (remoteUserId: string): Promise<RTCPeerConnection> => {
      console.log(`[classroom] createPeer for ${remoteUserId}, localStream tracks:`, localStreamRef.current?.getTracks().length);
      // Phase 36m — fetch STUN/TURN config from settings (env-configurable).
      const iceServers = await getIceServers();
      const pc = new RTCPeerConnection({
        iceServers,
        iceTransportPolicy: "all",
      });
      // Add the local stream's tracks to the peer.
      const stream = localStreamRef.current;
      if (stream) {
        for (const track of stream.getTracks()) {
          pc.addTrack(track, stream);
          console.log(`[classroom] addTrack ${track.kind} enabled=${track.enabled} to peer ${remoteUserId}`);
        }
      }
      // Phase 36 fix (B1): if we're currently screen-sharing, replace the
      // camera video track with the screen track in this new peer
      // connection so late-joining peers see the screen (not the camera).
      if (screenStreamRef.current) {
        const screenTrack = screenStreamRef.current.getVideoTracks()[0];
        if (screenTrack) {
          const sender = pc.getSenders().find((s) => s.track?.kind === "video");
          if (sender) {
            void sender.replaceTrack(screenTrack).catch((e) => {
              console.error(`[classroom] createPeer replaceTrack failed for ${remoteUserId}:`, e);
            });
          }
        }
      }
      // ICE candidate — relay to the remote peer via the signaling server.
      pc.onicecandidate = (event) => {
        if (event.candidate && socketRef.current && sessionIdRef.current) {
          socketRef.current.emit("webrtc_ice_candidate", {
            to: remoteUserId,
            candidate: event.candidate.toJSON(),
          });
        }
      };
      // Remote track — when the remote peer adds a video/audio track, store
      // the incoming stream so the UI can render it.
      pc.ontrack = (event) => {
        console.log(`[classroom] ontrack from ${remoteUserId}: streams=${event.streams.length} tracks=${event.track.kind}`);
        const incoming = event.streams[0];
        setRemoteStreams((prev) => {
          const next = new Map(prev);
          next.set(remoteUserId, incoming);
          return next;
        });
      };
      // Connection state — log for debugging.
      pc.onconnectionstatechange = () => {
        console.log(`[classroom] peer ${remoteUserId} state: ${pc.connectionState}`);
      };
      pc.oniceconnectionstatechange = () => {
        console.log(`[classroom] peer ${remoteUserId} ICE state: ${pc.iceConnectionState}`);
      };
      peersRef.current.set(remoteUserId, pc);
      return pc;
    },
    [],
  );

  /** Initiate a WebRTC offer to a remote peer (called when a new
   * participant joins that has a LOWER userId than us — to avoid both
   * sides offering simultaneously). */
  const makeOffer = useCallback(
    async (remoteUserId: string) => {
      const socket = socketRef.current;
      if (!socket || !sessionIdRef.current) return;
      console.log(`[classroom] makeOffer to ${remoteUserId}`);
      let pc = peersRef.current.get(remoteUserId);
      if (!pc) pc = await createPeer(remoteUserId);
      try {
        const offer = await pc.createOffer({ offerToReceiveVideo: true, offerToReceiveAudio: true });
        await pc.setLocalDescription(offer);
        console.log(`[classroom] emit webrtc_offer to ${remoteUserId}`);
        socket.emit("webrtc_offer", { to: remoteUserId, sdp: offer });
      } catch (err) {
        console.error(`[classroom] makeOffer to ${remoteUserId} failed:`, err);
      }
    },
    [createPeer],
  );

  /** Tear down a single peer connection (when a participant leaves). */
  const closePeer = useCallback((remoteUserId: string) => {
    const pc = peersRef.current.get(remoteUserId);
    if (pc) {
      pc.close();
      peersRef.current.delete(remoteUserId);
    }
    setRemoteStreams((prev) => {
      const next = new Map(prev);
      next.delete(remoteUserId);
      return next;
    });
  }, []);

  /** Tear down ALL peer connections (when leaving the session). */
  const closeAllPeers = useCallback(() => {
    for (const [userId, pc] of peersRef.current.entries()) {
      pc.close();
      // (no need to update remoteStreams — we'll clear it next)
      void userId;
    }
    peersRef.current.clear();
    setRemoteStreams(new Map());
  }, []);

  /* ---------- Public actions ---------- */

  // The "removed" flag — set to true when a teacher removes the user
  // from the session. The parent component watches this state + reacts
  // (shows a "removed" dialog). Declared BEFORE joinSession because
  // joinSession's socket handler needs to call setRemovedFromSession.
  const [removedFromSession, setRemovedFromSession] = useState<boolean>(false);

  const joinSession = useCallback(
    async (sessionId: string, opts: { video: boolean; audio: boolean }) => {
      console.log("[classroom] joinSession called — user.role:", user.role, "opts:", JSON.stringify(opts));
      // Start local media first so peer connections can add tracks.
      await startLocalMedia(opts);
      sessionIdRef.current = sessionId;
      setConnectionState("connecting");

      const socket = io("/?XTransformPort=3004", {
        // SECURITY: the server verifies this short-lived JWT (issued by
        // /api/socket/token to our NextAuth session) — client-supplied
        // userId/role values are no longer trusted.
        auth: socketAuthCallback(),
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 2000,
        reconnectionDelayMax: 10000,
        timeout: 20000,
      });
      socketRef.current = socket;

      socket.on("connect", () => {
        setConnectionState("connected");
        // Emit join_session — the server will reply with `participants`
        // (the current list) + broadcast `participant_joined` to others.
        socket.emit("join_session", { sessionId });
      });
      socket.on("disconnect", () => setConnectionState("disconnected"));
      socket.on("connect_error", () => setConnectionState("error"));
      socket.on("reconnect_attempt", () => setConnectionState("reconnecting"));
      socket.on("reconnect", () => {
        setConnectionState("connected");
        // Re-join the session after a reconnect.
        if (sessionIdRef.current) {
          socket.emit("join_session", { sessionId: sessionIdRef.current });
        }
      });

      // ----- Signaling event handlers -----

      // The server sends the current participant list on join. For each
      // existing participant, we initiate a WebRTC offer (the newcomer
      // is responsible for connecting to existing peers).
      socket.on("participants", (list: Participant[]) => {
        setParticipants(list);
        // Phase 36 fix (B1): broadcast our ACTUAL mic/cam state to the
        // room. The server defaults newly-joined users to micOn=false,
        // camOn=false — so other participants won't see our camera/video
        // until we toggle. Emitting set_state here ensures others see
        // our real state immediately after we join.
        // Phase 36b: ALWAYS emit (even if stream is empty) so the server
        // has the correct state. Use a small delay to ensure the server
        // has finished processing our join_session before set_state.
        setTimeout(() => {
          const stream = localStreamRef.current;
          const hasAudio = !!stream?.getAudioTracks().some((t) => t.enabled);
          const hasVideo = !!stream?.getVideoTracks().some((t) => t.enabled);
          console.log(`[classroom] emitting set_state after join: micOn=${hasAudio} camOn=${hasVideo}`);
          socket.emit("set_state", { micOn: hasAudio, camOn: hasVideo });
        }, 300);
        // Initiate offers to all existing participants (mesh topology).
        for (const p of list) {
          if (p.userId !== user.id) {
            void makeOffer(p.userId);
          }
        }
      });

      socket.on("participant_joined", (p: Participant) => {
        console.log(`[classroom] participant_joined: ${p.userId} camOn=${p.camOn} micOn=${p.micOn}`);
        setParticipants((prev) => {
          if (prev.find((x) => x.userId === p.userId)) return prev;
          return [...prev, p];
        });
        // The newcomer will initiate the offer to us — we just wait for
        // their webrtc_offer. (No-op here.)
      });

      socket.on("participant_left", (p: { userId: string }) => {
        setParticipants((prev) => prev.filter((x) => x.userId !== p.userId));
        closePeer(p.userId);
        if (activeSpeakerId === p.userId) setActiveSpeakerId(null);
      });

      // Incoming WebRTC offer from a peer — create the peer (if needed),
      // set the remote description, create + send an answer.
      socket.on("webrtc_offer", async (payload: { from: string; sdp: RTCSessionDescriptionInit }) => {
        console.log(`[classroom] received webrtc_offer from ${payload.from}`);
        let pc = peersRef.current.get(payload.from);
        if (!pc) pc = await createPeer(payload.from);
        try {
          await pc.setRemoteDescription(payload.sdp);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          console.log(`[classroom] emit webrtc_answer to ${payload.from}`);
          socketRef.current?.emit("webrtc_answer", { to: payload.from, sdp: answer });
        } catch (err) {
          console.error("[classroom] webrtc_offer handler failed:", err);
        }
      });

      // Incoming WebRTC answer — set the remote description.
      socket.on("webrtc_answer", async (payload: { from: string; sdp: RTCSessionDescriptionInit }) => {
        console.log(`[classroom] received webrtc_answer from ${payload.from}`);
        const pc = peersRef.current.get(payload.from);
        if (!pc) {
          console.log(`[classroom] webrtc_answer: no peer for ${payload.from}`);
          return;
        }
        try {
          await pc.setRemoteDescription(payload.sdp);
        } catch (err) {
          console.error("[classroom] webrtc_answer handler failed:", err);
        }
      });

      // Incoming ICE candidate — add to the matching peer.
      socket.on("webrtc_ice_candidate", async (payload: { from: string; candidate: RTCIceCandidateInit }) => {
        const pc = peersRef.current.get(payload.from);
        if (!pc) return;
        try {
          await pc.addIceCandidate(payload.candidate);
        } catch (err) {
          console.error("[classroom] addIceCandidate failed:", err);
        }
      });

      // State update from a peer (mic/cam/screen-share/hand-raise toggle).
      // Phase 36 — also handles micAllowed/camAllowed updates from the
      // teacher's grant_access event.
      socket.on("participant_state", (p: Partial<Participant> & { userId: string }) => {
        console.log(`[classroom] received participant_state from ${p.userId}:`, JSON.stringify(p));
        setParticipants((prev) =>
          prev.map((x) => (x.userId === p.userId ? { ...x, ...p } : x)),
        );
      });

      // Phase 36 — Permission granted by the teacher. The teacher emitted
      // `grant_access` for us; the server relayed a `permission_granted`
      // event. We update our local micAllowed/camAllowed flag so the mic/cam
      // buttons become enabled.
      socket.on("permission_granted", (p: { byUserId?: string; byFullName?: string; mic?: boolean; cam?: boolean }) => {
        if (typeof p.mic === "boolean") setMicAllowed(p.mic);
        if (typeof p.cam === "boolean") setCamAllowed(p.cam);
        // If the teacher revoked permission, force the mic/cam off.
        if (p.mic === false) {
          const stream = localStreamRef.current;
          if (stream) stream.getAudioTracks().forEach((t) => (t.enabled = false));
          setMicOn(false);
        }
        if (p.cam === false) {
          const stream = localStreamRef.current;
          if (stream) stream.getVideoTracks().forEach((t) => (t.enabled = false));
          setCamOn(false);
        }
      });

      // Active speaker change — update the speaker view.
      socket.on("active_speaker", (p: { userId: string; isSpeaking: boolean }) => {
        setParticipants((prev) =>
          prev.map((x) => (x.userId === p.userId ? { ...x, isSpeaking: p.isSpeaking } : x)),
        );
        if (p.isSpeaking) {
          setActiveSpeakerId(p.userId);
        } else if (activeSpeakerId === p.userId) {
          setActiveSpeakerId(null);
        }
      });

      // Classroom chat message (broadcast).
      socket.on("classroom_message", (m: ClassroomMessage) => {
        setMessages((prev) => [...prev, m].slice(-200));
      });

      // Private message (DM within the classroom).
      socket.on("private_message", (m: PrivateMessage) => {
        setPrivateMessages((prev) => [...prev, m].slice(-200));
      });

      // Reaction emoji — show briefly as a floating bubble on the sender's tile.
      socket.on("reaction", (r: { userId: string; emoji: string; at: number }) => {
        setParticipants((prev) =>
          prev.map((x) =>
            x.userId === r.userId ? { ...x, lastReaction: { emoji: r.emoji, at: r.at } } : x,
          ),
        );
        // Clear the reaction after 3s.
        setTimeout(() => {
          setParticipants((prev) =>
            prev.map((x) =>
              x.userId === r.userId && x.lastReaction?.at === r.at
                ? { ...x, lastReaction: undefined }
                : x,
            ),
          );
        }, 3000);
      });

      // Forced mute from a teacher — turn off the local mic + disable the
      // toggle for a few seconds (the user can re-enable after a short cooldown).
      socket.on("mute_user", () => {
        setForceMuted(true);
        const stream = localStreamRef.current;
        if (stream) {
          stream.getAudioTracks().forEach((t) => (t.enabled = false));
        }
        setMicOn(false);
        // Re-enable the toggle after 3s.
        setTimeout(() => setForceMuted(false), 3000);
      });

      // Removed from the session by a teacher — set the `removedFromSession`
      // flag. The parent component's useEffect watches this state + reacts
      // (shows a "removed" dialog + tears down the local media).
      socket.on("removed_from_session", () => {
        setRemovedFromSession(true);
      });

      // ----- Phase 36h-3+4 — Whiteboard event listeners -----
      // These read the callback refs (set by the WhiteboardCanvas
      // component via the onWhiteboard* helpers). The socket listeners
      // are registered ONCE per join (here, inside joinSession); the
      // callbacks can change without re-registering.
      socket.on("whiteboard_stroke", (payload: { stroke: WhiteboardStroke }) => {
        if (!payload?.stroke) return;
        onStrokeRef.current?.(payload.stroke);
      });
      socket.on("whiteboard_clear", () => {
        onClearRef.current?.();
      });
      // Teacher-only — a student just joined + the server is asking us
      // for the current whiteboard state. We respond via
      // `sendWhiteboardFullState` (which emits `whiteboard_full_state`
      // with the student's userId as `toUserId`).
      socket.on("whiteboard_request_state", (payload: { fromUserId: string }) => {
        if (!payload?.fromUserId) return;
        onRequestStateRef.current?.(payload.fromUserId);
      });
      // Student-only — the teacher sent us the full whiteboard state (in
      // response to our implicit request when we joined). Replace our
      // local strokes list with this snapshot.
      socket.on("whiteboard_full_state", (payload: { strokes: WhiteboardStroke[] }) => {
        if (!Array.isArray(payload?.strokes)) return;
        onFullStateRef.current?.(payload.strokes);
      });

      // Phase 36h — Teacher toggled our mic/cam from the participants panel.
      // We call setMic/setCam to toggle the actual media track + emit our
      // new state. (The server already broadcast participant_state to the
      // room, so other participants see the change.)
      socket.on("force_toggle_media", (p: { byUserId?: string; mic?: boolean; cam?: boolean }) => {
        if (typeof p.mic === "boolean") {
          // Force-set mic (bypass the micAllowed check since the teacher
          // explicitly requested it — the server already auto-granted
          // permission if needed).
          const stream = localStreamRef.current;
          if (stream) stream.getAudioTracks().forEach((t) => (t.enabled = p.mic!));
          setMicOn(p.mic);
        }
        if (typeof p.cam === "boolean") {
          const stream = localStreamRef.current;
          if (stream) stream.getVideoTracks().forEach((t) => (t.enabled = p.cam!));
          setCamOn(p.cam);
        }
      });

      // Phase 36h — Teacher enabled/disabled the classroom chat. Update
      // local state (the chat panel checks this to enable/disable the
      // input for students).
      socket.on("chat_enabled", (p: { enabled: boolean; byUserId?: string }) => {
        setChatEnabled(!!p.enabled);
      });
    },
    [startLocalMedia, makeOffer, closePeer, user, activeSpeakerId],
  );

  const leaveSession = useCallback(() => {
    const socket = socketRef.current;
    if (socket && sessionIdRef.current) {
      socket.emit("leave_session");
    }
    closeAllPeers();
    stopLocalMedia();
    sessionIdRef.current = null;
    setParticipants([]);
    setMessages([]);
    setPrivateMessages([]);
    setActiveSpeakerId(null);
    // Phase 36h-3+4 — reset whiteboard UI flag on leave.
    setWhiteboardActive(false);
    setConnectionState("disconnected");
    if (socket) {
      socket.disconnect();
      socketRef.current = null;
    }
  }, [closeAllPeers, stopLocalMedia]);

  /* ---------- Local state toggles ---------- */

  const setMic = useCallback((on: boolean) => {
    if (forceMuted) return; // teacher-muted — ignore
    // Phase 36 — students need micAllowed=true before they can turn on
    // their mic. Teachers always have micAllowed=true.
    if (on && !micAllowedRef.current) return;
    const stream = localStreamRef.current;
    if (stream) {
      stream.getAudioTracks().forEach((t) => (t.enabled = on));
    }
    setMicOn(on);
    socketRef.current?.emit("set_state", { micOn: on });
  }, [forceMuted]);

  const setCam = useCallback((on: boolean) => {
    // Phase 36 — students need camAllowed=true before they can turn on
    // their cam. Teachers always have camAllowed=true.
    if (on && !camAllowedRef.current) return;
    const stream = localStreamRef.current;
    if (stream) {
      stream.getVideoTracks().forEach((t) => (t.enabled = on));
    }
    setCamOn(on);
    socketRef.current?.emit("set_state", { camOn: on });
  }, []);


  const toggleScreenShare = useCallback(async (on: boolean) => {
    if (on) {
      // Start screen share.
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getDisplayMedia) {
        return;
      }
      try {
        // Phase 36h — audio: true so the teacher can share system audio
        // (desktop audio). The user can check "Share audio" in the browser
        // prompt. If granted, the audio track is added to peer connections.
        const screen = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: 30 },
          audio: true,
        });
        screenStreamRef.current = screen;
        setScreenStream(screen);
        setScreenSharing(true);
        socketRef.current?.emit("set_state", { screenSharing: true });

        // Phase 35f fix: replace the video track in ALL existing peer
        // connections so remote peers see the screen (not the camera).
        // Uses RTCRtpSender.replaceTrack() — this is the standard WebRTC
        // way to swap a track without renegotiating SDP.
        const screenTrack = screen.getVideoTracks()[0];
        if (screenTrack) {
          for (const [peerId, pc] of peersRef.current.entries()) {
            const sender = pc.getSenders().find((s) => s.track?.kind === "video");
            if (sender) {
              try { await sender.replaceTrack(screenTrack); } catch (e) { console.error(`[classroom] replaceTrack failed for peer ${peerId}:`, e); }
            }
          }
        }

        // Phase 36h — if the screen share includes a system audio track,
        // add it to all peer connections (so students hear the desktop
        // audio). We add it as a NEW track (not replacing the mic track,
        // since the teacher's mic should still work).
        const screenAudioTrack = screen.getAudioTracks()[0];
        if (screenAudioTrack) {
          for (const [peerId, pc] of peersRef.current.entries()) {
            // Check if this peer already has an audio sender for the
            // screen audio (avoid duplicates).
            const hasScreenAudio = pc.getSenders().some(
              (s) => s.track === screenAudioTrack
            );
            if (!hasScreenAudio) {
              try {
                pc.addTrack(screenAudioTrack, screen);
              } catch (e) {
                console.error(`[classroom] addTrack screenAudio failed for peer ${peerId}:`, e);
              }
            }
          }
          console.log("[classroom] screen share includes system audio — added to peers");
        }

        // When the user stops sharing via the browser's native "Stop sharing"
        // button, we detect it via the track's onended event.
        screen.getVideoTracks()[0].onended = () => {
          screenStreamRef.current?.getTracks().forEach((t) => t.stop());
          screenStreamRef.current = null;
          setScreenStream(null);
          setScreenSharing(false);
          socketRef.current?.emit("set_state", { screenSharing: false });

          // Restore the camera track in all peer connections.
          const camTrack = localStreamRef.current?.getVideoTracks()[0];
          if (camTrack) {
            for (const [peerId, pc] of peersRef.current.entries()) {
              const sender = pc.getSenders().find((s) => s.track?.kind === "video");
              if (sender) {
                try { void sender.replaceTrack(camTrack); } catch (e) { console.error(`[classroom] restoreTrack failed for peer ${peerId}:`, e); }
              }
            }
          }
        };
      } catch (err) {
        console.error("[classroom] getDisplayMedia failed:", err);
      }
    } else {
      // Stop screen share.
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
      setScreenStream(null);
      setScreenSharing(false);
      socketRef.current?.emit("set_state", { screenSharing: false });

      // Restore the camera track in all peer connections.
      const camTrack = localStreamRef.current?.getVideoTracks()[0];
      if (camTrack) {
        for (const [peerId, pc] of peersRef.current.entries()) {
          const sender = pc.getSenders().find((s) => s.track?.kind === "video");
          if (sender) {
            try { void sender.replaceTrack(camTrack); } catch (e) { console.error(`[classroom] restoreTrack failed for peer ${peerId}:`, e); }
          }
        }
      }
    }
  }, []);

  const raiseHand = useCallback((on: boolean) => {
    setHandRaised(on);
    socketRef.current?.emit("set_state", { handRaised: on });
  }, []);

  /* ---------- Active speaker detection (local) ---------- */
  // Use the WebRTC audio-level detection via the AnalyserNode on the
  // local stream. When the user starts speaking, emit `speaking=true`;
  // when they stop, emit `speaking=false`. Throttled to ~250ms to
  // avoid flooding the server.
  useEffect(() => {
    if (!localStream || !micOn) return;
    // Phase 35f fix: guard against streams with no audio tracks (e.g., when
    // getUserMedia failed to get a mic). createMediaStreamSource crashes
    // with "MediaStream has no audio tracks" if there are none.
    if (localStream.getAudioTracks().length === 0) return;
    const AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(localStream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    let speaking = false;
    let lastEmit = 0;
    const interval = setInterval(() => {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      const newSpeaking = avg > 20;
      if (newSpeaking !== speaking || (newSpeaking && Date.now() - lastEmit > 1000)) {
        speaking = newSpeaking;
        lastEmit = Date.now();
        socketRef.current?.emit("speaking", { isSpeaking: speaking });
        if (speaking) setActiveSpeakerId(user.id);
      }
    }, 250);
    return () => {
      clearInterval(interval);
      ctx.close();
    };
  }, [localStream, micOn, user.id]);

  /* ---------- Chat + reactions + teacher controls ---------- */

  const sendMessage = useCallback((content: string, replyToId?: string | null) => {
    if (!content.trim()) return;
    socketRef.current?.emit("classroom_message", {
      content: content.trim().slice(0, 1000),
      replyToId: replyToId ?? null,
    });
  }, []);

  const sendPrivateMessage = useCallback((toUserId: string, content: string) => {
    if (!content.trim()) return;
    socketRef.current?.emit("private_message", {
      to: toUserId,
      content: content.trim().slice(0, 1000),
    });
  }, []);

  const sendReaction = useCallback((emoji: string) => {
    socketRef.current?.emit("reaction", { emoji });
  }, []);

  const muteUser = useCallback((userId: string) => {
    socketRef.current?.emit("mute_user", { userId });
  }, []);

  const removeUser = useCallback((userId: string) => {
    socketRef.current?.emit("remove_user", { userId });
  }, []);

  // Phase 36 — Teacher grants or revokes mic/cam permission for a student/
  // principal. Emits `grant_access` to the server, which validates the
  // sender is a TEACHER + relays a `permission_granted` event to the target.
  const grantAccess = useCallback((userId: string, opts: { mic?: boolean; cam?: boolean }) => {
    socketRef.current?.emit("grant_access", { userId, ...opts });
  }, []);

  // Phase 36h — Teacher toggles a student's mic/cam by clicking the mic/cam
  // icon in the participants panel. Emits `toggle_user_media` to the server,
  // which validates the sender is a teacher, auto-grants permission if
  // needed, + relays `force_toggle_media` to the target student.
  const toggleUserMedia = useCallback((userId: string, opts: { mic?: boolean; cam?: boolean }) => {
    socketRef.current?.emit("toggle_user_media", { userId, ...opts });
  }, []);

  // Phase 36h — Teacher enables/disables the classroom chat for students.
  // Emits `set_chat_enabled` to the server, which broadcasts `chat_enabled`
  // to the room. Students' chat input is disabled when chat is off.
  const setClassroomChatEnabled = useCallback((enabled: boolean) => {
    setChatEnabled(enabled);
    socketRef.current?.emit("set_chat_enabled", { enabled });
  }, []);

  /* ---------- Phase 36h-3+4 — Whiteboard actions ---------- */

  // UI toggle — when true, the parent ClassroomView renders the
  // WhiteboardCanvas component (instead of, or on top of, the video tiles).
  const toggleWhiteboard = useCallback((on: boolean) => {
    setWhiteboardActive(on);
  }, []);

  // Teacher emits a finished stroke. The server relays it to OTHER sockets
  // in the room (students). The teacher also renders it locally.
  const sendWhiteboardStroke = useCallback((stroke: WhiteboardStroke) => {
    socketRef.current?.emit("whiteboard_stroke", { stroke });
  }, []);

  // Teacher clears the whiteboard. The server relays to students.
  const sendWhiteboardClear = useCallback(() => {
    socketRef.current?.emit("whiteboard_clear", {});
  }, []);

  // Teacher responds to a `whiteboard_request_state` (server asked us for
  // the current state because a student just joined). We emit the full list
  // of strokes; the server relays to the requesting student only.
  const sendWhiteboardFullState = useCallback((toUserId: string, strokes: WhiteboardStroke[]) => {
    socketRef.current?.emit("whiteboard_full_state", { toUserId, strokes });
  }, []);

  // Register a callback for incoming stroke broadcasts (students).
  // Returns an unsubscribe function.
  const onWhiteboardStroke = useCallback((cb: (stroke: WhiteboardStroke) => void) => {
    onStrokeRef.current = cb;
    return () => { if (onStrokeRef.current === cb) onStrokeRef.current = null; };
  }, []);

  // Register a callback for incoming clear broadcasts (students).
  const onWhiteboardClear = useCallback((cb: () => void) => {
    onClearRef.current = cb;
    return () => { if (onClearRef.current === cb) onClearRef.current = null; };
  }, []);

  // Register a callback for incoming state requests (teacher). The teacher
  // responds by calling `sendWhiteboardFullState(fromUserId, strokes)`.
  const onWhiteboardRequestState = useCallback((cb: (fromUserId: string) => void) => {
    onRequestStateRef.current = cb;
    return () => { if (onRequestStateRef.current === cb) onRequestStateRef.current = null; };
  }, []);

  // Register a callback for incoming full-state snapshots (students). Called
  // once when the student joins (the teacher responds to the server's
  // whiteboard_request_state). Replaces the student's local strokes list.
  const onWhiteboardFullState = useCallback((cb: (strokes: WhiteboardStroke[]) => void) => {
    onFullStateRef.current = cb;
    return () => { if (onFullStateRef.current === cb) onFullStateRef.current = null; };
  }, []);

  /* ---------- Cleanup on unmount ---------- */
  useEffect(() => {
    return () => {
      // Tear down everything if the component unmounts while still in a
      // session (e.g. user closes the dialog without clicking "Leave").
      if (socketRef.current) {
        try {
          socketRef.current.emit("leave_session");
          socketRef.current.disconnect();
        } catch { /* ignore */ }
      }
      closeAllPeers();
      stopLocalMedia();
    };
  }, []);

  return {
    // State
    connectionState,
    localStream,
    screenStream,
    localError,
    participants,
    remoteStreams,
    messages,
    privateMessages,
    activeSpeakerId,
    micOn,
    camOn,
    screenSharing,
    handRaised,
    forceMuted,
    // Phase 36 — mic/cam permissions (for the local user).
    micAllowed,
    camAllowed,
    // Phase 36h-3+4 — whiteboard UI flag (true = show whiteboard).
    whiteboardActive,
    // Phase 36h — classroom chat enabled/disabled by the teacher.
    chatEnabled,
    // Actions
    joinSession,
    leaveSession,
    setMic,
    setCam,
    toggleScreenShare,
    raiseHand,
    sendMessage,
    sendPrivateMessage,
    sendReaction,
    muteUser,
    removeUser,
    grantAccess,
    // Phase 36h — teacher toggles a student's mic/cam from the participants panel.
    toggleUserMedia,
    // Phase 36h — teacher enables/disables classroom chat.
    setClassroomChatEnabled,
    // Phase 36h-3+4 — whiteboard actions.
    toggleWhiteboard,
    sendWhiteboardStroke,
    sendWhiteboardClear,
    sendWhiteboardFullState,
    onWhiteboardStroke,
    onWhiteboardClear,
    onWhiteboardRequestState,
    onWhiteboardFullState,
    removedFromSession,
  };
}
