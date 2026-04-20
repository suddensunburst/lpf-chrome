let audioCtx = null;
let currentStream = null;
let sourceNode = null;
let chainNodes = [];

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'START_PROCESSING') startProcessing(msg.streamId, msg.intensity);
  if (msg.type === 'STOP_PROCESSING') stopProcessing();
  if (msg.type === 'UPDATE_INTENSITY') rebuildChain(msg.intensity);
});

async function startProcessing(streamId, intensity) {
  stopProcessing();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId
        }
      },
      video: false
    });

    currentStream = stream;

    // ストリームが切れたらbackgroundに通知して自動再接続させる
    stream.getTracks().forEach(track => {
      track.onended = () => {
        chrome.runtime.sendMessage({type: 'STREAM_ENDED'});
      };
    });

    audioCtx = new AudioContext();

    // AudioContextが停止した場合も通知
    audioCtx.onstatechange = () => {
      if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {
          chrome.runtime.sendMessage({type: 'STREAM_ENDED'});
        });
      }
    };

    sourceNode = audioCtx.createMediaStreamSource(stream);
    buildChain(intensity);
  } catch (e) {
    console.error('[ClassroomSpeaker] Audio capture failed:', e);
    chrome.runtime.sendMessage({type: 'STREAM_ENDED'});
  }
}

function rebuildChain(intensity) {
  if (!sourceNode || !audioCtx) return;
  chainNodes.forEach(n => { try { n.disconnect(); } catch (_) {} });
  chainNodes = [];
  try { sourceNode.disconnect(); } catch (_) {}
  buildChain(intensity);
}

function buildChain(intensity) {
  const int = Math.max(0, Math.min(1, intensity));

  const hp = audioCtx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 150 + int * 100;

  const lp = audioCtx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 4000 - int * 1500;
  lp.Q.value = 0.5 + int * 1.5;

  const dist = audioCtx.createWaveShaper();
  const k = int * 8;
  const curve = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const x = (i * 2) / 256 - 1;
    curve[i] = k > 0 ? ((Math.PI + k) * x) / (Math.PI + k * Math.abs(x)) : x;
  }
  dist.curve = curve;
  dist.oversample = '2x';

  const comp = audioCtx.createDynamicsCompressor();
  comp.threshold.value = -18 - int * 6;
  comp.ratio.value = 3 + int * 4;
  comp.attack.value = 0.003;
  comp.release.value = 0.15;

  const conv = audioCtx.createConvolver();
  conv.buffer = makeRoomIR(audioCtx, int * 0.8);

  const dryGain = audioCtx.createGain();
  dryGain.gain.value = 1 - int * 0.35;

  const wetGain = audioCtx.createGain();
  wetGain.gain.value = int * 0.3;

  const out = audioCtx.createGain();
  out.gain.value = 1.2 + int * 0.3;

  sourceNode.connect(hp);
  hp.connect(lp);
  lp.connect(comp);
  comp.connect(dist);
  dist.connect(dryGain);
  dist.connect(conv);
  conv.connect(wetGain);
  dryGain.connect(out);
  wetGain.connect(out);
  out.connect(audioCtx.destination);

  chainNodes = [hp, lp, dist, comp, conv, dryGain, wetGain, out];
}

function stopProcessing() {
  chainNodes.forEach(n => { try { n.disconnect(); } catch (_) {} });
  chainNodes = [];
  if (sourceNode) { try { sourceNode.disconnect(); } catch (_) {} sourceNode = null; }
  if (currentStream) { currentStream.getTracks().forEach(t => t.stop()); currentStream = null; }
  if (audioCtx) { audioCtx.close(); audioCtx = null; }
}

function makeRoomIR(ctx, size) {
  const len = Math.floor(ctx.sampleRate * (0.08 + size * 0.5));
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2 + size * 3);
    }
  }
  return buf;
}
