/**
 * まねっこあそび アプリ - クライアントスクリプト
 * 知的障害特別支援学校小学部 国語科
 */

// ==================== 1. アプリ状態定義 ====================
let appState = {
  round: 1,
  current_step: "shooting", // shooting -> naming -> presenting
  team_roles: {
    team_a: "shooter",      // shooter (さつえい) or namer (なまえつけ)
    team_b: "namer"
  },
  questions: [
    { id: 1, image: null, name: "" },
    { id: 2, image: null, name: "" },
    { id: 3, image: null, name: "" }
  ],
  presenting_index: 0,
  show_answer: false,
  is_mimicking: false,
  updated_at: 0
};

// 自分の端末の設定
let myRole = null;          // "team_a" | "team_b" | "teacher"
let soundEnabled = true;
let isServerAvailable = false;
let serverPollInterval = null;
let currentNamingTab = 0;

// おたすけことばリスト（特別支援学校小学部で親しみやすい動きの言葉）
const HELPER_WORDS = [
  "じゃんぷ", "あるく", "はしる", "くるくる", "ロボット",
  "ねこ", "うさぎ", "とり", "おどる", "たいそう", "ねる", "てをふる"
];

// ==================== 2. Web Audio API サウンドシステム ====================
let audioCtx = null;
function getAudioContext() {
  if (!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) audioCtx = new AudioContext();
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

function playSound(type) {
  if (!soundEnabled) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;

  if (type === 'click') {
    // 軽いポコン音
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.08);
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.08);
  } else if (type === 'shutter') {
    // カシャッ（ホワイトノイズ＋減衰）
    const bufferSize = ctx.sampleRate * 0.1;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
    noise.connect(gain);
    gain.connect(ctx.destination);
    noise.start(now);
  } else if (type === 'success') {
    // ピンポーン♪
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + i * 0.1);
      gain.gain.setValueAtTime(0.25, now + i * 0.1);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.1);
      osc.stop(now + i * 0.1 + 0.3);
    });
  } else if (type === 'reveal') {
    // ドラムロール後のジャジャーン！
    [440, 554.37, 659.25, 880].forEach(freq => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.8);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.8);
    });
  } else if (type === 'count') {
    // ピッ
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, now);
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.1);
  } else if (type === 'start') {
    // ポーン！（開始音）
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1600, now);
    gain.gain.setValueAtTime(0.35, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.5);
  }
}

// 音声読み上げ（SpeechSynthesis）
function speak(text) {
  if (!soundEnabled || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const uttr = new SpeechSynthesisUtterance(text);
    uttr.lang = 'ja-JP';
    uttr.rate = 0.9; // 少しゆっくり・はっきり
    uttr.pitch = 1.1; // 明るい声
    window.speechSynthesis.speak(uttr);
  } catch (e) {
    console.warn("Speech synthesis error", e);
  }
}

// ==================== 3. 状態同期・通信システム ====================

// サーバー通信チェック＆ポーリング開始
async function initSync() {
  try {
    const res = await fetch('/api/info', { cache: 'no-store' });
    if (res.ok) {
      const info = await res.json();
      isServerAvailable = true;
      document.getElementById('sync-status-text').textContent = "つうしんOK";
      
      // QRコードURLの更新
      const qrUrl = info.url;
      document.getElementById('qr-url-text').textContent = qrUrl;
      generateQrCode(qrUrl);

      // 初回状態取得
      await pullState();
      // 定期ポーリング開始（1.5秒おき）
      serverPollInterval = setInterval(pullState, 1500);
      return;
    }
  } catch (e) {
    console.log("ローカルPythonサーバー未検出。ブラウザ単体/BroadcastChannelで動作します。");
  }

  // サーバー未検出時：BroadcastChannel（同一端末内別タブでの同期）
  initBroadcastChannel();
  document.getElementById('sync-status-text').textContent = "スタンドアロン";
  generateQrCode(window.location.href);
  document.getElementById('qr-url-text').textContent = window.location.href;
}

