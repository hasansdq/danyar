/**
 * اتصال WebRTC هم‌تا با الگوی Perfect Negotiation
 * - هر شرکت‌کننده یک PeerBox؛ نقش polite بر اساس مقایسه شناسه (قطعی و دوطرفه یکسان)
 * - نگاشت mid → کاربرد ترک (mic/camera/screen) برای تفکیک اشتراک صفحه از دوربین
 * - بافر ICE تا رسیدن remote description
 */

export type TrackPurpose = 'mic' | 'camera' | 'screen'

export interface TrackMapEntry {
  mid: string
  purpose: TrackPurpose
}

export interface PeerBoxEvents {
  onSignal: (event: string, payload: Record<string, unknown>) => void
  onRemotePurpose: (purpose: TrackPurpose, stream: MediaStream | null) => void
  onState: (state: RTCPeerConnectionState) => void
}

export class PeerBox {
  readonly peerUserId: string
  readonly pc: RTCPeerConnection
  private polite: boolean
  private makingOffer = false
  private ignoreOffer = false
  private srdAnswerPending = false
  private pendingCandidates: RTCIceCandidate[] = []
  private targetSocketId: string
  private ev: PeerBoxEvents
  /** نگاشت mid ترنسیور مقصد → کاربرد ترک */
  private remoteMidPurpose = new Map<string, TrackPurpose>()
  /** جریان‌های ساخته‌شده برای هر کاربرد */
  private purposeStreams = new Map<TrackPurpose, MediaStream>()
  /** کاربرد ترک‌های محلی خودم (برای ارسال track-map) */
  private localSenderPurpose = new Map<RTCRtpSender, TrackPurpose>()

