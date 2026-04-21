const OFFSCREEN_URL = chrome.runtime.getURL('offscreen.html');

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'OFFSCREEN_READY') {
    if (offscreenReadyResolve) offscreenReadyResolve();
    return false;
  }
  if (msg.type === 'TOGGLE') {
    handleToggle(msg).then(sendResponse).catch(err => sendResponse({error: err.message}));
    return true;
  }
  if (msg.type === 'UPDATE_INTENSITY') {
    chrome.storage.local.set({intensity: msg.intensity});
    chrome.runtime.sendMessage({type: 'UPDATE_INTENSITY', intensity: msg.intensity});
    return false;
  }
  if (msg.type === 'UPDATE_ECHO') {
    chrome.storage.local.set({echoLevel: msg.echoLevel});
    chrome.runtime.sendMessage({type: 'UPDATE_ECHO', echoLevel: msg.echoLevel});
    return false;
  }
  if (msg.type === 'STREAM_ENDED') {
    handleStreamEnded();
    return false;
  }
});

async function handleToggle({enabled, intensity}) {
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  if (!tab) throw new Error('アクティブなタブが見つかりません');

  if (enabled) {
    const {echoLevel = 0.6} = await chrome.storage.local.get('echoLevel');
    await chrome.storage.local.set({enabled: true, intensity, mutedTabId: tab.id});
    await chrome.tabs.update(tab.id, {muted: true});
    await restartCapture(tab.id, intensity, echoLevel);
  } else {
    await stopCapture();
  }

  return {ok: true};
}

async function restartCapture(tabId, intensity, echoLevel) {
  await ensureOffscreen();
  const streamId = await new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({targetTabId: tabId}, (id) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(id);
    });
  });
  chrome.runtime.sendMessage({type: 'START_PROCESSING', streamId, intensity, echoLevel});
}

async function handleStreamEnded() {
  const state = await chrome.storage.local.get(['enabled', 'mutedTabId', 'intensity', 'echoLevel']);
  if (!state.enabled || !state.mutedTabId) return;

  try {
    await chrome.tabs.get(state.mutedTabId);
    await restartCapture(state.mutedTabId, state.intensity ?? 0.3, state.echoLevel ?? 0.6);
  } catch (_) {
    chrome.storage.local.set({enabled: false, mutedTabId: null});
  }
}

async function stopCapture() {
  chrome.runtime.sendMessage({type: 'STOP_PROCESSING'});

  const {mutedTabId} = await chrome.storage.local.get('mutedTabId');
  if (mutedTabId) {
    try { await chrome.tabs.update(mutedTabId, {muted: false}); } catch (_) {}
  }
  await chrome.storage.local.set({enabled: false, mutedTabId: null});
}

let offscreenReadyResolve = null;

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [OFFSCREEN_URL]
  });
  if (contexts.length > 0) return;

  const readyPromise = new Promise(resolve => { offscreenReadyResolve = resolve; });

  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK'],
    justification: 'Captured tab audio processing via Web Audio API'
  });

  await Promise.race([readyPromise, new Promise(r => setTimeout(r, 2000))]);
  offscreenReadyResolve = null;
}
