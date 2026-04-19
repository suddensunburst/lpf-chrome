const toggle = document.getElementById('enableToggle');
const slider = document.getElementById('intensitySlider');
const display = document.getElementById('intensityDisplay');
const status = document.getElementById('status');
const vizEl = document.getElementById('viz');
const presetBtns = document.querySelectorAll('.preset-btn');

// EQビジュアライザー
const eqFreqs = [80, 160, 315, 630, 1250, 2500, 4000, 8000, 16000];
const bars = eqFreqs.map(() => {
  const b = document.createElement('div');
  b.className = 'viz-bar';
  vizEl.appendChild(b);
  return b;
});

function updateViz(enabled, pct) {
  const int = pct / 100;
  eqFreqs.forEach((freq, i) => {
    let gain;
    const cutoffLow = 150 + int * 100;
    const cutoffHigh = 4000 - int * 1500;
    if (freq < cutoffLow) gain = Math.max(0, freq / cutoffLow * 0.6);
    else if (freq <= cutoffHigh) gain = 1;
    else gain = Math.max(0, 1 - (freq - cutoffHigh) / (cutoffHigh * 0.6));

    bars[i].style.height = enabled ? Math.max(2, Math.round(gain * 28)) + 'px' : '6px';
    bars[i].style.background = enabled
      ? `hsl(${210 + (1 - gain) * 40}, 70%, ${28 + gain * 32}%)`
      : '#0f3460';
  });
}

function updatePreset(val) {
  presetBtns.forEach(b => b.classList.toggle('active', parseInt(b.dataset.value) === val));
}

function setStatus(enabled) {
  status.textContent = enabled ? 'ON — 教室スピーカー音響' : 'オフ';
  status.className = 'status' + (enabled ? ' on' : '');
}

// 状態復元
chrome.storage.local.get(['enabled', 'intensity'], (res) => {
  const enabled = res.enabled ?? false;
  const pct = Math.round((res.intensity ?? 0.6) * 100);
  toggle.checked = enabled;
  slider.value = pct;
  display.textContent = pct + '%';
  setStatus(enabled);
  updateViz(enabled, pct);
  updatePreset(pct);
});

// トグル
toggle.addEventListener('change', () => {
  const enabled = toggle.checked;
  const pct = parseInt(slider.value);
  setStatus(enabled);
  updateViz(enabled, pct);
  chrome.storage.local.set({enabled, intensity: pct / 100});
  chrome.runtime.sendMessage({type: 'TOGGLE', enabled, intensity: pct / 100});
});

// 強度スライダー（動かしている最中）
slider.addEventListener('input', () => {
  const pct = parseInt(slider.value);
  display.textContent = pct + '%';
  updateViz(toggle.checked, pct);
  updatePreset(pct);
});

// 強度スライダー（確定時）
slider.addEventListener('change', () => {
  const pct = parseInt(slider.value);
  chrome.storage.local.set({intensity: pct / 100});
  if (toggle.checked) {
    chrome.runtime.sendMessage({type: 'UPDATE_INTENSITY', intensity: pct / 100});
  }
});

// プリセットボタン
presetBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const val = parseInt(btn.dataset.value);
    slider.value = val;
    display.textContent = val + '%';
    updateViz(toggle.checked, val);
    updatePreset(val);
    chrome.storage.local.set({intensity: val / 100});
    if (toggle.checked) {
      chrome.runtime.sendMessage({type: 'UPDATE_INTENSITY', intensity: val / 100});
    }
  });
});
