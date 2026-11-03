/**
 * The presentation's voice played as a call's. A browser takes out of the
 * microphone what it knows it plays (echo cancellation), and each knows
 * what a call (WebRTC) plays; Chrome may not know an <audio> element's,
 * whose voice then reached the agent as the member's words. So the voice
 * goes through a call the page makes with itself, and comes out of the
 * speakers as the call's. Without it, the element plays as it would.
 * Returns what hangs it up.
 */
export async function asCall(audio: HTMLAudioElement): Promise<() => void> {
  const peers: RTCPeerConnection[] = [];
  const speaker = new Audio();
  let context: AudioContext | null = null;
  const hangUp = () => {
    speaker.srcObject = null;
    for (const peer of peers) peer.close();
    void context?.close().catch(() => {});
  };
  try {
    // Made at once, while the click that started it still counts.
    context = new AudioContext();
    const source = context.createMediaElementSource(audio);
    try {
      const out = context.createMediaStreamDestination();
      source.connect(out);
      const sending = new RTCPeerConnection();
      const receiving = new RTCPeerConnection();
      peers.push(sending, receiving);
      sending.onicecandidate = ({ candidate }) => {
        if (candidate)
          void receiving.addIceCandidate(candidate).catch(() => {});
      };
      receiving.onicecandidate = ({ candidate }) => {
        if (candidate) void sending.addIceCandidate(candidate).catch(() => {});
      };
      const heard = new Promise<MediaStreamTrack>((resolve) => {
        receiving.ontrack = ({ track }) => resolve(track);
      });
      sending.addTrack(out.stream.getAudioTracks()[0]!, out.stream);
      await within(3000, async () => {
        await sending.setLocalDescription();
        await receiving.setRemoteDescription(sending.localDescription!);
        await receiving.setLocalDescription();
        await sending.setRemoteDescription(receiving.localDescription!);
        speaker.srcObject = new MediaStream([await heard]);
        await speaker.play();
      });
    } catch {
      // No call: straight to the speakers.
      for (const peer of peers) peer.close();
      speaker.srcObject = null;
      source.disconnect();
      source.connect(context.destination);
    }
    // Never waited for: a context the browser holds back would hold the voice.
    void context.resume().catch(() => {});
  } catch {
    // No Web Audio: the element plays by itself.
  }
  return hangUp;
}

/**
 * The call's microphone: a line of its own, silent until the member's is
 * plugged into it. What they write goes through the same call as what they
 * say, the voice and the gestures in step either way, and no browser asks
 * for the microphone until they do.
 */
export function micLine() {
  // Taken now: during `onLine`, the page's asking gets the line itself.
  const ask = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  const context = new AudioContext();
  const line = context.createMediaStreamDestination();
  let plugged: { stream: MediaStream; node: AudioNode } | null = null;
  const unplug = () => {
    plugged?.node.disconnect();
    for (const track of plugged?.stream.getTracks() ?? []) track.stop();
    plugged = null;
  };
  return {
    stream: line.stream,
    async plug() {
      if (plugged) return;
      const stream = await ask({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const node = context.createMediaStreamSource(stream);
      node.connect(line);
      plugged = { stream, node };
      await context.resume();
    },
    unplug,
    close() {
      unplug();
      void context.close().catch(() => {});
    },
  };
}

/** While `work` runs, the page's asking for the microphone gets this line. */
export async function onLine<T>(
  stream: MediaStream,
  work: () => Promise<T>,
): Promise<T> {
  const devices = navigator.mediaDevices;
  const ask = devices.getUserMedia;
  devices.getUserMedia = () => Promise.resolve(stream.clone());
  try {
    return await work();
  } finally {
    devices.getUserMedia = ask;
  }
}

async function within(ms: number, work: () => Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timed out")), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