let bc = null;
function initBroadcastChannel() {
  try {
    bc = new BroadcastChannel('manekko_channel');
    bc.onmessage = (event) => {
      if (event.data && event.data.type === 'STATE_UPDATE') {
        applyState(event.data.state, false);
      }
    };
  } catch (e) {
    console.warn("BroadcastChannel not supported", e);
  }
}

async function pullState() {
  if (!isServerAvailable) return;
  try {
    const res = await fetch('/api/state', { cache: 'no-store' });
    if (res.ok) {
      const remoteState = await res.json();
      if (remoteState.updated_at > appState.updated_at) {
        applyState(remoteState, false);
      }
    }
  } catch (e) {
    console.warn("State pull failed", e);
  }
}

async function pushState(newState) {
  appState = { ...appState, ...newState, updated_at: Date.now() };
  renderUI();

  if (isServerAvailable) {
    try {
      await fetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(appState)
      });
    } catch (e) {
      console.warn("State push failed", e);
    }
  } else if (bc) {
    bc.postMessage({ type: 'STATE_UPDATE', state: appState });
  }
}

function applyState(newState, shouldPush = false) {
  const prevStep = appState.current_step;
  const prevAnswer = appState.show_answer;
  const prevMimic = appState.is_mimicking;

  appState = { ...newState };
  renderUI();

  // 音声や演出のトリガー
  if (prevStep !== 'naming' && appState.current_step === 'naming') {
    playSound('success');
    speak("写真が届きました！名前をつけてね！");
  }
  if (!prevAnswer && appState.show_answer) {
    playSound('reveal');
    const q = appState.questions[appState.presenting_index];
    if (q && q.name) speak(`名前は、${q.name} です！`);
  }
  if (!prevMimic && appState.is_mimicking) {
    triggerMimicAnimation();
  }

  if (shouldPush) {
    pushState(appState);
  }
}

