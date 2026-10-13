/**
 * まねっこあそび アプリ - クライアントスクリプト (最新安定版)
 * 知的障害特別支援学校小学部 国語科
 * 
 * 【特徴】
 * ・MQTT over WebSocket によるクラウドリアルタイム同期（学校のファイアウォールを完全回避）
 * ・ローカルサーバー同期 / BroadcastChannel / オフライン1台モードの多重フェイルセーフ設計
 * ・1枚からでも送信可能（授業の進度に応じた柔軟性）
 * ・送信完了待機画面の明確化（児童が不安にならないUI）
 * ・先生用「おたすけ操作（強制進行・サンプルデータ投入）」機能
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
  version: 1,               // 同期用バージョンカウンター
  updated_at: 0
};

// 端末固有の設定
let myRole = null;          // "team_a" | "team_b" | "teacher"
let soundEnabled = true;
let currentNamingTab = 0;
let roomId = "manekko_default"; // クラウド同期のあいことば

// 通信関連
let mqttClient = null;
let isMqttConnected = false;
let isLocalServerAvailable = false;
let bc = null;

// おたすけことばリスト
const HELPER_WORDS = [
  "じゃんぷ", "あるく", "はしる", "くるくる", "ロボット",
  "ねこ", "うさぎ", "とり", "おどる", "たいそう", "ねる", "てをふる"
];

// サンプルイラスト（先生おたすけ用：SVGをDataURL化）
const SAMPLE_POSES = [
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 300 220' width='300' height='220'><rect width='300' height='220' fill='%23fed7aa'/><circle cx='150' cy='80' r='45' fill='%23ea580c'/><text x='150' y='95' font-size='40' text-anchor='middle'>🐰</text><path d='M110,130 Q150,110 190,130 L180,190 L120,190 Z' fill='%23f97316'/><text x='150' y='170' font-size='20' font-weight='bold' fill='white' text-anchor='middle'>ぴょんぴょん</text></svg>",
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 300 220' width='300' height='220'><rect width='300' height='220' fill='%23bae6fd'/><circle cx='150' cy='80' r='45' fill='%230284c7'/><text x='150' y='95' font-size='40' text-anchor='middle'>🤖</text><path d='M100,130 L200,130 L190,190 L110,190 Z' fill='%230ea5e9'/><text x='150' y='170' font-size='20' font-weight='bold' fill='white' text-anchor='middle'>がしゃんがしゃん</text></svg>",
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 300 220' width='300' height='220'><rect width='300' height='220' fill='%23bbf7d0'/><circle cx='150' cy='80' r='45' fill='%2316a34a'/><text x='150' y='95' font-size='40' text-anchor='middle'>🐱</text><path d='M120,130 Q150,115 180,130 L170,190 L130,190 Z' fill='%2322c55e'/><text x='150' y='170' font-size='20' font-weight='bold' fill='white' text-anchor='middle'>にゃーのポーズ</text></svg>"
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

// 音声読み上げ
function speak(text) {
  if (!soundEnabled || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const uttr = new SpeechSynthesisUtterance(text);
    uttr.lang = 'ja-JP';
    uttr.rate = 0.9;
    uttr.pitch = 1.1;
    window.speechSynthesis.speak(uttr);
  } catch (e) {
    console.warn("Speech error", e);
  }
}

// ==================== 3. クラウドMQTT ＆ 多重同期システム ====================

// ルームのトピック名取得
function getMqttTopic() {
  return `manekko/app_state/${roomId}`;
}

// MQTT接続（WSS経由・ファイアウォール完全回避）
function initMqtt() {
  const statusEl = document.getElementById('sync-status');
  const statusText = document.getElementById('sync-status-text');

  // ブローカーリスト（HiveMQのパブリックWSSポート8884）
  const brokerUrl = "wss://broker.hivemq.com:8884/mqtt";
  const clientId = "manekko_" + Math.random().toString(16).substring(2, 10);

  try {
    statusText.textContent = "クラウド接続中...";
    mqttClient = mqtt.connect(brokerUrl, {
      clientId: clientId,
      clean: true,
      connectTimeout: 5000,
      reconnectPeriod: 3000
    });

    mqttClient.on('connect', () => {
      isMqttConnected = true;
      statusEl.className = "flex items-center gap-1 bg-emerald-100 text-emerald-800 px-2.5 py-1 rounded-full text-xs font-black border border-emerald-300 shadow-sm";
      statusText.textContent = "クラウド同期中 🟢";
      console.log("MQTT connected to", brokerUrl);

      // トピック購読
      const topic = getMqttTopic();
      mqttClient.subscribe(topic, (err) => {
        if (!err) {
          console.log("Subscribed to", topic);
          // 接続時に現状をリクエストするか、最初の状態をブロードキャスト
          publishState(false);
        }
      });
    });

    mqttClient.on('message', (topic, message) => {
      try {
        const payload = JSON.parse(message.toString());
        if (payload && payload.senderId !== clientId) {
          console.log("MQTT message received:", payload.state.current_step);
          applyRemoteState(payload.state);
        }
      } catch (err) {
        console.warn("MQTT parse error", err);
      }
    });

    mqttClient.on('error', (err) => {
      console.warn("MQTT error", err);
      statusEl.className = "flex items-center gap-1 bg-amber-100 text-amber-800 px-2.5 py-1 rounded-full text-xs font-black border border-amber-300 shadow-sm";
      statusText.textContent = "ローカル同期";
    });

    mqttClient.on('offline', () => {
      isMqttConnected = false;
      statusText.textContent = "オフライン";
    });

  } catch (e) {
    console.warn("MQTT init error", e);
  }
}

// BroadcastChannel (同一ブラウザ別タブ同期)
function initBroadcastChannel() {
  try {
    bc = new BroadcastChannel('manekko_channel_' + roomId);
    bc.onmessage = (event) => {
      if (event.data && event.data.type === 'STATE_UPDATE') {
        applyRemoteState(event.data.state);
      }
    };
  } catch (e) {
    console.warn("BroadcastChannel not supported", e);
  }
}

// ローカルPythonサーバーチェック
async function checkLocalServer() {
  try {
    const res = await fetch('/api/info', { cache: 'no-store' });
    if (res.ok) {
      isLocalServerAvailable = true;
      console.log("Local Python server is active.");
      // 2秒ごとにポーリング
      setInterval(async () => {
        try {
          const sRes = await fetch('/api/state', { cache: 'no-store' });
          if (sRes.ok) {
            const remoteState = await sRes.json();
            if (remoteState.version > appState.version || remoteState.updated_at > appState.updated_at) {
              applyRemoteState(remoteState);
            }
          }
        } catch (e) {}
      }, 2000);
    }
  } catch (e) {
    isLocalServerAvailable = false;
  }
}

// 状態の配信 (MQTT + LocalServer + BroadcastChannel + LocalStorage)
function publishState(incrementVersion = true) {
  if (incrementVersion) {
    appState.version = (appState.version || 0) + 1;
    appState.updated_at = Date.now();
  }

  // LocalStorageに保存（オフライン復旧用）
  try {
    localStorage.setItem('manekko_saved_state', JSON.stringify(appState));
  } catch (e) {}

  // 1. MQTTで配信
  if (mqttClient && isMqttConnected) {
    try {
      const topic = getMqttTopic();
      const payload = JSON.stringify({
        senderId: mqttClient.options.clientId,
        state: appState
      });
      mqttClient.publish(topic, payload, { qos: 0, retain: false });
    } catch (e) {
      console.warn("MQTT publish failed", e);
    }
  }

  // 2. BroadcastChannelで配信
  if (bc) {
    bc.postMessage({ type: 'STATE_UPDATE', state: appState });
  }

  // 3. ローカルサーバーへPOST
  if (isLocalServerAvailable) {
    fetch('/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(appState)
    }).catch(() => {});
  }
}

// リモートからの状態適用
function applyRemoteState(remoteState) {
  const prevStep = appState.current_step;
  const prevAnswer = appState.show_answer;
  const prevMimic = appState.is_mimicking;

  appState = { ...remoteState };
  renderUI();

  // イベント音・音声読み上げトリガー
  if (prevStep === 'shooting' && appState.current_step === 'naming') {
    playSound('success');
    speak("写真が届きました！名前をつけてね！");
  } else if (!prevAnswer && appState.show_answer) {
    playSound('reveal');
    const q = appState.questions[appState.presenting_index];
    if (q && q.name) speak(`名前は、${q.name} です！`);
  } else if (!prevMimic && appState.is_mimicking) {
    triggerMimicAnimation();
  }
}

// ==================== 4. 画像圧縮ユーティリティ ====================
// iPadでの通信を極限まで軽くするため、長辺640px・品質0.6に最適化
function compressImage(file, maxWidth = 640, quality = 0.6) {
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

  // あいことば表示
  const roomEl = document.getElementById('room-display');
  if (roomEl) roomEl.textContent = `あいことば: ${roomId.replace('manekko_', '')}`;

  // チームカードの役割テキスト更新
  const isTeamAShooter = appState.team_roles.team_a === 'shooter';
  document.getElementById('team-a-icon').textContent = isTeamAShooter ? '📷' : '✏️';
  document.getElementById('team-a-role-text').textContent = isTeamAShooter ? 'ポーズを さつえい するよ！' : 'なまえを つけるよ！';

  document.getElementById('team-b-icon').textContent = !isTeamAShooter ? '📷' : '✏️';
  document.getElementById('team-b-role-text').textContent = !isTeamAShooter ? 'ポーズを さつえい するよ！' : 'なまえを つけるよ！';

  // 進行バーのハイライト更新
  updateProgressBar();

  // 画面の切り替え
  const viewTop = document.getElementById('view-top');
  const viewShoot = document.getElementById('view-shoot');
  const viewName = document.getElementById('view-name');
  const viewPresent = document.getElementById('view-present');
  const btnBack = document.getElementById('btn-back');
  const roleBadge = document.getElementById('current-role-badge');
  const roleBadgeText = document.getElementById('role-badge-text');

  [viewTop, viewShoot, viewName, viewPresent].forEach(v => v.classList.add('hidden'));

  if (!myRole) {
    viewTop.classList.remove('hidden');
    btnBack.classList.add('hidden');
    roleBadge.classList.add('hidden');
    return;
  }

  btnBack.classList.remove('hidden');
  roleBadge.classList.remove('hidden');

  // ロールバッジ設定
  if (myRole === 'team_a') {
    roleBadge.className = "flex items-center gap-1.5 px-3 py-1 rounded-full text-xs md:text-sm font-black shadow-sm bg-rose-100 text-rose-700 border border-rose-300";
    roleBadgeText.textContent = `あかチーム (${appState.team_roles.team_a === 'shooter' ? '📷 さつえい' : '✏️ なまえつけ'})`;
  } else if (myRole === 'team_b') {
    roleBadge.className = "flex items-center gap-1.5 px-3 py-1 rounded-full text-xs md:text-sm font-black shadow-sm bg-sky-100 text-sky-700 border border-sky-300";
    roleBadgeText.textContent = `あおチーム (${appState.team_roles.team_b === 'shooter' ? '📷 さつえい' : '✏️ なまえつけ'})`;
  } else {
    roleBadge.className = "flex items-center gap-1.5 px-3 py-1 rounded-full text-xs md:text-sm font-black shadow-sm bg-amber-100 text-amber-800 border border-amber-300";
    roleBadgeText.textContent = "📺 せんせい・モニター";
  }

  // 役割に応じた画面表示
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
      // なまえつけ側
      if (appState.current_step === 'presenting') {
        viewPresent.classList.remove('hidden');
        renderPresentView();
      } else {
        viewName.classList.remove('hidden');
        renderNameView();
      }
    }
  }

  if (window.lucide) lucide.createIcons();
}

// 授業進行ステータスバーの更新
function updateProgressBar() {
  const indShoot = document.getElementById('step-indicator-shoot');
  const indName = document.getElementById('step-indicator-name');
  const indPresent = document.getElementById('step-indicator-present');

  // リセット
  [indShoot, indName, indPresent].forEach(el => {
    el.className = "flex items-center gap-1 text-slate-400 font-bold transition-all";
    el.querySelector('span:first-child').className = "w-5 h-5 rounded-full bg-slate-300 text-white flex items-center justify-center text-xs";
  });

  if (appState.current_step === 'shooting') {
    indShoot.className = "flex items-center gap-1 text-rose-600 font-black scale-105 transition-all";
    indShoot.querySelector('span:first-child').className = "w-5 h-5 rounded-full bg-rose-500 text-white flex items-center justify-center text-xs shadow-sm";
  } else if (appState.current_step === 'naming') {
    indName.className = "flex items-center gap-1 text-sky-600 font-black scale-105 transition-all";
    indName.querySelector('span:first-child').className = "w-5 h-5 rounded-full bg-sky-500 text-white flex items-center justify-center text-xs shadow-sm";
  } else if (appState.current_step === 'presenting') {
    indPresent.className = "flex items-center gap-1 text-amber-600 font-black scale-105 transition-all";
    indPresent.querySelector('span:first-child').className = "w-5 h-5 rounded-full bg-amber-500 text-white flex items-center justify-center text-xs shadow-sm";
  }
}

// 撮影画面のレンダリング
function renderShootView() {
  const sentBox = document.getElementById('shoot-sent-box');
  const activeBox = document.getElementById('shoot-active-box');

  // すでに送信済み（current_step === 'naming'）の場合、待機ボックスを表示
  if (appState.current_step === 'naming') {
    sentBox.classList.remove('hidden');
    activeBox.classList.add('hidden');
    return;
  }

  sentBox.classList.add('hidden');
  activeBox.classList.remove('hidden');

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
  
  // 1枚以上撮れば送信可能に改善！
  if (photoCount >= 1) {
    submitBtn.disabled = false;
    submitBtn.className = "w-full bg-gradient-to-r from-emerald-400 to-green-500 hover:from-emerald-500 hover:to-green-600 active:scale-98 text-white font-black text-xl md:text-2xl py-4 rounded-2xl shadow-xl border-2 border-emerald-300 flex items-center justify-center gap-3 cursor-pointer animate-bounce-slow";
    submitText.textContent = `${photoCount}まい できた！ あおチームにおくる 🚀`;
  } else {
    submitBtn.disabled = true;
    submitBtn.className = "w-full bg-slate-300 text-slate-500 font-black text-xl md:text-2xl py-4 rounded-2xl shadow-lg border-2 border-slate-300 flex items-center justify-center gap-3 cursor-not-allowed";
    submitText.textContent = "しゃしんを 1まい いじょう とろう！";
  }
}

// なまえつけ画面のレンダリング
function renderNameView() {
  const waitingEl = document.getElementById('name-waiting');
  const sentBox = document.getElementById('name-sent-box');
  const activeEl = document.getElementById('name-active');

  // 写真が1枚もない場合、または撮影中の場合
  const hasPhotos = appState.questions.some(q => q.image !== null);
  if (!hasPhotos && appState.current_step === 'shooting') {
    waitingEl.classList.remove('hidden');
    sentBox.classList.add('hidden');
    activeEl.classList.add('hidden');
    return;
  }

  // なまえ入力完了後、発表画面へ進む前の待機状態
  if (appState.current_step === 'naming' && appState.all_names_submitted) {
    waitingEl.classList.add('hidden');
    sentBox.classList.remove('hidden');
    activeEl.classList.add('hidden');
    return;
  }

  waitingEl.classList.add('hidden');
  sentBox.classList.add('hidden');
  activeEl.classList.remove('hidden');

  // 有効な写真があるスロットを特定
  const validQuestions = appState.questions.filter(q => q.image !== null);
  if (validQuestions.length === 0) {
    waitingEl.classList.remove('hidden');
    activeEl.classList.add('hidden');
    return;
  }

  // 選択中のタブが写真のないスロットなら、写真のある最初のスロットに移動
  if (!appState.questions[currentNamingTab] || !appState.questions[currentNamingTab].image) {
    const firstValidIdx = appState.questions.findIndex(q => q.image !== null);
    if (firstValidIdx !== -1) currentNamingTab = firstValidIdx;
  }

  // タブボタンの表示・活性化
  document.querySelectorAll('.name-tab-btn').forEach((btn, idx) => {
    const q = appState.questions[idx];
    if (!q || !q.image) {
      btn.classList.add('opacity-40');
    } else {
      btn.classList.remove('opacity-40');
    }

    if (idx === currentNamingTab) {
      btn.className = "name-tab-btn flex-1 py-2 rounded-xl font-black text-sm md:text-base transition-all bg-sky-500 text-white shadow-md border-2 border-sky-600 scale-105";
    } else {
      btn.className = "name-tab-btn flex-1 py-2 rounded-xl font-black text-sm md:text-base transition-all bg-slate-200 text-slate-600 border-2 border-slate-300";
    }
  });

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

  // タブ切り替えボタン
  document.querySelectorAll('.present-tab-btn').forEach((btn, idx) => {
    const q = appState.questions[idx];
    if (!q || !q.image) {
      btn.classList.add('opacity-40');
    } else {
      btn.classList.remove('opacity-40');
    }

    if (idx === currentIdx) {
      btn.className = "present-tab-btn px-3 md:px-4 py-1 rounded-full font-black text-xs md:text-sm bg-amber-500 text-white shadow scale-105";
    } else {
      btn.className = "present-tab-btn px-3 md:px-4 py-1 rounded-full font-black text-xs md:text-sm bg-white text-slate-700 border border-slate-300 shadow-sm";
    }
  });

  // 写真の表示
  const photoEl = document.getElementById('present-photo');
  if (currentQ.image) {
    photoEl.src = currentQ.image;
    photoEl.classList.remove('hidden');
  } else {
    photoEl.src = "";
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
      playSound('reveal');
      speak("まねっこスタート！みんなでポーズ！");
      mimicOverlay.classList.remove('hidden');

      setTimeout(() => {
        mimicOverlay.classList.add('hidden');
        if (myRole === 'teacher') {
          appState.is_mimicking = false;
          publishState(true);
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
  // 初回タップで音声アンロック
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

  // ヘッダーロゴクリックでトップへ
  document.getElementById('header-logo').addEventListener('click', () => {
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
      icon.className = "w-4 h-4 md:w-5 md:h-5 text-amber-600";
      playSound('click');
    } else {
      icon.setAttribute('data-lucide', 'volume-x');
      icon.className = "w-4 h-4 md:w-5 md:h-5 text-slate-400";
    }
    if (window.lucide) lucide.createIcons();
  });

  // 使い方モーダル
  document.getElementById('btn-show-help').addEventListener('click', () => {
    playSound('click');
    document.getElementById('modal-help').classList.remove('hidden');
  });
  const closeHelp = () => document.getElementById('modal-help').classList.add('hidden');
  document.getElementById('btn-close-help').addEventListener('click', closeHelp);
  document.getElementById('btn-close-help-2').addEventListener('click', closeHelp);

  // QRモーダル
  document.getElementById('btn-show-qr').addEventListener('click', () => {
    playSound('click');
    document.getElementById('modal-qr').classList.remove('hidden');
  });
  const closeQr = () => document.getElementById('modal-qr').classList.add('hidden');
  document.getElementById('btn-close-qr').addEventListener('click', closeQr);
  document.getElementById('btn-close-qr-2').addEventListener('click', closeQr);

  // あいことば変更
  document.getElementById('btn-change-room').addEventListener('click', () => {
    playSound('click');
    const input = prompt("あたらしい『あいことば』を いれてね（例: まねっこ2）", roomId.replace('manekko_', ''));
    if (input && input.trim()) {
      roomId = "manekko_" + encodeURIComponent(input.trim());
      localStorage.setItem('manekko_room_id', roomId);
      location.reload();
    }
  });

  // ---------- 撮影画面のイベント ----------
  document.querySelectorAll('.photo-input').forEach(input => {
    input.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const slot = parseInt(e.target.dataset.slot, 10);
      try {
        const compressedBase64 = await compressImage(file, 640, 0.6);
        playSound('shutter');
        
        // 状態を更新してクラウド同期
        appState.questions[slot - 1].image = compressedBase64;
        publishState(true);
        renderUI();
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

  // 写真送信ボタン
  document.getElementById('btn-submit-photos').addEventListener('click', () => {
    playSound('success');
    speak("写真を送りました！");
    appState.current_step = 'naming';
    appState.all_names_submitted = false;
    publishState(true);
    renderUI();
  });

  // 送信後に写真を再修正
  document.getElementById('btn-shoot-edit-again').addEventListener('click', () => {
    playSound('click');
    appState.current_step = 'shooting';
    publishState(true);
    renderUI();
  });

  // ---------- なまえつけ画面のイベント ----------
  document.querySelectorAll('.name-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      playSound('click');
      currentNamingTab = parseInt(btn.dataset.tab, 10);
      renderNameView();
    });
  });

  const nameInput = document.getElementById('name-input');
  nameInput.addEventListener('input', () => {
    const val = nameInput.value;
    appState.questions[currentNamingTab].name = val;
    // 名前はリアルタイムに同期
    publishState(true);
  });

  // おたすけことばチップ
  const chipsContainer = document.getElementById('word-chips');
  chipsContainer.innerHTML = "";
  HELPER_WORDS.forEach(word => {
    const chip = document.createElement('button');
    chip.className = "bg-white hover:bg-sky-100 active:scale-95 text-sky-800 text-xs md:text-sm font-extrabold px-3 py-1.5 rounded-full border-2 border-sky-300 shadow-sm transition-all";
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
    // 写真のある次のスロットを探す
    let nextIdx = (currentNamingTab + 1) % 3;
    while (!appState.questions[nextIdx]?.image && nextIdx !== currentNamingTab) {
      nextIdx = (nextIdx + 1) % 3;
    }
    currentNamingTab = nextIdx;
    renderNameView();
  });

  // なまえ送信ボタン
  document.getElementById('btn-submit-names').addEventListener('click', () => {
    playSound('success');
    speak("名前をつけました！発表の準備完了です！");
    appState.all_names_submitted = true;
    appState.current_step = 'presenting';
    appState.presenting_index = 0;
    appState.show_answer = false;
    appState.is_mimicking = false;
    publishState(true);
    renderUI();
  });

  // 送信後になまえを再修正
  document.getElementById('btn-name-edit-again').addEventListener('click', () => {
    playSound('click');
    appState.all_names_submitted = false;
    appState.current_step = 'naming';
    publishState(true);
    renderUI();
  });

  // ---------- 発表・まねっこ画面のイベント ----------
  document.querySelectorAll('.present-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      playSound('click');
      const idx = parseInt(btn.dataset.idx, 10);
      appState.presenting_index = idx;
      appState.show_answer = false;
      appState.is_mimicking = false;
      publishState(true);
      renderUI();
      speak(`第 ${idx + 1} 問！`);
    });
  });

  // オープン
  document.getElementById('btn-reveal-answer').addEventListener('click', () => {
    if (!appState.show_answer) {
      playSound('reveal');
      appState.show_answer = true;
      publishState(true);
      renderUI();
      const q = appState.questions[appState.presenting_index];
      if (q && q.name) speak(`名前は、${q.name} です！`);
    }
  });

  // まねっこスタート
  document.getElementById('btn-start-mimic').addEventListener('click', () => {
    appState.is_mimicking = true;
    publishState(true);
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
  document.getElementById('btn-next-question').addEventListener('click', () => {
    playSound('click');
    let nextIdx = (appState.presenting_index + 1) % 3;
    while (!appState.questions[nextIdx]?.image && nextIdx !== appState.presenting_index) {
      nextIdx = (nextIdx + 1) % 3;
    }
    appState.presenting_index = nextIdx;
    appState.show_answer = false;
    appState.is_mimicking = false;
    publishState(true);
    renderUI();
    speak(`第 ${nextIdx + 1} 問！`);
  });

  // 攻守交代
  document.getElementById('btn-swap-roles').addEventListener('click', () => {
    playSound('success');
    speak("こうたい！ 役割を交代します！");
    const curA = appState.team_roles.team_a;
    appState.round += 1;
    appState.current_step = 'shooting';
    appState.all_names_submitted = false;
    appState.team_roles = {
      team_a: curA === 'shooter' ? 'namer' : 'shooter',
      team_b: curA === 'shooter' ? 'shooter' : 'namer'
    };
    appState.questions = [
      { id: 1, image: null, name: "" },
      { id: 2, image: null, name: "" },
      { id: 3, image: null, name: "" }
    ];
    appState.presenting_index = 0;
    appState.show_answer = false;
    appState.is_mimicking = false;
    publishState(true);
    renderUI();
  });

  // 最初からリセット
  document.getElementById('btn-reset-game').addEventListener('click', () => {
    if (!confirm("さいしょから やりなおしますか？")) return;
    playSound('click');
    appState.round = 1;
    appState.current_step = 'shooting';
    appState.all_names_submitted = false;
    appState.team_roles = { team_a: 'shooter', team_b: 'namer' };
    appState.questions = [
      { id: 1, image: null, name: "" },
      { id: 2, image: null, name: "" },
      { id: 3, image: null, name: "" }
    ];
    appState.presenting_index = 0;
    appState.show_answer = false;
    appState.is_mimicking = false;
    publishState(true);
    renderUI();
  });

  // ---------- 先生おたすけ操作モーダル ----------
  document.getElementById('btn-emergency-rescue').addEventListener('click', () => {
    playSound('click');
    document.getElementById('modal-rescue').classList.remove('hidden');
  });
  const closeRescue = () => document.getElementById('modal-rescue').classList.add('hidden');
  document.getElementById('btn-close-rescue').addEventListener('click', closeRescue);
  document.getElementById('btn-close-rescue-2').addEventListener('click', closeRescue);

  // サンプル写真をセットして即送信
  document.getElementById('btn-rescue-sample-photos').addEventListener('click', () => {
    playSound('success');
    appState.questions[0].image = SAMPLE_POSES[0];
    appState.questions[1].image = SAMPLE_POSES[1];
    appState.questions[2].image = SAMPLE_POSES[2];
    appState.current_step = 'naming';
    publishState(true);
    renderUI();
    closeRescue();
    alert("3まいの サンプル写真を セットして なまえつけへ おくりました！");
  });

  // 強制的に名前つけへ進む
  document.getElementById('btn-rescue-to-naming').addEventListener('click', () => {
    playSound('click');
    if (!appState.questions[0].image) {
      appState.questions[0].image = SAMPLE_POSES[0];
    }
    appState.current_step = 'naming';
    publishState(true);
    renderUI();
    closeRescue();
  });

  // 強制的に発表へ進む
  document.getElementById('btn-rescue-to-present').addEventListener('click', () => {
    playSound('click');
    if (!appState.questions[0].image) appState.questions[0].image = SAMPLE_POSES[0];
    if (!appState.questions[0].name) appState.questions[0].name = "うさぎ ぴょんぴょん";
    appState.current_step = 'presenting';
    appState.presenting_index = 0;
    appState.show_answer = false;
    appState.is_mimicking = false;
    publishState(true);
    renderUI();
    closeRescue();
  });
}

// ==================== 7. 初期化 ====================
window.addEventListener('DOMContentLoaded', async () => {
  // 保存されたあいことばの復帰
  const savedRoom = localStorage.getItem('manekko_room_id');
  if (savedRoom) roomId = savedRoom;

  // LocalStorageから直前の状態を復元（リロード時の復旧）
  try {
    const savedState = localStorage.getItem('manekko_saved_state');
    if (savedState) {
      const parsed = JSON.parse(savedState);
      if (parsed) appState = { ...appState, ...parsed };
    }
  } catch (e) {}

  initEventListeners();
  initBroadcastChannel();
  initMqtt();
  checkLocalServer();

  // QRコード初期生成
  generateQrCode(window.location.href);
  document.getElementById('qr-url-text').textContent = window.location.href;

  renderUI();
});
