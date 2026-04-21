let audioCtx = null;
let currentStream = null;
let sourceNode = null;
let chainNodes = [];
let currentIntensity = 0.6;
let currentEchoLevel = 0.6;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'START_PROCESSING') startProcessing(msg.streamId, msg.intensity, msg.echoLevel ?? 0.6);
  if (msg.type === 'STOP_PROCESSING') stopProcessing();
  if (msg.type === 'UPDATE_INTENSITY') { currentIntensity = msg.intensity; rebuildChain(); }
  if (msg.type === 'UPDATE_ECHO')      { currentEchoLevel = msg.echoLevel;  rebuildChain(); }
});

chrome.runtime.sendMessage({type: 'OFFSCREEN_READY'});

async function startProcessing(streamId, intensity, echoLevel) {
  currentIntensity = intensity;
  currentEchoLevel = echoLevel;
  stopProcessing();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
      video: false
    });
    currentStream = stream;
    stream.getTracks().forEach(t => {
      t.onended = () => chrome.runtime.sendMessage({type: 'STREAM_ENDED'});
    });
    audioCtx = new AudioContext();
    audioCtx.onstatechange = () => {
      if (audioCtx?.state === 'suspended') {
        audioCtx.resume().catch(() => chrome.runtime.sendMessage({type: 'STREAM_ENDED'}));
      }
    };
    sourceNode = audioCtx.createMediaStreamSource(stream);
    buildChain(currentIntensity, currentEchoLevel);
  } catch (e) {
    console.error('[ClassroomSpeaker]', e);
    chrome.runtime.sendMessage({type: 'STREAM_ENDED'});
  }
}

function rebuildChain() {
  if (!sourceNode || !audioCtx) return;
  try { sourceNode.disconnect(); } catch (_) {}
  chainNodes.forEach(n => { try { n.disconnect(); } catch (_) {} });
  chainNodes = [];
  buildChain(currentIntensity, currentEchoLevel);
}

function buildChain(intensity, echoLevel) {
  const int = Math.max(0, Math.min(1, intensity));


  const hp = audioCtx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 20 + int * 315;

  const lp = audioCtx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 20000 / (1 + int * 7.5);
  lp.Q.value = int * 2;

  const comp = audioCtx.createDynamicsCompressor();
  comp.threshold.value = -int * 40;
  comp.ratio.value = 1 + int * 10;
  comp.attack.value = 0.003;
  comp.release.value = 0.15;

  const dist = audioCtx.createWaveShaper();
  const k = int * 8;
  const curve = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const x = (i * 2) / 256 - 1;
    curve[i] = k > 0 ? ((Math.PI + k) * x) / (Math.PI + k * Math.abs(x)) : x;
  }
  dist.curve = curve;
  dist.oversample = '2x';

  const out = audioCtx.createGain();
  out.gain.value = 1.0 + int * 0.1;

  sourceNode.connect(hp);
  hp.connect(lp);
  lp.connect(comp);
  comp.connect(dist);
  dist.connect(out);
  out.connect(audioCtx.destination);

  const echo = Math.max(0, Math.min(1, echoLevel));
  const baseDelay = 0.035 + int * 0.015;
  const tapGains = [0.30 * echo, 0.117 * echo, 0.050 * echo];
  const allTapNodes = [];

  [1, 2, 3].forEach((n, i) => {
    const d = audioCtx.createDelay(0.5);
    d.delayTime.value = baseDelay * n;
    const f = audioCtx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 3000 - int * 800 - n * 200;
    const g = audioCtx.createGain();
    g.gain.value = tapGains[i];
    dist.connect(d);
    d.connect(f);
    f.connect(g);
    g.connect(out);
    allTapNodes.push(d, f, g);
  });

  chainNodes = [hp, lp, comp, dist, out, ...allTapNodes];
}

function stopProcessing() {
  try { sourceNode?.disconnect(); } catch (_) {}
  sourceNode = null;
  chainNodes.forEach(n => { try { n.disconnect(); } catch (_) {} });
  chainNodes = [];
  currentStream?.getTracks().forEach(t => t.stop());
  currentStream = null;
  audioCtx?.close();
  audioCtx = null;
}