// ==================== 4. 画像圧縮ユーティリティ ====================
function compressImage(file, maxWidth = 800, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ==================== 5. UI レンダリング・画面切り替え ====================
function renderUI() {
  // 回戦数表示
  const roundEl = document.getElementById('round-display');
  if (roundEl) roundEl.textContent = appState.round;

  // チームカードの役割テキスト更新
  const isTeamAShooter = appState.team_roles.team_a === 'shooter';
  document.getElementById('team-a-icon').textContent = isTeamAShooter ? '📷' : '✏️';
  document.getElementById('team-a-role-text').textContent = isTeamAShooter ? 'ポーズを さつえい するよ！' : 'なまえを つけるよ！';

  document.getElementById('team-b-icon').textContent = !isTeamAShooter ? '📷' : '✏️';
  document.getElementById('team-b-role-text').textContent = !isTeamAShooter ? 'ポーズを さつえい するよ！' : 'なまえを つけるよ！';

  // 画面の切り替え
  const viewTop = document.getElementById('view-top');
  const viewShoot = document.getElementById('view-shoot');
  const viewName = document.getElementById('view-name');
  const viewPresent = document.getElementById('view-present');
  const btnBack = document.getElementById('btn-back');
  const roleBadge = document.getElementById('current-role-badge');
  const roleBadgeText = document.getElementById('role-badge-text');

  // 全画面非表示にしてから該当を表示
  [viewTop, viewShoot, viewName, viewPresent].forEach(v => v.classList.add('hidden'));

  if (!myRole) {
    viewTop.classList.remove('hidden');
    btnBack.classList.add('hidden');
    roleBadge.classList.add('hidden');
    return;
  }

  btnBack.classList.remove('hidden');
  roleBadge.classList.remove('hidden');

  // ロールバッジの色と文字設定
  if (myRole === 'team_a') {
    roleBadge.className = "flex items-center gap-1.5 px-3 py-1 rounded-full text-sm md:text-base font-black shadow-sm bg-rose-100 text-rose-700 border border-rose-300";
    roleBadgeText.textContent = `あかチーム (${appState.team_roles.team_a === 'shooter' ? '📷 さつえい' : '✏️ なまえつけ'})`;
  } else if (myRole === 'team_b') {
    roleBadge.className = "flex items-center gap-1.5 px-3 py-1 rounded-full text-sm md:text-base font-black shadow-sm bg-sky-100 text-sky-700 border border-sky-300";
    roleBadgeText.textContent = `あおチーム (${appState.team_roles.team_b === 'shooter' ? '📷 さつえい' : '✏️ なまえつけ'})`;
  } else {
    roleBadge.className = "flex items-center gap-1.5 px-3 py-1 rounded-full text-sm md:text-base font-black shadow-sm bg-amber-100 text-amber-800 border border-amber-300";
    roleBadgeText.textContent = "📺 せんせい・モニター";
  }

  // 自分の役割に応じた画面表示
  if (myRole === 'teacher') {
    viewPresent.classList.remove('hidden');
    renderPresentView();
  } else {
    const isShooter = (myRole === 'team_a' && appState.team_roles.team_a === 'shooter') ||
                      (myRole === 'team_b' && appState.team_roles.team_b === 'shooter');

    if (isShooter) {
      if (appState.current_step === 'presenting') {
        viewPresent.classList.remove('hidden');
        renderPresentView();
      } else {
        viewShoot.classList.remove('hidden');
        renderShootView();
      }
    } else {
      // Namer 側
      if (appState.current_step === 'presenting') {
        viewPresent.classList.remove('hidden');
        renderPresentView();
      } else {
        viewName.classList.remove('hidden');
        renderNameView();
      }
    }
  }

  // Lucideアイコンの再描画
  if (window.lucide) lucide.createIcons();
}

// 撮影画面のレンダリング
function renderShootView() {
  let photoCount = 0;
  appState.questions.forEach((q, idx) => {
    const slot = idx + 1;
    const preview = document.getElementById(`shoot-preview-${slot}`);
    const placeholder = document.getElementById(`shoot-placeholder-${slot}`);
    const btnRetake = document.querySelector(`.btn-retake[data-slot="${slot}"]`);
    const btnText = document.getElementById(`shoot-btn-text-${slot}`);

    if (q.image) {
      photoCount++;
      preview.src = q.image;
      preview.classList.remove('hidden');
      placeholder.classList.add('hidden');
      btnRetake.classList.remove('hidden');
      btnText.textContent = "とりなおす";
    } else {
      preview.classList.add('hidden');
      placeholder.classList.remove('hidden');
      btnRetake.classList.add('hidden');
      btnText.textContent = "とる！";
    }
  });

  const submitBtn = document.getElementById('btn-submit-photos');
  const submitText = document.getElementById('btn-submit-photos-text');
  if (photoCount === 3) {
    submitBtn.disabled = false;
    submitBtn.className = "w-full bg-gradient-to-r from-emerald-400 to-green-500 hover:from-emerald-500 hover:to-green-600 active:scale-98 text-white font-black text-xl md:text-2xl py-4 rounded-2xl shadow-xl border-2 border-emerald-300 flex items-center justify-center gap-3 cursor-pointer animate-bounce-slow";
    submitText.textContent = "3まい できた！ あいてにおくる 🚀";
  } else {
    submitBtn.disabled = true;
    submitBtn.className = "w-full bg-slate-300 text-slate-500 font-black text-xl md:text-2xl py-4 rounded-2xl shadow-lg border-2 border-slate-300 flex items-center justify-center gap-3 cursor-not-allowed";
    submitText.textContent = `あと ${3 - photoCount}まい とると おくれるよ！`;
  }
}

// なまえつけ画面のレンダリング
function renderNameView() {
  const waitingEl = document.getElementById('name-waiting');
  const activeEl = document.getElementById('name-active');

  // まだ撮影中かどうか判定
  const hasPhotos = appState.questions.every(q => q.image !== null);
  if (!hasPhotos && appState.current_step === 'shooting') {
    waitingEl.classList.remove('hidden');
    activeEl.classList.add('hidden');
    return;
  }

  waitingEl.classList.add('hidden');
  activeEl.classList.remove('hidden');

  // タブボタンのスタイリング
  document.querySelectorAll('.name-tab-btn').forEach((btn, idx) => {
    if (idx === currentNamingTab) {
      btn.className = "name-tab-btn flex-1 py-2 rounded-xl font-black text-base transition-all bg-sky-500 text-white shadow-md border-2 border-sky-600 scale-105";
    } else {
      btn.className = "name-tab-btn flex-1 py-2 rounded-xl font-black text-base transition-all bg-slate-200 text-slate-600 border-2 border-slate-300";
    }
  });

  // 選択中問題の写真と名前
  const currentQ = appState.questions[currentNamingTab];
  const photoPreview = document.getElementById('name-photo-preview');
  const nameInput = document.getElementById('name-input');

  if (currentQ && currentQ.image) {
    photoPreview.src = currentQ.image;
  }
  nameInput.value = (currentQ && currentQ.name) ? currentQ.name : "";
}

// 発表・まねっこ画面のレンダリング
function renderPresentView() {
  const currentIdx = appState.presenting_index;
  const currentQ = appState.questions[currentIdx] || { image: null, name: "" };

  document.getElementById('present-number').textContent = currentIdx + 1;

  // タブ切り替えボタンの見た目
  document.querySelectorAll('.present-tab-btn').forEach((btn, idx) => {
    if (idx === currentIdx) {
      btn.className = "present-tab-btn px-4 py-1 rounded-full font-black text-sm bg-amber-500 text-white shadow scale-105";
    } else {
      btn.className = "present-tab-btn px-4 py-1 rounded-full font-black text-sm bg-white text-slate-700 border border-slate-300 shadow-sm";
    }
  });

  // 写真の表示
  const photoEl = document.getElementById('present-photo');
  if (currentQ.image) {
    photoEl.src = currentQ.image;
    photoEl.classList.remove('hidden');
  } else {
    photoEl.classList.add('hidden');
  }

  // 名前の表示
  const answerContainer = document.getElementById('answer-container');
  const answerText = document.getElementById('present-answer-text');

  if (appState.show_answer) {
    answerContainer.className = "w-full min-h-[72px] bg-gradient-to-r from-amber-200 to-yellow-200 border-4 border-amber-500 rounded-2xl flex items-center justify-center px-4 py-2 shadow-lg animate-bounce-slow";
    answerText.className = "text-3xl md:text-5xl font-black text-amber-900 tracking-wider";
    answerText.textContent = currentQ.name || "（なまえなし）";
  } else {
    answerContainer.className = "w-full min-h-[72px] bg-amber-50 border-4 border-dashed border-amber-400 rounded-2xl flex items-center justify-center px-4 py-2 shadow-inner";
    answerText.className = "text-3xl md:text-5xl font-black text-amber-400 tracking-widest";
    answerText.textContent = "？？？？？";
  }

  // まねっこオーバーレイ
  const mimicOverlay = document.getElementById('mimic-overlay');
  if (appState.is_mimicking) {
    mimicOverlay.classList.remove('hidden');
  } else {
    mimicOverlay.classList.add('hidden');
  }
}

// まねっこアニメーション演出（カウントダウン付き）
function triggerMimicAnimation() {
  const countdownEl = document.getElementById('countdown-overlay');
  const countdownNum = document.getElementById('countdown-number');
  const mimicOverlay = document.getElementById('mimic-overlay');

  countdownEl.classList.remove('hidden');
  let count = 3;
  countdownNum.textContent = count;
  playSound('count');

  const timer = setInterval(() => {
    count--;
    if (count > 0) {
      countdownNum.textContent = count;
      playSound('count');
    } else {
      clearInterval(timer);
      countdownEl.classList.add('hidden');
      playSound('start');
      playSound('mimic');
      speak("まねっこスタート！みんなでポーズ！");
      mimicOverlay.classList.remove('hidden');

      // 6秒後に自動でオーバーレイ解除
      setTimeout(() => {
        mimicOverlay.classList.add('hidden');
        if (myRole === 'teacher') {
          pushState({ is_mimicking: false });
        }
      }, 6000);
    }
  }, 1000);
}

// QRコードの生成
let qrcodeInstance = null;
function generateQrCode(url) {
  const container = document.getElementById('qrcode-container');
  if (!container || !window.QRCode) return;
  container.innerHTML = "";
  qrcodeInstance = new QRCode(container, {
    text: url,
    width: 180,
    height: 180,
    colorDark: "#1e293b",
    colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.M
  });
}

// ==================== 6. イベントリスナー登録 ====================
function initEventListeners() {
  // 音声コンテキストの初期化（初回タップ）
  document.body.addEventListener('click', () => {
    getAudioContext();
  }, { once: true });

  // チーム選択
  document.getElementById('btn-select-team-a').addEventListener('click', () => {
    playSound('click');
    myRole = 'team_a';
    renderUI();
  });
  document.getElementById('btn-select-team-b').addEventListener('click', () => {
    playSound('click');
    myRole = 'team_b';
    renderUI();
  });
  document.getElementById('btn-select-teacher').addEventListener('click', () => {
    playSound('click');
    myRole = 'teacher';
    renderUI();
  });

  // もどるボタン
  document.getElementById('btn-back').addEventListener('click', () => {
    playSound('click');
    myRole = null;
    renderUI();
  });

  // 音声ON/OFF切り替え
  document.getElementById('btn-toggle-sound').addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    const icon = document.getElementById('icon-sound');
    if (soundEnabled) {
      icon.setAttribute('data-lucide', 'volume-2');
      icon.className = "w-5 h-5 text-amber-600";
      playSound('click');
    } else {
      icon.setAttribute('data-lucide', 'volume-x');
      icon.className = "w-5 h-5 text-slate-400";
    }
    if (window.lucide) lucide.createIcons();
  });

  // QRモーダル
  document.getElementById('btn-show-qr').addEventListener('click', () => {
    playSound('click');
    document.getElementById('modal-qr').classList.remove('hidden');
  });
  const closeQr = () => document.getElementById('modal-qr').classList.add('hidden');
  document.getElementById('btn-close-qr').addEventListener('click', closeQr);
  document.getElementById('btn-close-qr-2').addEventListener('click', closeQr);

  // ---------- 撮影画面のイベント ----------
  document.querySelectorAll('.photo-input').forEach(input => {
    input.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const slot = parseInt(e.target.dataset.slot, 10);
      try {
        const compressedBase64 = await compressImage(file, 800, 0.7);
        playSound('shutter');
        
        // 状態を更新
        const newQuestions = [...appState.questions];
        newQuestions[slot - 1].image = compressedBase64;
        await pushState({ questions: newQuestions });
      } catch (err) {
        console.error("写真読み込みエラー", err);
      }
    });
  });

  document.querySelectorAll('.btn-retake').forEach(btn => {
    btn.addEventListener('click', () => {
      const slot = parseInt(btn.dataset.slot, 10);
      const input = document.querySelector(`.photo-input[data-slot="${slot}"]`);
      if (input) input.click();
    });
  });

  // 写真送信ボタン（3枚撮ったら）
  document.getElementById('btn-submit-photos').addEventListener('click', async () => {
    playSound('success');
    speak("写真を送りました！");
    await pushState({ current_step: 'naming' });
  });

  // ---------- なまえつけ画面のイベント ----------
  document.querySelectorAll('.name-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      playSound('click');
      currentNamingTab = parseInt(btn.dataset.tab, 10);
      renderNameView();
    });
  });

  // 名前入力更新
  const nameInput = document.getElementById('name-input');
  nameInput.addEventListener('input', () => {
    const val = nameInput.value;
    const newQuestions = [...appState.questions];
    newQuestions[currentNamingTab].name = val;
    // ローカル更新＆相手へ同期
    pushState({ questions: newQuestions });
  });

  // おたすけことばチップの生成とタップ処理
  const chipsContainer = document.getElementById('word-chips');
  chipsContainer.innerHTML = "";
  HELPER_WORDS.forEach(word => {
    const chip = document.createElement('button');
    chip.className = "bg-white hover:bg-sky-100 active:scale-95 text-sky-800 text-sm md:text-base font-extrabold px-3 py-1.5 rounded-full border-2 border-sky-300 shadow-sm transition-all";
    chip.textContent = word;
    chip.addEventListener('click', () => {
      playSound('click');
      const cur = nameInput.value;
      nameInput.value = cur ? `${cur} ${word}` : word;
      nameInput.dispatchEvent(new Event('input'));
    });
    chipsContainer.appendChild(chip);
  });

  // つぎの問へ
  document.getElementById('btn-next-name').addEventListener('click', () => {
    playSound('click');
    if (currentNamingTab < 2) {
      currentNamingTab++;
      renderNameView();
    }
  });

  // なまえ完成・送信ボタン
  document.getElementById('btn-submit-names').addEventListener('click', async () => {
    playSound('success');
    speak("名前をつけました！発表の準備完了です！");
    await pushState({
      current_step: 'presenting',
      presenting_index: 0,
      show_answer: false,
      is_mimicking: false
    });
  });

  // ---------- 発表・まねっこ画面のイベント ----------
  document.querySelectorAll('.present-tab-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      playSound('click');
      const idx = parseInt(btn.dataset.idx, 10);
      await pushState({
        presenting_index: idx,
        show_answer: false,
        is_mimicking: false
      });
      speak(`第 ${idx + 1} 問！`);
    });
  });

  // オープン（なまえ表示）
  document.getElementById('btn-reveal-answer').addEventListener('click', async () => {
    if (!appState.show_answer) {
      playSound('reveal');
      await pushState({ show_answer: true });
      const q = appState.questions[appState.presenting_index];
      if (q && q.name) speak(`名前は、${q.name} です！`);
    }
  });

  // まねっこスタート
  document.getElementById('btn-start-mimic').addEventListener('click', async () => {
    await pushState({ is_mimicking: true });
    triggerMimicAnimation();
  });

  // よみあげ
  document.getElementById('btn-speak-name').addEventListener('click', () => {
    const q = appState.questions[appState.presenting_index];
    if (q && q.name) {
      speak(q.name);
    } else {
      speak("だい " + (appState.presenting_index + 1) + " もん");
    }
  });

  // つぎのもん
  document.getElementById('btn-next-question').addEventListener('click', async () => {
    playSound('click');
    const nextIdx = (appState.presenting_index + 1) % 3;
    await pushState({
      presenting_index: nextIdx,
      show_answer: false,
      is_mimicking: false
    });
    speak(`第 ${nextIdx + 1} 問！`);
  });

  // 攻守交代（やくわりチェンジ）
  document.getElementById('btn-swap-roles').addEventListener('click', async () => {
    playSound('success');
    speak("こうたい！ 役割を交代します！");
    if (isServerAvailable) {
      try {
        const res = await fetch('/api/swap', { method: 'POST' });
        const data = await res.json();
        if (data.success) applyState(data.state);
      } catch (e) {
        console.error(e);
      }
    } else {
      // ローカル反転
      const curA = appState.team_roles.team_a;
      await pushState({
        round: appState.round + 1,
        current_step: 'shooting',
        team_roles: {
          team_a: curA === 'shooter' ? 'namer' : 'shooter',
          team_b: curA === 'shooter' ? 'shooter' : 'namer'
        },
        questions: [
          { id: 1, image: null, name: "" },
          { id: 2, image: null, name: "" },
          { id: 3, image: null, name: "" }
        ],
        presenting_index: 0,
        show_answer: false,
        is_mimicking: false
      });
    }
  });

  // 最初からリセット
  document.getElementById('btn-reset-game').addEventListener('click', async () => {
    if (!confirm("さいしょから やりなおしますか？")) return;
    playSound('click');
    if (isServerAvailable) {
      try {
        const res = await fetch('/api/reset', { method: 'POST' });
        const data = await res.json();
        if (data.success) applyState(data.state);
      } catch (e) {
        console.error(e);
      }
    } else {
      await pushState({
        round: 1,
        current_step: 'shooting',
        team_roles: { team_a: 'shooter', team_b: 'namer' },
        questions: [
          { id: 1, image: null, name: "" },
          { id: 2, image: null, name: "" },
          { id: 3, image: null, name: "" }
        ],
        presenting_index: 0,
        show_answer: false,
        is_mimicking: false
      });
    }
  });
}

// ==================== 7. 初期化 ====================
window.addEventListener('DOMContentLoaded', async () => {
  initEventListeners();
  await initSync();
  renderUI();
});