  constructor(
    peerUserId: string,
    myUserId: string,
    targetSocketId: string,
    iceServers: RTCIceServerLike[],
    ev: PeerBoxEvents,
  ) {
    this.peerUserId = peerUserId
    this.targetSocketId = targetSocketId
    this.ev = ev
    this.polite = myUserId < peerUserId
    this.pc = new RTCPeerConnection({
      iceServers: iceServers as RTCIceServer[],
      bundlePolicy: 'max-bundle',
    })

    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this.ev.onSignal('webrtc:ice', { to: this.targetSocketId, candidate: candidate.toJSON() })
      }
    }
    this.pc.ontrack = this.handleTrack
    this.pc.onnegotiationneeded = () => void this.handleNegotiationNeeded()
    this.pc.onconnectionstatechange = () => this.ev.onState(this.pc.connectionState)
  }

  get connectionState() {
    return this.pc.connectionState
  }

  private async handleNegotiationNeeded() {
    try {
      this.makingOffer = true
      await this.pc.setLocalDescription()
      if (this.pc.localDescription) {
        this.ev.onSignal('webrtc:offer', {
          to: this.targetSocketId,
          description: {
            type: this.pc.localDescription.type,
            sdp: this.pc.localDescription.sdp,
          },
        })
        this.emitLocalTrackMap()
      }
    } catch (err) {
      console.error('negotiation error', err)
    } finally {
      this.makingOffer = false
    }
  }

  /** افزودن ترک محلی با برچسب کاربرد (برای نگاشت مقصد) */
  addLocalTrack(track: MediaStreamTrack, purpose: TrackPurpose) {
    const sender = this.pc.addTrack(track, new MediaStream([track]))
    this.localSenderPurpose.set(sender, purpose)
  }

  /** حذف ترک محلی (پایان اشتراک صفحه) */
  removeLocalTrack(track: MediaStreamTrack) {
    const sender = this.pc.getSenders().find((s) => s.track === track)
    if (sender) {
      this.localSenderPurpose.delete(sender)
      try {
        this.pc.removeTrack(sender)
      } catch {
        /* ignore */
      }
    }
  }

  /** ارسال نگاشت mid → کاربرد ترک‌های محلی به مقصد */
  private emitLocalTrackMap() {
    const mids: TrackMapEntry[] = []
    for (const trans of this.pc.getTransceivers()) {
      const purpose = trans.sender && this.localSenderPurpose.get(trans.sender)
      if (purpose && trans.mid !== null) {
        mids.push({ mid: trans.mid, purpose })
      }
    }
    this.ev.onSignal('live:track-map', { to: this.targetSocketId, mids })
  }

  /** دریافت نگاشت mid → کاربرد از طرف مقصد و اصلاح جریان‌ها */
  applyRemoteTrackMap(mids: TrackMapEntry[]) {
    for (const { mid, purpose } of mids) {
      const prev = this.remoteMidPurpose.get(mid)
      this.remoteMidPurpose.set(mid, purpose)
      if (prev && prev !== purpose) this.reassignMid(mid, prev, purpose)
    }
  }

  private receiversByMid() {
    const map = new Map<string, MediaStreamTrack>()
    for (const trans of this.pc.getTransceivers()) {
      if (trans.mid !== null && trans.receiver.track) {
        map.set(trans.mid, trans.receiver.track)
      }
    }
    return map
  }

  private reassignMid(mid: string, from: TrackPurpose, to: TrackPurpose) {
    const track = this.receiversByMid().get(mid)
    if (!track) return
    const fromStream = this.purposeStreams.get(from)
    if (fromStream) {
      fromStream.removeTrack(track)
      if (fromStream.getTracks().length === 0) {
        this.purposeStreams.delete(from)
        this.ev.onRemotePurpose(from, null)
      } else {
        this.ev.onRemotePurpose(from, fromStream)
      }
    }
    let toStream = this.purposeStreams.get(to)
    if (!toStream) {
      toStream = new MediaStream()
      this.purposeStreams.set(to, toStream)
    }
    toStream.addTrack(track)
    this.ev.onRemotePurpose(to, toStream)
  }

  private handleTrack = (event: RTCTrackEvent) => {
    const mid = event.transceiver.mid ?? ''
    const purpose = this.remoteMidPurpose.get(mid) ?? (event.track.kind === 'audio' ? 'mic' : 'camera')
    this.remoteMidPurpose.set(mid, purpose)
    let stream = this.purposeStreams.get(purpose)
    if (!stream) {
      stream = new MediaStream()
      this.purposeStreams.set(purpose, stream)
    }
    if (!stream.getTracks().includes(event.track)) stream.addTrack(event.track)
    this.ev.onRemotePurpose(purpose, stream)
  }

  /** دریافت offer/answer با perfect negotiation */
  async onRemoteDescription(description: RTCSessionDescriptionInit) {
    if (!description || typeof description.sdp !== 'string' || !description.type) return
    const desc = description as { type: RTCSdpType; sdp: string }
    const readyForOffer = !this.makingOffer && (this.pc.signalingState === 'stable' || this.isSettingRemoteAnswerPending)
    const offerCollision = description.type === 'offer' && !readyForOffer
    this.ignoreOffer = !this.polite && offerCollision
    if (this.ignoreOffer) return

    this.isSettingRemoteAnswerPending = desc.type === 'answer'
    await this.pc.setRemoteDescription(desc)
    this.isSettingRemoteAnswerPending = false

    const pending = this.pendingCandidates
    this.pendingCandidates = []
    for (const c of pending) {
      try {
        await this.pc.addIceCandidate(c)
      } catch {
        /* ignore */
      }
    }

    if (desc.type === 'offer') {
      await this.pc.setLocalDescription()
      if (this.pc.localDescription) {
        this.ev.onSignal('webrtc:answer', {
          to: this.targetSocketId,
          description: {
            type: this.pc.localDescription.type,
            sdp: this.pc.localDescription.sdp,
          },
        })
        this.emitLocalTrackMap()
      }
    }
  }

  private isSettingRemoteAnswerPending = false

  async onRemoteCandidate(candidate: RTCIceCandidateInit) {
    try {
      if (!this.pc.remoteDescription) {
        this.pendingCandidates.push(new RTCIceCandidate(candidate))
      } else {
        await this.pc.addIceCandidate(new RTCIceCandidate(candidate))
      }
    } catch {
      /* ignore */
    }
  }

  close() {
    try {
      this.pc.onicecandidate = null
      this.pc.ontrack = null
      this.pc.onnegotiationneeded = null
      this.pc.onconnectionstatechange = null
      this.pc.close()
    } catch {
      /* ignore */
    }
    for (const [, stream] of this.purposeStreams) {
      for (const t of stream.getTracks()) {
        // ترک‌های مقصد متعلق به ما نیستند؛ فقط جریان خالی شود
        void t
      }
    }
  }
}

interface RTCIceServerLike {
  urls: string | string[]
  username?: string
  credential?: string
}
