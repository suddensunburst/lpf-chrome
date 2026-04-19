const OFFSCREEN_URL = chrome.runtime.getURL('offscreen.html');

// Service Worker起動時にストレージから状態を復元
chrome.storage.local.get(['enabled', 'intensity', 'mutedTabId'], async (state) => {
  if (state.enabled && state.mutedTabId) {
    try {
      await restartCapture(state.mutedTabId, state.intensity ?? 0.6);
    } catch (_) {
      // タブが既に閉じられている等
      chrome.storage.local.set({enabled: false, mutedTabId: null});
    }
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'TOGGLE') {
    handleToggle(msg).then(sendResponse).catch(err => sendResponse({error: err.message}));
    return true;
  }
  if (msg.type === 'UPDATE_INTENSITY') {
    chrome.storage.local.set({intensity: msg.intensity});
    chrome.runtime.sendMessage({type: 'UPDATE_INTENSITY', intensity: msg.intensity});
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
    await chrome.storage.local.set({enabled: true, intensity, mutedTabId: tab.id});
    await chrome.tabs.update(tab.id, {muted: true});
    await restartCapture(tab.id, intensity);
  } else {
    await stopCapture();
  }

  return {ok: true};
}

async function restartCapture(tabId, intensity) {
  const streamId = await new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({targetTabId: tabId}, (id) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(id);
    });
  });

  await ensureOffscreen();
  chrome.runtime.sendMessage({type: 'START_PROCESSING', streamId, intensity});
}

async function handleStreamEnded() {
  const state = await chrome.storage.local.get(['enabled', 'mutedTabId', 'intensity']);
  if (!state.enabled || !state.mutedTabId) return;

  try {
    // タブがまだ存在するか確認
    await chrome.tabs.get(state.mutedTabId);
    await restartCapture(state.mutedTabId, state.intensity ?? 0.6);
  } catch (_) {
    // タブが閉じられていたら状態をリセット
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

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [OFFSCREEN_URL]
  });
  if (contexts.length > 0) return;

  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK'],
    justification: 'Captured tab audio processing via Web Audio API'
  });
}
