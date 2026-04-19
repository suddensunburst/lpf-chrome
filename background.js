const OFFSCREEN_URL = chrome.runtime.getURL('offscreen.html');
let mutedTabId = null;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'TOGGLE') {
    handleToggle(msg).then(sendResponse).catch(err => sendResponse({error: err.message}));
    return true;
  }
  if (msg.type === 'UPDATE_INTENSITY') {
    chrome.runtime.sendMessage({type: 'UPDATE_INTENSITY', intensity: msg.intensity});
    return false;
  }
});

async function handleToggle({enabled, intensity}) {
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  if (!tab) throw new Error('アクティブなタブが見つかりません');

  if (enabled) {
    mutedTabId = tab.id;

    // タブの音声をミュート（オリジナルをシャットアウト）
    await chrome.tabs.update(tab.id, {muted: true});

    // tabCapture ストリームIDを取得
    const streamId = await new Promise((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId({targetTabId: tab.id}, (id) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(id);
      });
    });

    await ensureOffscreen();

    // Offscreenに処理開始を指示
    chrome.runtime.sendMessage({type: 'START_PROCESSING', streamId, intensity});

  } else {
    chrome.runtime.sendMessage({type: 'STOP_PROCESSING'});

    if (mutedTabId !== null) {
      try { await chrome.tabs.update(mutedTabId, {muted: false}); } catch (_) {}
      mutedTabId = null;
    }
  }

  return {ok: true};
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
